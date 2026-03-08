import crypto from 'crypto';
import type { VerseContext } from './bible-fetch';
import { redis } from './redis';

const CACHE_TTL_SECONDS = 259200; // 72 hours

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
};

function buildCacheKey({ query, translation, model }: CacheKeyInput): string {
  const input = `${query}\u0000${translation}\u0000${model}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

export { buildCacheKey };

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
    await redis.set(cacheKey, JSON.stringify(value), { ex: CACHE_TTL_SECONDS });
  } catch (error) {
    console.warn('[cache] Redis set failed; continuing without cache.', error);
  }
}
