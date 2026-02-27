import { simulateReadableStream, streamText } from 'ai';
import type { UIMessage } from 'ai';
import { retrieveContextForQuery } from '@/lib/retrieval';
import { buildContextPrompt, SYSTEM_PROMPT } from '@/lib/prompts';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache';
import { generateWithFallback } from '@/lib/llm-fallback';

// export const runtime = 'edge';

const PRIMARY_MODEL = 'llama-3.1-8b-instant';
const PRIMARY_MODEL_USED = `groq:${PRIMARY_MODEL}`;
const GROQ_FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const HF_FALLBACK_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct';
const GEMINI_MODEL = 'gemini-1.5-flash';
const CACHE_MODEL_CANDIDATES = [
  PRIMARY_MODEL_USED,
  `groq:${GROQ_FALLBACK_MODEL}`,
  `hf:${HF_FALLBACK_MODEL}`,
  `gemini:${GEMINI_MODEL}`,
  'context-only',
];

function normalizeModelId(modelUsed: string | undefined): string {
  if (!modelUsed) return PRIMARY_MODEL_USED;
  if (modelUsed.includes(':') || modelUsed === 'context-only') return modelUsed;
  if (modelUsed === PRIMARY_MODEL || modelUsed === GROQ_FALLBACK_MODEL) {
    return `groq:${modelUsed}`;
  }
  if (modelUsed === HF_FALLBACK_MODEL) {
    return `hf:${modelUsed}`;
  }
  if (modelUsed === GEMINI_MODEL) {
    return `gemini:${modelUsed}`;
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

async function streamTextFromContent(text: string, messages: Array<{ role: string; content: string }>) {
  const cachedStreamModel = {
    specificationVersion: 'v3',
    provider: 'cache',
    modelId: 'cache',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: text },
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

    const apiKey = customApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'Groq API key is missing. Set GROQ_API_KEY or provide a custom API key.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
    const history = lastUserIndex > 0 ? normalizedMessages.slice(0, lastUserIndex) : [];
    const modelHistory = history.map((message) => ({
      role: message.role,
      content: message.content
    }));

    let cached = null as Awaited<ReturnType<typeof getCachedResponse>>;
    let cachedModelKey: string | null = null;
    let cachedKey: string | null = null;
    for (const modelKey of CACHE_MODEL_CANDIDATES) {
      const cacheKey = buildCacheKey({
        query,
        translation: requestedTranslation,
        model: modelKey,
        userKey: customApiKey
      });
      cached = await getCachedResponse({
        query,
        translation: requestedTranslation,
        model: modelKey,
        userKey: customApiKey
      });
      if (cached?.response) {
        cachedModelKey = modelKey;
        cachedKey = cacheKey;
        break;
      }
    }

    if (cached?.response) {
      console.log('Cache hit:', cachedKey);
      const cachedModelUsed = normalizeModelId(cached.modelUsed);
      const fallbackUsed = cachedModelUsed !== PRIMARY_MODEL_USED;
      const finalFallback = cachedModelUsed === 'context-only';

      const cachedResult = await streamTextFromContent(cached.response, [
        { role: 'system', content: cached.prompt },
        ...modelHistory,
        { role: 'user', content: query }
      ] as Array<{ role: string; content: string }>);

      return cachedResult.toUIMessageStreamResponse({
        headers: fallbackUsed ? { 'x-model-used': cachedModelUsed } : undefined,
        messageMetadata: ({ part }) => {
          if (part.type === 'start' || part.type === 'finish') {
            return { modelUsed: cachedModelUsed, fallbackUsed, finalFallback } as any;
          }
          return undefined;
        },
      });
    }

    const missKey = buildCacheKey({
      query,
      translation: requestedTranslation,
      model: PRIMARY_MODEL_USED,
      userKey: customApiKey
    });
    console.log('Cache miss:', missKey);

    // RAG Retrieval
    const verses = await retrieveContextForQuery(query, requestedTranslation, apiKey);

    // Build context-aware prompt
    const finalPrompt = buildContextPrompt(query, verses, requestedTranslation);
    const context = finalPrompt.startsWith(SYSTEM_PROMPT)
      ? finalPrompt.slice(SYSTEM_PROMPT.length).trim()
      : finalPrompt;

    const prompt = buildPrompt(finalPrompt, modelHistory, query);

    const generation = await generateWithFallback(prompt, {
      maxTokens: 2048,
      temperature: 0.1,
      apiKey,
    } as any);

    const normalizedModelUsed = normalizeModelId(generation.modelUsed);
    const fallbackUsed = normalizedModelUsed !== PRIMARY_MODEL_USED;
    const finalFallback = generation.finalFallback === true || normalizedModelUsed === 'context-only';

    const responseInit = {
      headers: fallbackUsed ? { 'x-model-used': normalizedModelUsed } : undefined,
      messageMetadata: ({ part }: { part: { type: string } }) => {
        if (part.type === 'start' || part.type === 'finish') {
          return { modelUsed: normalizedModelUsed, fallbackUsed, finalFallback } as any;
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
            userKey: customApiKey
          },
          {
            verses,
            context,
            prompt: finalPrompt,
            response: text,
            modelUsed: normalizedModelUsed
          }
        );
      }
    };

    const fallbackResult = await streamTextFromContent(generation.content, [
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
