import { simulateReadableStream, streamText } from 'ai';
import { createHash, randomUUID } from 'crypto';
import { retrieveContextForQuery } from '@/lib/retrieval';
import { buildCitationWhitelist, buildContextPrompt, expandCitationReference, SYSTEM_PROMPT } from '@/lib/prompts';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache';
import { generateWithFallback } from '@/lib/llm-fallback';
import { validateDataIntegrity } from '@/lib/validate-data';
import type { VerseContext } from '@/lib/bible-fetch';
import { redis } from '@/lib/redis';
import { ENABLE_RETRIEVAL_DEBUG } from '@/lib/feature-flags';

// export const runtime = 'edge';

const PRIMARY_MODEL = 'gemini-2.5-flash';
const PRIMARY_MODEL_USED = `gemini:${PRIMARY_MODEL}`;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct';
const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant';
const GROQ_SECONDARY_MODEL = 'llama-3.3-70b-versatile';
const HF_FALLBACK_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct';
const CACHE_MODEL_CANDIDATES = [
  PRIMARY_MODEL_USED,
  `openrouter:${OPENROUTER_MODEL}`,
  `groq:${GROQ_FALLBACK_MODEL}`,
  `groq:${GROQ_SECONDARY_MODEL}`,
  `hf:${HF_FALLBACK_MODEL}`,
  'context-only',
];
const dataValidationPromise = validateDataIntegrity();

type NormalizedChatResponse = {
  content: string;
  modelUsed: string;
  verses: VerseContext[];
  metadata: {
    translation: string;
  };
};

type LatencyMetricName =
  | 'cache_lookup_ms'
  | 'retrieve_total_ms'
  | 'embed_ms'
  | 'vector_ms'
  | 'fetch_verses_db_ms'
  | 'fetch_verses_api_ms'
  | 'enrich_ms'
  | 'prompt_build_ms'
  | 'llm_ms'
  | 'post_normalize_ms'
  | 'total_ms';

type LatencyMetrics = Record<LatencyMetricName, number>;

type CacheLookupResult = {
  cacheKey: string;
  modelKey: string;
  response: Awaited<ReturnType<typeof getCachedResponse>>;
};

type PipelineExecutionResult = {
  normalizedResponse: NormalizedChatResponse;
  finalPrompt: string;
  preferredChunks?: string[];
  fallbackUsed: boolean;
  finalFallback: boolean;
  pipelineMetrics: Partial<LatencyMetrics>;
};

type ModelHistoryMessage = {
  role: 'system' | 'assistant' | 'user';
  content: string;
};

const DEBUG_LLM = ENABLE_RETRIEVAL_DEBUG;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WARN_THRESHOLD = 50;
const EMPTY_LATENCY_METRICS: LatencyMetrics = {
  cache_lookup_ms: 0,
  retrieve_total_ms: 0,
  embed_ms: 0,
  vector_ms: 0,
  fetch_verses_db_ms: 0,
  fetch_verses_api_ms: 0,
  enrich_ms: 0,
  prompt_build_ms: 0,
  llm_ms: 0,
  post_normalize_ms: 0,
  total_ms: 0,
};
const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;
const inflightRequests = new Map<string, Promise<PipelineExecutionResult>>();

function debugLog(...args: unknown[]) {
  if (DEBUG_LLM) {
    console.log(...args);
  }
}

function roundLatencyMs(durationMs: number): number {
  return Number(durationMs.toFixed(2));
}

function createLatencyMetrics(): LatencyMetrics {
  return { ...EMPTY_LATENCY_METRICS };
}

function setLatencyMetric(metrics: LatencyMetrics, metric: LatencyMetricName, durationMs: number): void {
  metrics[metric] = roundLatencyMs(durationMs);
}

function normalizeInflightQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildInflightRequestKey(query: string, translation: string, model: string): string {
  return `${normalizeInflightQuery(query)}\u0000${translation}\u0000${model}`;
}

function hashModelHistory(modelHistory: ModelHistoryMessage[]): string {
  return createHash('sha256').update(JSON.stringify(modelHistory)).digest('hex');
}

function buildInflightRequestKeyWithHistory(
  query: string,
  translation: string,
  model: string,
  modelHistory: ModelHistoryMessage[]
): string {
  return `${buildInflightRequestKey(query, translation, model)}\u0000${hashModelHistory(modelHistory)}`;
}

