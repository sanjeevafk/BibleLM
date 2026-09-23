import { Redis } from '@upstash/redis';

let cachedInstance: Redis | null = null;
let lastUrl: string | undefined;
let lastToken: string | undefined;

/**
 * Lazy Redis factory. Reads environment variables at call time rather than module boot,
 * ensuring Cloudflare Worker request-time env bindings (c.env) are respected.
 */
export function getRedis(): Redis | null {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!redisUrl || !redisToken) {
    return null;
  }

  if (cachedInstance && lastUrl === redisUrl && lastToken === redisToken) {
    return cachedInstance;
  }

  lastUrl = redisUrl;
  lastToken = redisToken;
  cachedInstance = new Redis({
    url: redisUrl,
    token: redisToken,
  });

  return cachedInstance;
}

// Backward-compatible export that proxies to lazy instance
export const redis = new Proxy({} as unknown as Redis, {
  get(_target, prop) {
    const client = getRedis();
    if (!client) return undefined;
    const val = (client as unknown as Record<string, unknown>)[prop as string];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});
