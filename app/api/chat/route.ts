import { createGroq } from '@ai-sdk/groq';
import { streamText, Message } from 'ai';
import { retrieveContextForQuery } from '@/lib/retrieval';
import { buildContextPrompt } from '@/lib/prompts';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { messages, translation, customApiKey } = await req.json();

    const groq = createGroq({
      apiKey: customApiKey || process.env.GROQ_API_KEY,
    });

    const modelName = customApiKey ? 'llama-3.1-70b-versatile' : 'llama-3.1-8b-instant';
    
    // Get the latest user message
    const lastMessage = messages[messages.length - 1];
    
    if (!lastMessage || lastMessage.role !== 'user') {
      return new Response('Missing user query', { status: 400 });
    }

    const query = lastMessage.content;
    
    // RAG Retrieval
    const verses = await retrieveContextForQuery(query, translation || 'WEB');
    
    // Build context-aware prompt
    const systemPrompt = buildContextPrompt(query, verses, translation || 'WEB');

    // Remove the last message from history since we are injecting it via the system prompt context
    const history = messages.slice(0, -1);
    
    const result = await streamText({
      model: groq(modelName) as any,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: query }
      ],
      temperature: 0.1, // Strict factual responses
    });

    return result.toDataStreamResponse();
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
