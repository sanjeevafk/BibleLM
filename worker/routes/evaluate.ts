import type { Context } from 'hono';
import { validateDataIntegrity } from '@/lib/validate-data';
import { retrieveContextForQuery } from '@/lib/retrieval';
import { generateWithFallback } from '@/lib/llm-fallback';
import { rustScrubCitations as scrubInvalidCitations } from '@/lib/rust-bridge';
import { normalizeResponseContent } from '../lib/response-normalizer';
import { buildRetrievalPrompt, appendConversationHistory } from '../lib/prompt-builder';
import { parseChatRequest } from '../lib/validation';
import { classifyAndRewriteQuery } from '../lib/query-classifier';
import { createHash, timingSafeEqual } from 'crypto';
import { getRedis } from '@/lib/redis';
import { inMemoryRateLimit } from '@/lib/rate-limit-memory';
import { getRateLimitKey } from '../lib/ip-utils';

const dataValidationPromise = validateDataIntegrity();

const EVAL_RATE_LIMIT_WINDOW_SECONDS = 60;
const EVAL_RATE_LIMIT_MAX_REQUESTS = 30;

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    const dummy = createHash('sha256').update(provided).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    return timingSafeEqual(dummy, expectedHash) && false;
  }
  return timingSafeEqual(a, b);
}

async function checkEvalRateLimit(req: Request): Promise<{ allowed: boolean; count: number | null }> {
  const key = `eval:${getRateLimitKey(req)}`;
  const redisClient = getRedis();
  if (redisClient) {
    try {
      const count = Number(await redisClient.incr(key));
      if (count === 1) await redisClient.expire(key, EVAL_RATE_LIMIT_WINDOW_SECONDS);
      return { allowed: count <= EVAL_RATE_LIMIT_MAX_REQUESTS, count };
    } catch (error) {
      console.warn('[evaluate] Redis rate-limit failed; falling back to memory.', error);
    }
  }
  const result = inMemoryRateLimit(key, EVAL_RATE_LIMIT_MAX_REQUESTS, EVAL_RATE_LIMIT_WINDOW_SECONDS * 1000);
  return { allowed: result.allowed, count: result.count };
}

export async function handleEvaluate(c: Context) {
  const req = c.req.raw;
  const evalSecret = process.env.EVAL_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (!evalSecret) {
    if (isProd) {
      return c.json({ error: 'Evaluation endpoint disabled' }, 503, { 'Cache-Control': 'no-store' });
    }
    console.warn('[evaluate] EVAL_SECRET empty — open endpoint (dev only)');
  } else {
    const provided = req.headers.get('x-eval-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!provided || !secretsMatch(provided, evalSecret)) {
      return c.json({ error: 'Unauthorized' }, 401, { 'Cache-Control': 'no-store' });
    }
  }

  const limit = await checkEvalRateLimit(req);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded (30 req/min). Try again in 60s.' }, 429, { 'Cache-Control': 'no-store' });
  }

  try {
    await dataValidationPromise;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = parseChatRequest(body, req);
    if (!parsed.ok) {
      if (parsed.error.type === 'too_large') {
        return c.json({ error: 'Request too large', detail: parsed.error.detail }, 413, { 'Cache-Control': 'no-store' });
      }
      return c.json({ error: 'Invalid request body' }, 400);
    }

    const { query, requestedTranslation, modelHistory } = parsed.value;

    let verses = await retrieveContextForQuery(query, requestedTranslation, undefined, {
      requestId: crypto.randomUUID(),
    });
    let allowGeneralKnowledge = false;

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

    const contexts: string[] = verses.map((v) => {
      const lines = [`Reference: ${v.reference}`, `Text (${v.translation || requestedTranslation}): ${v.text}`];
      return lines.join('\n');
    });

    return c.json({
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
    }, 200);
  } catch (e: unknown) {
    console.error('[/api/evaluate] Error:', e);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
