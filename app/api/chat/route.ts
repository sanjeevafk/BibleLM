import { createGroq } from '@ai-sdk/groq';
import { convertToModelMessages, simulateReadableStream, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { retrieveContextForQuery } from '@/lib/retrieval';
import { buildContextPrompt, SYSTEM_PROMPT } from '@/lib/prompts';
import { getCachedResponse, setCachedResponse } from '@/lib/cache';

// export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { messages, translation, customApiKey } = await req.json();

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

    const groq = createGroq({
      apiKey,
    });

    const modelCandidates = customApiKey
      ? ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'llama3-8b-8192']
      : ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'llama3-8b-8192', 'llama3-70b-8192'];
    
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

    const requestedTranslation = translation || 'BSB';
    const cacheModel = modelCandidates[0];
    const history = lastUserIndex > 0 ? normalizedMessages.slice(0, lastUserIndex) : [];
    const modelHistory = history.map((message) => ({
      role: message.role,
      content: message.content
    }));

    const cached = await getCachedResponse({
      query,
      translation: requestedTranslation,
      model: cacheModel,
      userKey: customApiKey
    });

    if (cached?.response) {
      console.info('[cache] hit', { query, translation: requestedTranslation, model: cacheModel });

      const cachedResult = await streamText({
        model: new MockLanguageModelV3({
          doStream: async () => ({
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: cached.response },
                { type: 'text-end', id: 'text-1' },
                {
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: undefined },
                  logprobs: undefined,
                  usage: {
                    inputTokens: { total: 0, noCache: 0 },
                    outputTokens: { total: cached.response.length, text: cached.response.length },
                  },
                },
              ],
            }),
          }),
        }) as any,
        messages: [
          { role: 'system', content: cached.finalPrompt },
          ...modelHistory,
          { role: 'user', content: query }
        ],
      });

      return cachedResult.toUIMessageStreamResponse();
    }

    console.info('[cache] miss', { query, translation: requestedTranslation, model: cacheModel });
    
    // RAG Retrieval
    const verses = await retrieveContextForQuery(query, requestedTranslation, apiKey);
    
    // Build context-aware prompt
    const finalPrompt = buildContextPrompt(query, verses, requestedTranslation);
    const context = finalPrompt.startsWith(SYSTEM_PROMPT)
      ? finalPrompt.slice(SYSTEM_PROMPT.length).trim()
      : finalPrompt;
    
    let lastModelError: unknown;
    for (const modelName of modelCandidates) {
      try {
        const result = await streamText({
          model: groq(modelName) as any,
          messages: [
            { role: 'system', content: finalPrompt },
            ...modelHistory,
            { role: 'user', content: query }
          ],
          temperature: 0.1, // Strict factual responses
          frequencyPenalty: 0.5, // Help prevent loops
          onFinish: async ({ text }) => {
            await setCachedResponse(
              {
                query,
                translation: requestedTranslation,
                model: cacheModel,
                userKey: customApiKey
              },
              {
                verses,
                context,
                finalPrompt,
                response: text
              }
            );
          },
        });

        return result.toUIMessageStreamResponse();
      } catch (err) {
        lastModelError = err;
        console.warn(`Groq model failed: ${modelName}`, err);
      }
    }

    throw lastModelError;
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