async function findPreferredCachedResponse(
  query: string,
  translation: string
): Promise<CacheLookupResult | null> {
  const cacheCandidates = CACHE_MODEL_CANDIDATES.map((modelKey) => ({
    modelKey,
    cacheKey: buildCacheKey({
      query,
      translation,
      model: modelKey,
    }),
  }));

  const results = await Promise.all(
    cacheCandidates.map(async ({ modelKey, cacheKey }) => ({
      modelKey,
      cacheKey,
      response: await getCachedResponse({
        query,
        translation,
        model: modelKey,
      }),
    }))
  );

  return results.find((result) => result.response?.response) ?? null;
}

function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function isLikelyIPv6(value: string): boolean {
  if (!value.includes(':')) return false;
  return /^[0-9a-f:]+$/i.test(value);
}

function normalizeIpCandidate(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  let value = candidate.trim();
  if (!value) return null;

  // x-forwarded-for may contain a comma-separated chain.
  if (value.includes(',')) {
    value = value.split(',')[0]?.trim() || '';
  }

  if (!value) return null;

  // Strip brackets from IPv6 format "[::1]:443".
  if (value.startsWith('[') && value.includes(']')) {
    value = value.slice(1, value.indexOf(']'));
  }

  // Strip port from IPv4 format "1.2.3.4:1234".
  const ipv4WithPortMatch = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch) {
    value = ipv4WithPortMatch[1];
  }

  // Normalize IPv4-mapped IPv6 "::ffff:1.2.3.4".
  if (value.startsWith('::ffff:')) {
    value = value.slice('::ffff:'.length);
  }

  // Remove IPv6 scope zone, e.g. "fe80::1%eth0".
  value = value.split('%')[0];

  if (isValidIPv4(value) || isLikelyIPv6(value)) {
    return value.toLowerCase();
  }
  return null;
}

