/**
 * POST /api/evaluate — Non-streaming evaluation endpoint for RAGAS/DeepEval benchmarking.
 *
 * Accepts the same request body as /api/chat but returns a JSON response with:
 *   - answer: the LLM's full response text
 *   - contexts: the retrieved verse texts (the RAG context window)
 *   - verses: the full VerseContext objects (for structural assertions)
 *   - model: which model was used
 *   - translation: which translation was used
 *
 * Protected by a shared secret (EVAL_SECRET env var) so it cannot be called
 * from the public internet.  Set EVAL_SECRET to any random string.
 */

import { validateDataIntegrity } from '@/lib/validate-data';
import { retrieveContextForQuery } from '@/lib/retrieval';
import { generateWithFallback } from '@/lib/llm-fallback';
import { scrubInvalidCitations } from '../chat/lib/citation-scrubber';
import { normalizeResponseContent } from '../chat/lib/response-normalizer';
import { buildRetrievalPrompt, appendConversationHistory } from '../chat/lib/prompt-builder';
import { parseChatRequest } from '../chat/lib/validation';
import { classifyAndRewriteQuery } from '../chat/lib/query-classifier';

const dataValidationPromise = validateDataIntegrity();

export async function POST(req: Request) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const evalSecret = process.env.EVAL_SECRET;
  if (evalSecret) {
    const provided =
      req.headers.get('x-eval-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (provided !== evalSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    await dataValidationPromise;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const parsed = parseChatRequest(body, req);
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { query, requestedTranslation, modelHistory } = parsed.value;

    // ── Retrieval (mirrors the chat pipeline exactly) ────────────────────────
    let verses = await retrieveContextForQuery(query, requestedTranslation, undefined, {
      requestId: crypto.randomUUID(),
    });

    // Apply query classifier for multi-turn (same as chat route)
    if (modelHistory.length > 0) {
      const classification = await classifyAndRewriteQuery(query, modelHistory).catch(() => ({
        category: 'BIBLICAL' as const,
        searchQuery: query,
      }));

      if (classification.category === 'CONVERSATIONAL' || classification.category === 'OFF_TOPIC') {
        verses = [];
      } else if (
        classification.category === 'BIBLICAL' &&
        classification.searchQuery &&
        classification.searchQuery.trim().toLowerCase() !== query.trim().toLowerCase()
      ) {
        verses = await retrieveContextForQuery(classification.searchQuery, requestedTranslation, undefined, {
          requestId: crypto.randomUUID(),
        });
      }
    }

    // ── Prompt & generation ──────────────────────────────────────────────────
    const { finalPrompt } = buildRetrievalPrompt(query, verses, requestedTranslation);
    const prompt = appendConversationHistory(finalPrompt, modelHistory);

    const generation = await generateWithFallback(prompt, {
      maxTokens: 900,
      temperature: 0.1,
    });

    const answer = scrubInvalidCitations(
      normalizeResponseContent(generation.content, verses),
      verses
    );

    // ── Shape contexts for RAGAS/DeepEval ────────────────────────────────────
    // Each context entry is a plain string: "Reference: ...\nText: ...\n"
    const contexts: string[] = verses.map((v) => {
      const lines = [`Reference: ${v.reference}`, `Text (${v.translation || requestedTranslation}): ${v.text}`];
      return lines.join('\n');
    });

    return new Response(
      JSON.stringify({
        answer,
        contexts,
        verses: verses.map((v) => ({
          reference: v.reference,
          text: v.text,
          translation: v.translation || requestedTranslation,
          isCrossReference: v.isCrossReference ?? false,
        })),
        model: generation.modelUsed ?? 'unknown',
        translation: requestedTranslation,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (e: unknown) {
    console.error('[/api/evaluate] Error:', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
