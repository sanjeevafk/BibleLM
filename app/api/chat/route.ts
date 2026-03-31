/**
 * POST /api/chat — HTTP handler.
 *
 * This file is intentionally thin: request parsing, rate limiting, cache
 * lookup, pipeline delegation, and streaming. All business logic lives in
 * the sibling lib/ modules.
 */

import { streamText } from 'ai';
import { createHash, randomUUID } from 'crypto';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache';
import { generateWithFallback } from '@/lib/llm-fallback';
import { validateDataIntegrity } from '@/lib/validate-data';
import type { VerseContext } from '@/lib/bible-fetch';
import { redis } from '@/lib/redis';
import { ENABLE_RETRIEVAL_DEBUG } from '@/lib/feature-flags';
import { inMemoryRateLimit } from '@/lib/rate-limit-memory';
import { buildContextPrompt, SYSTEM_PROMPT } from '@/lib/prompts';
import { retrieveContextForQuery } from '@/lib/retrieval';
import {
  buildStructuredVerseResponse,
  compactStructuredChatResponse,
  normalizeOriginalLanguageEntries,
  type StructuredChatResponse,
} from '@/lib/verse-response';

import { getClientIp } from './lib/ip-utils';
import { scrubInvalidCitations } from './lib/citation-scrubber';
import {
  normalizeResponseContent,
  buildStructuredResponsePayload,
  ensureFallbackBanner,
  logContextUtilizationDiagnostics,
  streamTextFromContent,
} from './lib/response-normalizer';

// export const runtime = 'edge';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const DEBUG_LLM = ENABLE_RETRIEVAL_DEBUG;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WARN_THRESHOLD = 50;

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

