import { simulateReadableStream, streamText } from 'ai';
import type { UIMessage } from 'ai';
import { retrieveContextForQuery } from '@/lib/retrieval';
import { buildContextPrompt, SYSTEM_PROMPT } from '@/lib/prompts';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache';
import { generateWithFallback } from '@/lib/llm-fallback';
import { validateDataIntegrity } from '@/lib/validate-data';
import type { VerseContext } from '@/lib/bible-fetch';
import { redis } from '@/lib/redis';

// export const runtime = 'edge';

const PRIMARY_MODEL = 'gemini-2.5-flash';
const PRIMARY_MODEL_USED = `gemini:${PRIMARY_MODEL}`;
const GEMINI_COMPAT_MODEL = 'gemini-1.5-flash';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';
const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant';
const GROQ_SECONDARY_MODEL = 'llama-3.3-70b-versatile';
const HF_FALLBACK_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct';
const CACHE_MODEL_CANDIDATES = [
  PRIMARY_MODEL_USED,
  `gemini:${GEMINI_COMPAT_MODEL}`,
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
};

const DEBUG_LLM = process.env.DEBUG_LLM === '1';
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

function debugLog(...args: unknown[]) {
  if (DEBUG_LLM) {
    console.log(...args);
  }
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
  if (modelUsed === PRIMARY_MODEL || modelUsed === GEMINI_COMPAT_MODEL) {
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

function normalizeTranslation(input: string | null | undefined): string {
  if (!input) return 'BSB';
  const upper = input.trim().toUpperCase();
  if (['BSB', 'KJV', 'WEB', 'ASV'].includes(upper)) return upper;
  return 'BSB';
}

function getMessageText(message: UIMessage | undefined): string {
  if (!message) return '';
  const msg = message as any;

  if (typeof msg.content === 'string') return msg.content;
  if (typeof msg.text === 'string') return msg.text;

  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: any) => (typeof part === 'string' ? part : part.text || part.value || ''))
      .join('');
  }

  if (Array.isArray(msg.parts)) {
    return msg.parts
      .map((part: any) => part.text || part.value || (part.type === 'text' ? part.text : ''))
      .join('');
  }

  return '';
}

function buildPrompt(
  finalPrompt: string,
  history: Array<{ role: 'system' | 'assistant' | 'user'; content: string }>,
  query: string
): string {
  const historyLines = history
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n');

  if (historyLines.trim()) {
    return `${finalPrompt}\n\nConversation so far:\n${historyLines}\n\nUser: ${query}`;
  }

  return `${finalPrompt}\n\nUser: ${query}`;
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

  return normalized;
}

