import crypto from 'crypto';
import type { VerseContext } from './bible-fetch';
import { redis } from './redis';

const DEFAULT_RESPONSE_CACHE_TTL_SECONDS = 259200; // 72 hours
const DEFAULT_RETRIEVAL_CACHE_TTL_SECONDS = 3600; // 1 hour

function parseCacheTtl(envValue: string | undefined, fallbackSeconds: number): number {
  const parsed = Number.parseInt(envValue || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
}

export const RESPONSE_CACHE_TTL_SECONDS = parseCacheTtl(
  process.env.RESPONSE_CACHE_TTL,
  DEFAULT_RESPONSE_CACHE_TTL_SECONDS
);
export const RETRIEVAL_CACHE_TTL_SECONDS = parseCacheTtl(
  process.env.RETRIEVAL_CACHE_TTL,
  DEFAULT_RETRIEVAL_CACHE_TTL_SECONDS
);

export type CachedChatResponse = {
  verses: VerseContext[];
  context: string;
  prompt: string;
  response: string;
  modelUsed?: string;
};

type CacheKeyInput = {
  query: string;
  translation: string;
  model: string;
  historyHash?: string;
};

type RetrievalContextCacheKeyInput = {
  query: string;
  translation: string;
  version: string;
};

function buildCacheKey({ query, translation, model, historyHash }: CacheKeyInput): string {
  const input = `${query}\u0000${translation}\u0000${model}${historyHash ? `\u0000${historyHash}` : ''}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

function buildRetrievalContextCacheKey({
  query,
  translation,
  version,
}: RetrievalContextCacheKeyInput): string {
  return `context:${version}:${translation}:${query.trim().toLowerCase()}`;
}

export { buildCacheKey, buildRetrievalContextCacheKey };

export async function getCachedResponse(input: CacheKeyInput): Promise<CachedChatResponse | null> {
  if (!redis) {
    return null;
  }

  const cacheKey = buildCacheKey(input);

  try {
    const cached = await redis.get<CachedChatResponse | string>(cacheKey);
    if (!cached) return null;
    if (typeof cached === 'string') {
      return JSON.parse(cached) as CachedChatResponse;
    }
    return cached as CachedChatResponse;
  } catch (error) {
    console.warn('[cache] Redis get failed; continuing without cache.', error);
    return null;
  }
}

export async function setCachedResponse(
  input: CacheKeyInput,
  value: CachedChatResponse
): Promise<void> {
  if (!redis) {
    return;
  }

  const cacheKey = buildCacheKey(input);

  try {
    await redis.set(cacheKey, JSON.stringify(value), { ex: RESPONSE_CACHE_TTL_SECONDS });
  } catch (error) {
    console.warn('[cache] Redis set failed; continuing without cache.', error);
  }
}

export async function getCachedRetrievalContext(
  input: RetrievalContextCacheKeyInput
): Promise<VerseContext[] | null> {
  if (!redis) {
    return null;
  }

  const cacheKey = buildRetrievalContextCacheKey(input);

  try {
    const cached = await redis.get<VerseContext[] | string>(cacheKey);
    if (!cached) return null;
    if (typeof cached === 'string') {
      return JSON.parse(cached) as VerseContext[];
    }
    return cached as VerseContext[];
  } catch (error) {
    console.warn('[cache] Retrieval context get failed; continuing without retrieval cache.', error);
    return null;
  }
}

export async function setCachedRetrievalContext(
  input: RetrievalContextCacheKeyInput,
  value: VerseContext[]
): Promise<void> {
  if (!redis) {
    return;
  }

  const cacheKey = buildRetrievalContextCacheKey(input);

  try {
    await redis.set(cacheKey, JSON.stringify(value), { ex: RETRIEVAL_CACHE_TTL_SECONDS });
  } catch (error) {
    console.warn('[cache] Retrieval context set failed; continuing without retrieval cache.', error);
  }
}