const dataValidationPromise = validateDataIntegrity();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NormalizedChatResponse = {
  content: string;
  modelUsed: string;
  verses: VerseContext[];
  metadata: {
    translation: string;
    response?: StructuredChatResponse;
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

// ---------------------------------------------------------------------------
// Latency utilities
// ---------------------------------------------------------------------------

const EMPTY_LATENCY_METRICS: LatencyMetrics = {
  cache_lookup_ms: 0, retrieve_total_ms: 0, embed_ms: 0, vector_ms: 0,
  fetch_verses_db_ms: 0, fetch_verses_api_ms: 0, enrich_ms: 0,
  prompt_build_ms: 0, llm_ms: 0, post_normalize_ms: 0, total_ms: 0,
};

function debugLog(...args: unknown[]) {
  if (DEBUG_LLM) console.log(...args);
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

// ---------------------------------------------------------------------------
// In-flight request deduplication
// ---------------------------------------------------------------------------

const inflightRequests = new Map<string, Promise<PipelineExecutionResult>>();

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

// ---------------------------------------------------------------------------
// Model ID normalization
// ---------------------------------------------------------------------------

function normalizeModelId(modelUsed: string | undefined): string {
  if (!modelUsed) return PRIMARY_MODEL_USED;
  if (modelUsed.includes(':') || modelUsed === 'context-only') return modelUsed;
  if (modelUsed === PRIMARY_MODEL) return `gemini:${modelUsed}`;
  if (modelUsed === GROQ_FALLBACK_MODEL || modelUsed === GROQ_SECONDARY_MODEL) return `groq:${modelUsed}`;
  if (modelUsed === OPENROUTER_MODEL) return `openrouter:${modelUsed}`;
  if (modelUsed === HF_FALLBACK_MODEL) return `hf:${modelUsed}`;
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
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n');
  return historyLines.trim() ? `${finalPrompt}\n\nCONVERSATION HISTORY\n${historyLines}` : finalPrompt;
}

// ---------------------------------------------------------------------------
// Cache lookup
// ---------------------------------------------------------------------------

async function findPreferredCachedResponse(
  query: string,
  translation: string
): Promise<CacheLookupResult | null> {
  const cacheCandidates = CACHE_MODEL_CANDIDATES.map((modelKey) => ({
    modelKey,
    cacheKey: buildCacheKey({ query, translation, model: modelKey }),
  }));

  const results = await Promise.all(
    cacheCandidates.map(async ({ modelKey, cacheKey }) => ({
      modelKey,
      cacheKey,
      response: await getCachedResponse({ query, translation, model: modelKey }),
    }))
  );

  return results.find((result) => result.response?.response) ?? null;
}

// ---------------------------------------------------------------------------
// Redis rate limiting (atomic Lua script)
// ---------------------------------------------------------------------------

async function incrementRateLimitCounter(rateLimitKey: string): Promise<number | null> {
  if (!redis) return null;
  try {
    const rawCount = await redis.eval<[string], number>(RATE_LIMIT_SCRIPT, [rateLimitKey], [
      String(RATE_LIMIT_WINDOW_SECONDS),
    ]);
    const count = Number(rawCount);
    return Number.isFinite(count) ? count : null;
  } catch (error) {
    console.warn('[rate-limit] Atomic counter failed; falling back to non-atomic INCR/EXPIRE.', error);
    if (!redis) return null;
    try {
      const fallbackCount = await redis.incr(rateLimitKey);
      if (fallbackCount === 1) await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
      return fallbackCount;
    } catch (fallbackError) {
      console.warn('[rate-limit] Fallback counter failed; disabling rate limit for this request.', fallbackError);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Uncached pipeline execution
// ---------------------------------------------------------------------------

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
    onTiming: (durationMs) => { pipelineMetrics.llm_ms = roundLatencyMs(durationMs); },
  });

  const postNormalizeStartedAt = performance.now();
  const normalizedModelUsed = normalizeModelId(generation.modelUsed);
  const fallbackUsed = normalizedModelUsed !== PRIMARY_MODEL_USED;
  const finalFallback = generation.finalFallback === true || normalizedModelUsed === 'context-only';
  const normalizedContent = scrubInvalidCitations(
    normalizeResponseContent(generation.content, verses),
    verses
  );
  const streamedContent = ensureFallbackBanner(normalizedContent, normalizedModelUsed, fallbackUsed, finalFallback);
  const normalizedResponse: NormalizedChatResponse = {
    content: streamedContent,
    modelUsed: normalizedModelUsed,
    verses,
    metadata: {
      translation: options.requestedTranslation,
      response: buildStructuredResponsePayload(streamedContent, verses, options.requestedTranslation),
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
      { query: options.query, translation: options.requestedTranslation, model: normalizedModelUsed },
      { verses, context, prompt: finalPrompt, response: normalizedResponse.content, modelUsed: normalizedResponse.modelUsed }
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

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

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
    const queryTranslation = url.searchParams.get('translation') || url.searchParams.get('trans');
    const headerTranslation = req.headers.get('x-translation') || req.headers.get('x-bible-translation');

    const rawMessages = Array.isArray(messages) ? messages : [];
    const normalizedMessages = rawMessages
      .map((message: { role?: string; content?: unknown; parts?: Array<{ type?: string; text?: string }> }) => {
        const role = message?.role;
        if (role !== 'system' && role !== 'assistant' && role !== 'user') return null;
        if (typeof message.content === 'string') return { role, content: message.content };
        if (Array.isArray(message.content)) {
          const text = message.content
            .map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text || '' : ''))
            .join('');
          return text ? { role, content: text } : null;
        }
        if (Array.isArray(message.parts)) {
          const text = message.parts.map((part) => (part?.type === 'text' ? part.text || '' : '')).join('');
          return text ? { role, content: text } : null;
        }
        return null;
      })
      .filter((message): message is { role: 'system' | 'assistant' | 'user'; content: string } =>
        Boolean(message && message.content && message.content.trim())
      );

    const groqApiKey = customApiKey || process.env.GROQ_API_KEY;
    debugLog('Provider keys:', {
      hasGemini: Boolean(process.env.GEMINI_API_KEY),
      hasOpenRouter: Boolean(process.env.OPENROUTER_API_KEY),
      hasGroq: Boolean(groqApiKey),
      hasHf: Boolean(process.env.HF_TOKEN),
    });

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
              error: 'Rate limit exceeded (60 req/min). Try again in 60s.',
            }), { status: statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
          }
        }
      } else {
        debugLog('Rate limiting skipped: unable to determine valid client IP.');
      }
    } else {
      // Redis unavailable — use in-memory sliding-window fallback.
      // Not cluster-safe: configure Upstash Redis for multi-instance deployments.
      const ip = getClientIp(req);
      if (ip) {
        const result = inMemoryRateLimit(`ratelimit:${ip}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS * 1000);
        debugLog(`[in-memory rate limit] count=${result.count} for IP ${ip}`);
        if (!result.allowed) {
          statusCode = 429;
          return new Response(JSON.stringify({
            error: 'Rate limit exceeded (60 req/min). Try again in 60s.',
          }), { status: statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        }
        if (result.count > RATE_LIMIT_WARN_THRESHOLD) {
          rateLimitWarning = `Approaching rate limit (${result.count}/${RATE_LIMIT_MAX_REQUESTS} req/min)`;
        }
      } else {
        debugLog('Rate limiting skipped: unable to determine valid client IP.');
      }
    }

    const history = lastUserIndex > 0 ? normalizedMessages.slice(0, lastUserIndex) : [];
    const modelHistory = history.map((m) => ({ role: m.role, content: m.content }));

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
      const cachedStreamedContent = ensureFallbackBanner(normalizedCachedContent, cachedModelUsed, fallbackUsed, finalFallback);
      setLatencyMetric(latencyMetrics, 'post_normalize_ms', performance.now() - postNormalizeStartedAt);
      const cachedResponse: NormalizedChatResponse = {
        content: cachedStreamedContent,
        modelUsed: cachedModelUsed,
        verses: cached.verses || [],
        metadata: {
          translation: requestedTranslation,
          response: buildStructuredResponsePayload(cachedStreamedContent, cached.verses || [], requestedTranslation),
        },
      };
      logContextUtilizationDiagnostics(cachedResponse.content, cachedResponse.verses, {
        requestId, modelUsed: cachedResponse.modelUsed, cacheHit: true,
      });
      modelUsedForLog = cachedResponse.modelUsed;

      const cachedResult = await streamTextFromContent(cachedResponse.content, [
        { role: 'system', content: cached.prompt },
        ...modelHistory,
        { role: 'user', content: query },
      ] as Array<{ role: string; content: string }>);

      const cachedHeaders: Record<string, string> = {};
      if (fallbackUsed) cachedHeaders['x-model-used'] = cachedModelUsed;
      if (rateLimitWarning) cachedHeaders['x-rate-limit-warning'] = rateLimitWarning;

      const response = cachedResult.toUIMessageStreamResponse({
        headers: Object.keys(cachedHeaders).length > 0 ? cachedHeaders : undefined,
        messageMetadata: ({ part }: { part: any }) => {
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

    const missKey = buildCacheKey({ query, translation: requestedTranslation, model: PRIMARY_MODEL_USED });
    debugLog('Cache MISS – proceeding to LLM', missKey);

    const inflightKey = buildInflightRequestKeyWithHistory(query, requestedTranslation, PRIMARY_MODEL_USED, modelHistory);
    let pipelinePromise = inflightRequests.get(inflightKey);
    if (pipelinePromise) {
      debugLog('In-flight dedup HIT – awaiting active pipeline', inflightKey);
    } else {
      debugLog('In-flight dedup MISS – starting pipeline', inflightKey);
      pipelinePromise = executeUncachedPipeline({
        query, requestedTranslation, groqApiKey, modelHistory, requestId,
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
        { role: 'user', content: query },
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
        error: 'Rate limit exceeded. The shared resource is currently overloaded. Please wait a moment or provide your own API key in the settings.',
      }), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
    }
    statusCode = 500;
    return new Response(JSON.stringify({
      error: 'An unexpected error occurred while processing your request.',
    }), { status: statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
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
