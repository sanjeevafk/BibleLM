/**
 * Rate-limit keys must never skip limiting when IP headers are missing.
 * LIKE escaping must neutralize %/_ wildcards.
 * Cache keys must stay bounded for oversized queries.
 */
import { describe, it, expect } from 'vitest';
import { getRateLimitKey } from '@/app/api/chat/lib/ip-utils';
import { escapeLikePattern } from '@/lib/retrieval/verse-utils';
import { buildRetrievalContextCacheKey, buildEmbeddingCacheKey } from '@/lib/cache';
import { inMemoryRateLimit } from '@/lib/rate-limit-memory';

describe('getRateLimitKey', () => {
  it('uses unknown bucket when no IP headers present', () => {
    const req = new Request('http://localhost/api/chat', { method: 'POST' });
    expect(getRateLimitKey(req)).toBe('ratelimit:unknown');
  });

  it('uses client IP when x-forwarded-for is valid', () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(getRateLimitKey(req)).toBe('ratelimit:1.2.3.4');
  });
});

describe('inMemoryRateLimit', () => {
  it('blocks after max requests within window', () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i += 1) {
      expect(inMemoryRateLimit(key, 3, 60_000).allowed).toBe(true);
    }
    expect(inMemoryRateLimit(key, 3, 60_000).allowed).toBe(false);
  });
});

describe('escapeLikePattern', () => {
  it('escapes %, _, and backslash', () => {
    expect(escapeLikePattern('100%_\\')).toBe('100\\%\\_\\\\');
  });

  it('leaves normal text untouched', () => {
    expect(escapeLikePattern('faith hope')).toBe('faith hope');
  });
});

describe('bounded cache keys', () => {
  it('retrieval context keys stay bounded for huge queries', () => {
    const key = buildRetrievalContextCacheKey({
      query: 'a'.repeat(10_000),
      translation: 'BSB',
      version: 'v11',
    });
    expect(key.length).toBeLessThan(400);
    expect(key.startsWith('context:v11:BSB:')).toBe(true);
  });

  it('whitespace variants map to the same key prefix', () => {
    const a = buildEmbeddingCacheKey({ normalizedQuery: 'faith  hope', embeddingModel: 'm' });
    const b = buildEmbeddingCacheKey({ normalizedQuery: '  faith hope ', embeddingModel: 'm' });
    expect(a).toBe(b);
  });
});
