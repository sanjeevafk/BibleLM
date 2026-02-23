import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import type { VerseContext } from './bible-fetch';

const CACHE_TTL_SECONDS = 259200; // 72 hours

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

export type CachedChatResponse = {
  verses: VerseContext[];
  context: string;
  finalPrompt: string;
  response: string;
};

type CacheKeyInput = {
  query: string;
  translation: string;
  model: string;
  userKey?: string | null;
};

function buildCacheKey({ query, translation, model, userKey }: CacheKeyInput): string {
  const input = `${query}|${translation}|${model}|${userKey || ''}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function getCachedResponse(input: CacheKeyInput): Promise<CachedChatResponse | null> {
  if (!redis) {
    return null;
  }

  const cacheKey = buildCacheKey(input);

  try {
    const cached = await redis.get<string>(cacheKey);
    if (!cached) return null;

    return JSON.parse(cached) as CachedChatResponse;
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