function getClientIp(req: Request): string | null {
  const candidates = [
    req.headers.get('x-vercel-forwarded-for'),
    req.headers.get('cf-connecting-ip'),
    req.headers.get('x-real-ip'),
    req.headers.get('x-forwarded-for'),
  ];

  for (const candidate of candidates) {
    const parsed = normalizeIpCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

async function incrementRateLimitCounter(rateLimitKey: string): Promise<number | null> {
  if (!redis) {
    return null;
  }

  try {
    const rawCount = await redis.eval<[string], number>(RATE_LIMIT_SCRIPT, [rateLimitKey], [
      String(RATE_LIMIT_WINDOW_SECONDS),
    ]);
    const count = Number(rawCount);
    return Number.isFinite(count) ? count : null;
  } catch (error) {
    console.warn('[rate-limit] Atomic counter failed; falling back to non-atomic INCR/EXPIRE.', error);
    if (!redis) {
      return null;
    }
    try {
      const fallbackCount = await redis.incr(rateLimitKey);
      if (fallbackCount === 1) {
        await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
      }
      return fallbackCount;
    } catch (fallbackError) {
      console.warn('[rate-limit] Fallback counter failed; disabling rate limit for this request.', fallbackError);
      return null;
    }
  }
}

function normalizeModelId(modelUsed: string | undefined): string {
  if (!modelUsed) return PRIMARY_MODEL_USED;
  if (modelUsed.includes(':') || modelUsed === 'context-only') return modelUsed;
  if (modelUsed === PRIMARY_MODEL) {
    return `gemini:${modelUsed}`;
  }
  if (modelUsed === GROQ_FALLBACK_MODEL || modelUsed === GROQ_SECONDARY_MODEL) {
    return `groq:${modelUsed}`;
  }
  if (modelUsed === OPENROUTER_MODEL) {
    return `openrouter:${modelUsed}`;
  }
  if (modelUsed === HF_FALLBACK_MODEL) {
    return `hf:${modelUsed}`;
  }
  return modelUsed;
}

function normalizeTranslation(_input: string | null | undefined): string {
  if (!_input) return 'BSB';
  const upper = String(_input).trim().toUpperCase();
  const validTranslations = ['BSB', 'KJV', 'WEB', 'ASV', 'NHEB'];
  return validTranslations.includes(upper) ? upper : 'BSB';
}

function buildPrompt(
  finalPrompt: string,
  history: Array<{ role: 'system' | 'assistant' | 'user'; content: string }>
): string {
  const historyLines = history
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n');

  if (historyLines.trim()) {
    return `${finalPrompt}\n\nCONVERSATION HISTORY\n${historyLines}`;
  }

  return finalPrompt;
}

function normalizeCitationToken(citation: string): string {
  const trimmed = citation.trim();
  let end = trimmed.length;

  while (end > 0) {
    const char = trimmed[end - 1];
    if (!'()[],.;:!?'.includes(char)) {
      break;
    }
    end -= 1;
  }

  return collapseCitationWhitespace(trimmed.slice(0, end));
}

function collapseCitationWhitespace(value: string): string {
  let result = '';
  let previousWasWhitespace = false;

  for (const char of value) {
    const isWhitespace =
      char === ' ' ||
      char === '\n' ||
      char === '\r' ||
      char === '\t' ||
      char === '\f' ||
      char === '\v';

    if (isWhitespace) {
      if (!previousWasWhitespace && result.length > 0) {
        result += ' ';
      }
      previousWasWhitespace = true;
      continue;
    }

    result += char;
    previousWasWhitespace = false;
  }

  return result.trim();
}

function removeAllOccurrences(value: string, target: string): string {
  if (!target) return value;

  let result = value;
  let index = result.indexOf(target);
  while (index !== -1) {
    result = `${result.slice(0, index)}${result.slice(index + target.length)}`;
    index = result.indexOf(target);
  }
  return result;
}

function stripBracketedCitationSegments(content: string, citation: string, opening: string, closing: string): string {
  if (!citation) return content;

  let result = content;
  let searchStart = 0;

  while (searchStart < result.length) {
    const citationIndex = result.indexOf(citation, searchStart);
    if (citationIndex === -1) {
      break;
    }

    const openingIndex = result.lastIndexOf(opening, citationIndex);
    const closingIndex = result.indexOf(closing, citationIndex + citation.length);
    if (openingIndex !== -1 && closingIndex !== -1) {
      const segment = result.slice(openingIndex + 1, closingIndex);
      if (segment.includes(citation)) {
        result = `${result.slice(0, openingIndex)}${result.slice(closingIndex + 1)}`;
        searchStart = openingIndex;
        continue;
      }
    }

    searchStart = citationIndex + citation.length;
  }

  return result;
}

function stripEmptyCitationDelimiters(content: string): string {
  let result = content;
  let changed = true;

  while (changed) {
    changed = false;

    for (const pair of ['()', '[]']) {
      const next = removeAllOccurrences(result, pair);
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }

  return result;
}

function collapseRepeatedSpacesPerLine(value: string): string {
  let result = '';
  let previousWasSpace = false;

  for (const char of value) {
    if (char === ' ' || char === '\t') {
      if (!previousWasSpace) {
        result += ' ';
      }
      previousWasSpace = true;
      continue;
    }

    result += char;
    previousWasSpace = false;
  }

  return result;
}

function collapseBlankLines(value: string): string {
  let result = '';
  let consecutiveNewlines = 0;

  for (const char of value) {
    if (char === '\n') {
      consecutiveNewlines += 1;
      if (consecutiveNewlines <= 2) {
        result += char;
      }
      continue;
    }

    consecutiveNewlines = 0;
    result += char;
  }

  return result;
}

function removeSpaceBeforeCitationPunctuation(value: string): string {
  let result = '';

  for (const char of value) {
    if (',.;:!?'.includes(char) && result.endsWith(' ')) {
      result = result.slice(0, -1);
    }
    result += char;
  }

  return result;
}

function buildCitationWhitelistSet(verses: VerseContext[]): Set<string> {
  const whitelist = new Set<string>();
  for (const citation of buildCitationWhitelist(verses)) {
    const normalized = normalizeCitationToken(citation);
    if (normalized) {
      whitelist.add(normalized.toLowerCase());
    }
  }
  return whitelist;
}

function extractCitations(content: string): string[] {
  const matches = content.match(
    /(?<![1-3]\s)\b(?:[1-3][A-Z]{2}|[A-Z]{2,3}|[1-3]\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+\d+:\d+(?:[-–]\d+)?\b/g
  );
  return matches ? matches.map((match) => normalizeCitationToken(match)) : [];
}

function isAllowedCitation(citation: string, whitelist: Set<string>): boolean {
  const normalized = normalizeCitationToken(citation);
  if (!normalized) {
    return true;
  }

  const expanded = expandCitationReference(normalized);
  return whitelist.has(normalized.toLowerCase()) || whitelist.has(expanded.toLowerCase());
}

function scrubInvalidCitations(content: string, verses: VerseContext[]): string {
  const whitelist = buildCitationWhitelistSet(verses);
  if (whitelist.size === 0) {
    return content;
  }

  const citations = extractCitations(content);
  const invalidCitations = Array.from(
    new Set(citations.filter((citation) => !isAllowedCitation(citation, whitelist)))
  );

  if (invalidCitations.length === 0) {
    return content;
  }

  let sanitized = content;
  for (const citation of invalidCitations) {
    sanitized = stripBracketedCitationSegments(sanitized, citation, '(', ')');
    sanitized = stripBracketedCitationSegments(sanitized, citation, '[', ']');
    sanitized = removeAllOccurrences(sanitized, citation);
  }

  sanitized = stripEmptyCitationDelimiters(sanitized);
  sanitized = collapseRepeatedSpacesPerLine(sanitized);
  sanitized = collapseBlankLines(sanitized);
  sanitized = removeSpaceBeforeCitationPunctuation(sanitized).trim();

  console.info(JSON.stringify({
    event: 'citation_whitelist_enforced',
    removedCitations: invalidCitations,
    allowedCitations: Array.from(whitelist),
  }));

  return sanitized;
}

function logContextUtilizationDiagnostics(
  content: string,
  verses: VerseContext[],
  options?: {
    requestId?: string;
    modelUsed?: string | null;
    cacheHit?: boolean;
  }
): void {
  if (!DEBUG_LLM) {
    return;
  }

  const retrievedWhitelist = buildCitationWhitelistSet(verses);
  const citedWhitelist = new Set(
    extractCitations(content)
      .map((citation) => expandCitationReference(normalizeCitationToken(citation)).toLowerCase())
      .filter((citation) => retrievedWhitelist.has(citation))
  );

  const retrievedCount = retrievedWhitelist.size;
  const citedCount = citedWhitelist.size;
  const citationUtilization = retrievedCount > 0
    ? Number((citedCount / retrievedCount).toFixed(2))
    : 0;

  console.info(JSON.stringify({
    event: 'context_utilization',
    requestId: options?.requestId,
    modelUsed: options?.modelUsed,
    cacheHit: options?.cacheHit ?? false,
    retrieved_count: retrievedCount,
    cited_count: citedCount,
    citation_utilization: citationUtilization,
  }));
}

function ensureFallbackBanner(
  content: string,
  modelUsed: string,
  fallbackUsed: boolean,
  finalFallback: boolean
): string {
  if (!fallbackUsed || finalFallback) {
    return content;
  }
  const banner = `Using fallback model: ${modelUsed} due to rate limits / availability`;
  if (content.startsWith(banner)) {
    return content;
  }
  return `${banner}\n\n${content}`;
}

function normalizeOriginalKeywordLine(line: string): string {
  const match = line.match(/^(\s*[-*]\s+)(.+)$/);
  if (!match) {
    return line;
  }

  const prefix = match[1];
  const body = match[2].trim();
  if (!body || body.startsWith('`') || body.startsWith('```')) {
    return line;
  }

  const wordWithMetaMatch = body.match(/^(\[?[^\(\]]+\]?)(\s*\(.*\))$/);
  if (wordWithMetaMatch) {
    const word = wordWithMetaMatch[1].replace(/^\[|\]$/g, '').trim();
    const rest = wordWithMetaMatch[2].trim();
    return `${prefix}\`${word}\` ${rest}`;
  }

  const compactMatch = body.match(/^([^\s,;:]+)(.*)$/);
  if (!compactMatch) {
    return line;
  }

  const word = compactMatch[1].replace(/^\[|\]$/g, '').trim();
  const rest = compactMatch[2] || '';
  return `${prefix}\`${word}\`${rest}`;
}

function normalizeResponseContent(content: string, verses: VerseContext[]): string {
  if (!content || !content.trim()) {
    return content;
  }

  let normalized = content.replace(/\r\n/g, '\n').trim();

  normalized = normalized
    .replace(/^\s*[-*]?\s*Reference\s*:\s*(.+)$/gim, (_match, ref) => `- **${String(ref).trim()}**`)
    .replace(/^\s*[-*]?\s*Ref(?:erence)?\s*-\s*(.+)$/gim, (_match, ref) => `- **${String(ref).trim()}**`)
    .replace(/^\s*([-*]\s*)?\*\*Original key words:?\*\*\s*$/gim, '**Original key words:**');

  const lines = normalized.split('\n');
  const output: string[] = [];
  let inOriginalBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\*\*Original key words:\*\*$/i.test(trimmed)) {
      inOriginalBlock = true;
      output.push('**Original key words:**');
      continue;
    }

    const startsNewVerse =
      /^[-*]\s*["“]/.test(trimmed) ||
      /^[-*]\s*\*\*[A-Z0-9]{2,}\s+\d+:\d+/.test(trimmed) ||
      /^Textual conclusion/i.test(trimmed) ||
      /^All quotes from/i.test(trimmed);

    if (inOriginalBlock && startsNewVerse) {
      inOriginalBlock = false;
    }

    if (inOriginalBlock && /^[-*]\s+/.test(trimmed)) {
      output.push(normalizeOriginalKeywordLine(line));
      continue;
    }

    output.push(line);
  }

  normalized = output.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (!/\*\*[A-Z0-9]{2,}\s+\d+:\d+(?:[-–]\d+)?/.test(normalized) && verses.length > 0) {
    const refs = verses.map((verse) => `- **${verse.reference} (${verse.translation})**`).join('\n');
    normalized = `${normalized}\n\n${refs}`.trim();
  }

  if (!/\*\*Original key words:\*\*/i.test(normalized)) {
    const originalSections = verses
      .filter((verse) => Array.isArray(verse.original) && verse.original.length > 0)
      .slice(0, 4)
      .map((verse) => {
        const words = verse.original
          .slice(0, 6)
          .map((entry) => {
            const parts: string[] = [];
            if (entry.transliteration) parts.push(entry.transliteration);
            parts.push(`Strong's ${entry.strongs}`);
            if (entry.gloss) parts.push(`- ${entry.gloss}`);
            if (entry.morph) parts.push(`Morph: ${entry.morph}`);
            return `- ${entry.word} (${parts.join(', ')})`;
          })
          .join('\n');

        return `- **${verse.reference}**\n**Original key words:**\n${words}`;
      })
      .join('\n\n');

    if (originalSections) {
      normalized = `${normalized}\n\n${originalSections}`.trim();
    }
  }

  return normalized;
}

async function streamTextFromContent(
  text: string,
  messages: Array<{ role: string; content: string }>,
  preferredChunks?: string[]
) {
  const chunkText = (input: string): string[] => {
    const chunks: string[] = [];
    const maxChunkLength = 220;
    let cursor = 0;
    while (cursor < input.length) {
      const next = input.slice(cursor, cursor + maxChunkLength);
      chunks.push(next);
      cursor += maxChunkLength;
    }
    return chunks.length > 0 ? chunks : [input];
  };

  const chunks =
    Array.isArray(preferredChunks) && preferredChunks.length > 0
      ? preferredChunks
      : chunkText(text);
  const textDeltas = chunks.map((delta) => ({ type: 'text-delta', id: 'text-1', delta }));

  const cachedStreamModel = {
    specificationVersion: 'v3',
    provider: 'cache',
    modelId: 'cache',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          ...textDeltas,
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: text.length, text: text.length, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  };

  return streamText({
    model: cachedStreamModel as any,
    messages: messages as any,
  });
}

async function executeUncachedPipeline(options: {
  query: string;
  requestedTranslation: string;
  groqApiKey?: string;
  modelHistory: ModelHistoryMessage[];
  requestId: string;
}): Promise<PipelineExecutionResult> {
  const pipelineMetrics: Partial<LatencyMetrics> = {};

  const retrieveStartedAt = performance.now();
  const verses = await retrieveContextForQuery(options.query, options.requestedTranslation, options.groqApiKey, {
    requestId: options.requestId,
    onMetric: (metric, durationMs) => {
      pipelineMetrics[metric] = roundLatencyMs((pipelineMetrics[metric] || 0) + durationMs);
    },
  });
  pipelineMetrics.retrieve_total_ms = roundLatencyMs(performance.now() - retrieveStartedAt);

  const promptBuildStartedAt = performance.now();
  const finalPrompt = buildContextPrompt(options.query, verses, options.requestedTranslation);
  const context = finalPrompt.startsWith(SYSTEM_PROMPT)
    ? finalPrompt.slice(SYSTEM_PROMPT.length).trim()
    : finalPrompt;
  const prompt = buildPrompt(finalPrompt, options.modelHistory);
  pipelineMetrics.prompt_build_ms = roundLatencyMs(performance.now() - promptBuildStartedAt);

  const generation = await generateWithFallback(prompt, {
    maxTokens: 2048,
    temperature: 0.1,
    apiKey: options.groqApiKey,
    onTiming: (durationMs) => {
      pipelineMetrics.llm_ms = roundLatencyMs(durationMs);
    },
  });

  const postNormalizeStartedAt = performance.now();
  const normalizedModelUsed = normalizeModelId(generation.modelUsed);
  const fallbackUsed = normalizedModelUsed !== PRIMARY_MODEL_USED;
  const finalFallback = generation.finalFallback === true || normalizedModelUsed === 'context-only';
  const normalizedContent = scrubInvalidCitations(
    normalizeResponseContent(generation.content, verses),
    verses
  );
  const streamedContent = ensureFallbackBanner(
    normalizedContent,
    normalizedModelUsed,
    fallbackUsed,
    finalFallback
  );
  const normalizedResponse: NormalizedChatResponse = {
    content: streamedContent,
    modelUsed: normalizedModelUsed,
    verses,
    metadata: {
      translation: options.requestedTranslation,
    },
  };
  logContextUtilizationDiagnostics(normalizedResponse.content, normalizedResponse.verses, {
    requestId: options.requestId,
    modelUsed: normalizedResponse.modelUsed,
    cacheHit: false,
  });
  pipelineMetrics.post_normalize_ms = roundLatencyMs(performance.now() - postNormalizeStartedAt);

  if (verses.length > 0 && !/No supporting passages found/i.test(normalizedResponse.content)) {
    await setCachedResponse(
      {
        query: options.query,
        translation: options.requestedTranslation,
        model: normalizedModelUsed,
      },
      {
        verses,
        context,
        prompt: finalPrompt,
        response: normalizedResponse.content,
        modelUsed: normalizedResponse.modelUsed,
      }
    );
  }

  return {
    normalizedResponse,
    finalPrompt,
    preferredChunks: generation.chunks,
    fallbackUsed,
    finalFallback,
    pipelineMetrics,
  };
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  const requestStartedAt = performance.now();
  const latencyMetrics = createLatencyMetrics();
  let statusCode = 200;
  let translationForLog = 'unknown';
  let cacheHit = false;
  let modelUsedForLog: string | null = null;

  try {
    await dataValidationPromise;
    const { messages, translation, customApiKey } = await req.json();
    const baseUrl =
      req.headers.get('origin') ||
      (() => {
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
        if (host) {
          const proto = req.headers.get('x-forwarded-proto') || 'http';
          return `${proto}://${host}`;
        }
        return 'http://localhost';
      })();
    const url = new URL(req.url, baseUrl);
    const queryTranslation =
      url.searchParams.get('translation') ||
      url.searchParams.get('trans');
    const headerTranslation =
      req.headers.get('x-translation') ||
      req.headers.get('x-bible-translation');

    const rawMessages = Array.isArray(messages) ? messages : [];
    const normalizedMessages = rawMessages
      .map((message: { role?: string; content?: unknown; parts?: Array<{ type?: string; text?: string }> }) => {
        const role = message?.role;
        if (role !== 'system' && role !== 'assistant' && role !== 'user') {
          return null;
        }
        if (typeof message.content === 'string') {
          return { role, content: message.content };
        }
        if (Array.isArray(message.content)) {
          const text = message.content
            .map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text || '' : ''))
            .join('');
          return text ? { role, content: text } : null;
        }
        if (Array.isArray(message.parts)) {
          const text = message.parts
            .map((part) => (part?.type === 'text' ? part.text || '' : ''))
            .join('');
          return text ? { role, content: text } : null;
        }
        return null;
      })
      .filter((message): message is { role: 'system' | 'assistant' | 'user'; content: string } =>
        Boolean(message && message.content && message.content.trim())
      );

    // Groq API key is used for query classification and as a fallback LLM provider
    // Primary LLM provider is Gemini (uses GEMINI_API_KEY from environment)
    const groqApiKey = customApiKey || process.env.GROQ_API_KEY;
    debugLog('Provider keys:', {
      hasGemini: Boolean(process.env.GEMINI_API_KEY),
      hasOpenRouter: Boolean(process.env.OPENROUTER_API_KEY),
      hasGroq: Boolean(groqApiKey),
      hasHf: Boolean(process.env.HF_TOKEN),
    });

    // Get the latest user message
    let lastUserIndex = -1;
    let lastUserMessage: { role?: string; content?: unknown } | undefined;
    for (let i = normalizedMessages.length - 1; i >= 0; i -= 1) {
      if (normalizedMessages[i].role === 'user') {
        lastUserIndex = i;
        lastUserMessage = normalizedMessages[i];
        break;
      }
    }

    if (!lastUserMessage) {
      statusCode = 400;
      return new Response('Missing user query', { status: statusCode });
    }

    const query = typeof lastUserMessage.content === 'string' ? lastUserMessage.content.trim() : '';
    if (!query) {
      statusCode = 400;
      return new Response('Missing user query', { status: statusCode });
    }

    const rawTranslation =
      typeof translation === 'string' && translation.trim()
        ? translation
        : queryTranslation || headerTranslation;
    const requestedTranslation = normalizeTranslation(rawTranslation);
    translationForLog = requestedTranslation;
    console.log(`Translation switched to ${requestedTranslation}`);
    debugLog('Using translation:', requestedTranslation);

    let rateLimitWarning: string | null = null;

    if (redis) {
      const ip = getClientIp(req);
      if (ip) {
        const rateLimitKey = `ratelimit:${ip}`;
        const count = await incrementRateLimitCounter(rateLimitKey);
        debugLog(`Rate limit count: ${count ?? 'n/a'} for IP ${ip}`);
        if (typeof count === 'number') {
          if (count > RATE_LIMIT_WARN_THRESHOLD && count <= RATE_LIMIT_MAX_REQUESTS) {
            rateLimitWarning = `Approaching rate limit (${count}/${RATE_LIMIT_MAX_REQUESTS} req/min)`;
          }
          if (count > RATE_LIMIT_MAX_REQUESTS) {
            statusCode = 429;
            return new Response(JSON.stringify({ 
              error: 'Rate limit exceeded (60 req/min). Try again in 60s.' 
            }), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
          }
        }
      } else {
        debugLog('Rate limiting skipped: unable to determine valid client IP.');
      }
    } else {
      debugLog('Rate limiting disabled: Upstash Redis not configured.');
    }

    const history = lastUserIndex > 0 ? normalizedMessages.slice(0, lastUserIndex) : [];
    const modelHistory = history.map((message) => ({
      role: message.role,
      content: message.content
    }));

    let cached = null as Awaited<ReturnType<typeof getCachedResponse>>;
    let cachedKey: string | null = null;
    const cacheLookupStartedAt = performance.now();
    const preferredCachedResult = await findPreferredCachedResponse(query, requestedTranslation);
    if (preferredCachedResult) {
      cached = preferredCachedResult.response;
      cachedKey = preferredCachedResult.cacheKey;
    }
    setLatencyMetric(latencyMetrics, 'cache_lookup_ms', performance.now() - cacheLookupStartedAt);

    if (cached?.response && /No supporting passages found/i.test(cached.response)) {
      cached = null;
      cachedKey = null;
    }

    if (cached?.response) {
      cacheHit = true;
      debugLog('Cache HIT – returning stored response', cachedKey);
      const cachedModelUsed = normalizeModelId(cached.modelUsed);
      const fallbackUsed = cachedModelUsed !== PRIMARY_MODEL_USED;
      const finalFallback = cachedModelUsed === 'context-only';
      const postNormalizeStartedAt = performance.now();
      const normalizedCachedContent = scrubInvalidCitations(
        normalizeResponseContent(cached.response, cached.verses || []),
        cached.verses || []
      );
      const cachedStreamedContent = ensureFallbackBanner(
        normalizedCachedContent,
        cachedModelUsed,
        fallbackUsed,
        finalFallback
      );
      setLatencyMetric(latencyMetrics, 'post_normalize_ms', performance.now() - postNormalizeStartedAt);
      const cachedResponse: NormalizedChatResponse = {
        content: cachedStreamedContent,
        modelUsed: cachedModelUsed,
        verses: cached.verses || [],
        metadata: {
          translation: requestedTranslation,
        },
      };
      logContextUtilizationDiagnostics(cachedResponse.content, cachedResponse.verses, {
        requestId,
        modelUsed: cachedResponse.modelUsed,
        cacheHit: true,
      });
      modelUsedForLog = cachedResponse.modelUsed;

      const cachedResult = await streamTextFromContent(cachedResponse.content, [
        { role: 'system', content: cached.prompt },
        ...modelHistory,
        { role: 'user', content: query }
      ] as Array<{ role: string; content: string }>);

      const cachedHeaders: Record<string, string> = {};
      if (fallbackUsed) {
        cachedHeaders['x-model-used'] = cachedModelUsed;
      }
      if (rateLimitWarning) {
        cachedHeaders['x-rate-limit-warning'] = rateLimitWarning;
      }

      const response = cachedResult.toUIMessageStreamResponse({
        headers: Object.keys(cachedHeaders).length > 0 ? cachedHeaders : undefined,
        messageMetadata: ({ part }) => {
          if (part.type === 'start' || part.type === 'finish') {
            return {
              modelUsed: cachedResponse.modelUsed,
              fallbackUsed,
              finalFallback,
              verses: cachedResponse.verses,
              metadata: cachedResponse.metadata,
            } as any;
          }
          return undefined;
        },
      });
      statusCode = response.status;
      return response;
    }

    const missKey = buildCacheKey({
      query,
      translation: requestedTranslation,
      model: PRIMARY_MODEL_USED,
    });
    debugLog('Cache MISS – proceeding to LLM', missKey);

    const inflightKey = buildInflightRequestKeyWithHistory(
      query,
      requestedTranslation,
      PRIMARY_MODEL_USED,
      modelHistory
    );
    let pipelinePromise = inflightRequests.get(inflightKey);
    if (pipelinePromise) {
      debugLog('In-flight dedup HIT – awaiting active pipeline', inflightKey);
    } else {
      debugLog('In-flight dedup MISS – starting pipeline', inflightKey);
      pipelinePromise = executeUncachedPipeline({
        query,
        requestedTranslation,
        groqApiKey,
        modelHistory,
        requestId,
      }).finally(() => {
        if (inflightRequests.get(inflightKey) === pipelinePromise) {
          inflightRequests.delete(inflightKey);
        }
      });
      inflightRequests.set(inflightKey, pipelinePromise);
    }

    const pipelineResult = await pipelinePromise;
    for (const [metric, durationMs] of Object.entries(pipelineResult.pipelineMetrics) as Array<[LatencyMetricName, number]>) {
      setLatencyMetric(latencyMetrics, metric, durationMs);
    }
    const normalizedResponse = pipelineResult.normalizedResponse;
    const fallbackUsed = pipelineResult.fallbackUsed;
    const finalFallback = pipelineResult.finalFallback;
    modelUsedForLog = normalizedResponse.modelUsed;
    debugLog(`Model selected for response: ${normalizedResponse.modelUsed}`);

    const responseInit = {
      headers: {
        ...(fallbackUsed ? { 'x-model-used': normalizedResponse.modelUsed } : {}),
        ...(rateLimitWarning ? { 'x-rate-limit-warning': rateLimitWarning } : {}),
      },
      messageMetadata: ({ part }: { part: { type: string } }) => {
        if (part.type === 'start' || part.type === 'finish') {
          return {
            modelUsed: normalizedResponse.modelUsed,
            fallbackUsed,
            finalFallback,
            verses: normalizedResponse.verses,
            metadata: normalizedResponse.metadata,
          } as any;
        }
        return undefined;
      },
    };

    const fallbackResult = await streamTextFromContent(
      normalizedResponse.content,
      [
        { role: 'system', content: pipelineResult.finalPrompt },
        ...modelHistory,
        { role: 'user', content: query }
      ] as Array<{ role: string; content: string }>,
      pipelineResult.preferredChunks
    );

    const response = fallbackResult.toUIMessageStreamResponse(responseInit);
    statusCode = response.status;
    return response;
  } catch (e: unknown) {
    console.error('API Error:', e);
    const error = e as Error;
    const errorMsg = error?.message?.toLowerCase() || '';
    if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
      statusCode = 429;
      return new Response(JSON.stringify({ 
        error: 'Rate limit exceeded. The shared resource is currently overloaded. Please wait a moment or provide your own API key in the settings.' 
      }), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
    }

    statusCode = 500;
    return new Response(JSON.stringify({ 
      error: 'An unexpected error occurred while processing your request.' 
    }), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
  } finally {
    setLatencyMetric(latencyMetrics, 'total_ms', performance.now() - requestStartedAt);
    console.info(JSON.stringify({
      event: 'chat_request_latency',
      requestId,
      statusCode,
      translation: translationForLog,
      cacheHit,
      modelUsed: modelUsedForLog,
      metrics: latencyMetrics,
    }));
  }
}