async function streamTextFromContent(text: string, messages: Array<{ role: string; content: string }>) {
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

  const textDeltas = chunkText(text).map((delta) => ({ type: 'text-delta', id: 'text-1', delta }));

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

export async function POST(req: Request) {
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
    const queryTranslation = url.searchParams.get('trans');

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

    const groqApiKey = customApiKey || process.env.GROQ_API_KEY;
    console.log('Using primary provider: Gemini');
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
      return new Response('Missing user query', { status: 400 });
    }

    const query = typeof lastUserMessage.content === 'string' ? lastUserMessage.content.trim() : '';
    if (!query) {
      return new Response('Missing user query', { status: 400 });
    }

    const rawTranslation =
      typeof translation === 'string' && translation.trim() ? translation : queryTranslation;
    const requestedTranslation = normalizeTranslation(rawTranslation);
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
            return new Response('Rate limit exceeded (60 req/min). Try again in 60s.', { status: 429 });
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
    for (const modelKey of CACHE_MODEL_CANDIDATES) {
      const cacheKey = buildCacheKey({
        query,
        translation: requestedTranslation,
        model: modelKey,
      });
      cached = await getCachedResponse({
        query,
        translation: requestedTranslation,
        model: modelKey,
      });
      if (cached?.response) {
        cachedKey = cacheKey;
        break;
      }
    }

    if (cached?.response) {
      console.log('Cache HIT – returning stored response', cachedKey);
      const cachedModelUsed = normalizeModelId(cached.modelUsed);
      const fallbackUsed = cachedModelUsed !== PRIMARY_MODEL_USED;
      const finalFallback = cachedModelUsed === 'context-only';
      const normalizedCachedContent = normalizeResponseContent(cached.response, cached.verses || []);
      const cachedStreamedContent = ensureFallbackBanner(
        normalizedCachedContent,
        cachedModelUsed,
        fallbackUsed,
        finalFallback
      );
      const cachedResponse: NormalizedChatResponse = {
        content: cachedStreamedContent,
        modelUsed: cachedModelUsed,
        verses: cached.verses || [],
      };

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

      return cachedResult.toUIMessageStreamResponse({
        headers: Object.keys(cachedHeaders).length > 0 ? cachedHeaders : undefined,
        messageMetadata: ({ part }) => {
          if (part.type === 'start' || part.type === 'finish') {
            return {
              modelUsed: cachedResponse.modelUsed,
              fallbackUsed,
              finalFallback,
              verses: cachedResponse.verses,
            } as any;
          }
          return undefined;
        },
      });
    }

    const missKey = buildCacheKey({
      query,
      translation: requestedTranslation,
      model: PRIMARY_MODEL_USED,
    });
    console.log('Cache MISS – proceeding to LLM', missKey);

    // RAG Retrieval
    const verses = await retrieveContextForQuery(query, requestedTranslation, groqApiKey);

    // Build context-aware prompt
    const finalPrompt = buildContextPrompt(query, verses, requestedTranslation);
    const context = finalPrompt.startsWith(SYSTEM_PROMPT)
      ? finalPrompt.slice(SYSTEM_PROMPT.length).trim()
      : finalPrompt;

    const prompt = buildPrompt(finalPrompt, modelHistory, query);

    const generation = await generateWithFallback(prompt, {
      maxTokens: 2048,
      temperature: 0.1,
      apiKey: groqApiKey,
    } as any);

    const normalizedModelUsed = normalizeModelId(generation.modelUsed);
    const fallbackUsed = normalizedModelUsed !== PRIMARY_MODEL_USED;
    const finalFallback = generation.finalFallback === true || normalizedModelUsed === 'context-only';
    const normalizedContent = normalizeResponseContent(generation.content, verses);
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
    };
    console.log(`Model selected for response: ${normalizedModelUsed}`);

    const responseInit = {
      headers: {
        ...(fallbackUsed ? { 'x-model-used': normalizedModelUsed } : {}),
        ...(rateLimitWarning ? { 'x-rate-limit-warning': rateLimitWarning } : {}),
      },
      messageMetadata: ({ part }: { part: { type: string } }) => {
        if (part.type === 'start' || part.type === 'finish') {
          return {
            modelUsed: normalizedResponse.modelUsed,
            fallbackUsed,
            finalFallback,
            verses: normalizedResponse.verses,
          } as any;
        }
        return undefined;
      },
      onFinish: async ({ responseMessage, isAborted }: { responseMessage: UIMessage; isAborted: boolean }) => {
        if (isAborted) return;
        const text = getMessageText(responseMessage);
        if (!text) return;
        await setCachedResponse(
          {
            query,
            translation: requestedTranslation,
            model: normalizedModelUsed,
          },
          {
            verses,
            context,
            prompt: finalPrompt,
            response: text,
            modelUsed: normalizedResponse.modelUsed
          }
        );
      }
    };

    const fallbackResult = await streamTextFromContent(normalizedResponse.content, [
      { role: 'system', content: finalPrompt },
      ...modelHistory,
      { role: 'user', content: query }
    ] as Array<{ role: string; content: string }>);

    return fallbackResult.toUIMessageStreamResponse(responseInit);
  } catch (e: unknown) {
    console.error('API Error:', e);
    const error = e as Error;
    const errorMsg = error?.message?.toLowerCase() || '';
    if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
      return new Response(JSON.stringify({ 
        error: 'Rate limit exceeded. The shared resource is currently overloaded. Please wait a moment or provide your own API key in the settings.' 
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ 
      error: 'An unexpected error occurred while processing your request.' 
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
