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
import { createHash, timingSafeEqual } from 'crypto';
import { redis } from '@/lib/redis';
import { inMemoryRateLimit } from '@/lib/rate-limit-memory';
import { getRateLimitKey } from '../chat/lib/ip-utils';

const dataValidationPromise = validateDataIntegrity();

const EVAL_RATE_LIMIT_WINDOW_SECONDS = 60;
const EVAL_RATE_LIMIT_MAX_REQUESTS = 30;

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Constant-time-ish fallback to avoid early-exit length oracle; still false.
    const dummy = createHash('sha256').update(provided).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    return timingSafeEqual(dummy, expectedHash) && false;
  }
  return timingSafeEqual(a, b);
}

async function checkEvalRateLimit(req: Request): Promise<{ allowed: boolean; count: number | null }> {
  const key = `eval:${getRateLimitKey(req)}`;
  if (redis) {
    try {
      const count = Number(await redis.incr(key));
      if (count === 1) await redis.expire(key, EVAL_RATE_LIMIT_WINDOW_SECONDS);
      return { allowed: count <= EVAL_RATE_LIMIT_MAX_REQUESTS, count };
    } catch (error) {
      console.warn('[evaluate] Redis rate-limit failed; falling back to memory.', error);
    }
  }
  const result = inMemoryRateLimit(key, EVAL_RATE_LIMIT_MAX_REQUESTS, EVAL_RATE_LIMIT_WINDOW_SECONDS * 1000);
  return { allowed: result.allowed, count: result.count };
}

export async function POST(req: Request) {
  // ── Auth guard (fail-closed in production) ────────────────────────────────
  const evalSecret = process.env.EVAL_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (!evalSecret) {
    if (isProd) {
      return new Response(JSON.stringify({ error: 'Evaluation endpoint disabled' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    console.warn('[evaluate] EVAL_SECRET empty — open endpoint (dev only)');
  } else {
    const provided =
      req.headers.get('x-eval-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!provided || !secretsMatch(provided, evalSecret)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
  }

  // ── Rate limit (prevents LLM quota burn) ──────────────────────────────────
  const limit = await checkEvalRateLimit(req);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded (30 req/min). Try again in 60s.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
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
      if (parsed.error.type === 'too_large') {
        return new Response(JSON.stringify({ error: 'Request too large', detail: parsed.error.detail }), {
          status: 413,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
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
    let allowGeneralKnowledge = false;

    // Apply query classifier for multi-turn (same as chat route)
    if (modelHistory.length > 0) {
      const classification = await classifyAndRewriteQuery(query, modelHistory).catch(() => ({
        category: 'BIBLICAL' as const,
        searchQuery: query,
      }));

      if (classification.category === 'CONVERSATIONAL' || classification.category === 'OFF_TOPIC') {
        verses = [];
        allowGeneralKnowledge = true;
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
    const { finalPrompt } = buildRetrievalPrompt(query, verses, requestedTranslation, {
      allowGeneralKnowledge,
    });
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
