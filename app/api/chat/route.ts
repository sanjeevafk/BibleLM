import { createGroq } from '@ai-sdk/groq';
import { convertToModelMessages, streamText } from 'ai';
import { retrieveContextForQuery } from '@/lib/retrieval';
import { buildContextPrompt } from '@/lib/prompts';

// export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { messages, translation, customApiKey } = await req.json();

    const rawMessages = Array.isArray(messages) ? messages : [];
    const sanitizedMessages = rawMessages.filter((message: { role?: string; content?: unknown }) => {
      const role = message?.role;
      if (role !== 'system' && role !== 'assistant' && role !== 'user') {
        return false;
      }
      return message.content !== undefined && message.content !== null;
    });

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

    const modelName = customApiKey ? 'llama-3.1-70b-versatile' : 'llama-3.1-8b-instant';
    
    // Get the latest user message
    let lastUserIndex = -1;
    let lastUserMessage: { role?: string; content?: unknown } | undefined;
    for (let i = sanitizedMessages.length - 1; i >= 0; i -= 1) {
      if (sanitizedMessages[i].role === 'user') {
        lastUserIndex = i;
        lastUserMessage = sanitizedMessages[i];
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
    
    // RAG Retrieval
    const verses = await retrieveContextForQuery(query, translation || 'WEB', apiKey);
    
    // Build context-aware prompt
    const systemPrompt = buildContextPrompt(query, verses, translation || 'WEB');

    // Remove the last message from history since we are injecting it via the system prompt context
    const history = lastUserIndex > 0 ? sanitizedMessages.slice(0, lastUserIndex) : [];
    const modelHistory = await convertToModelMessages(history);
    
    const result = await streamText({
      model: groq(modelName) as any,
      messages: [
        { role: 'system', content: systemPrompt },
        ...modelHistory,
        { role: 'user', content: query }
      ],
      temperature: 0.1, // Strict factual responses
    });

    return result.toUIMessageStreamResponse();
  } catch (e: unknown) {
    console.error('API Error:', e);
    const error = e as Error;
    const errorMsg = error?.message?.toLowerCase() || '';
    if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
      return new Response(JSON.stringify({ 
        error: 'Rate limit exceeded. The free tier API is currently overloaded. Please wait a moment or provide your own Groq API key in the settings.' 
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    
    return new Response(JSON.stringify({ 
      error: 'An unexpected error occurred while processing your request.' 
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
