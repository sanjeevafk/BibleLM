import type { Context } from 'hono';
import { getRedis } from '@/lib/redis';
import { inMemoryRateLimit } from '@/lib/rate-limit-memory';
import { getRateLimitKey } from '../lib/ip-utils';

const KEEP_ALIVE_WINDOW_SECONDS = 60;
const KEEP_ALIVE_MAX_REQUESTS = 120;

async function checkKeepAliveLimit(req: Request): Promise<boolean> {
  const key = `keepalive:${getRateLimitKey(req)}`;
  const redisClient = getRedis();
  if (redisClient) {
    try {
      const count = Number(await redisClient.incr(key));
      if (count === 1) await redisClient.expire(key, KEEP_ALIVE_WINDOW_SECONDS);
      return count <= KEEP_ALIVE_MAX_REQUESTS;
    } catch {
      // fall through to memory
    }
  }
  return inMemoryRateLimit(key, KEEP_ALIVE_MAX_REQUESTS, KEEP_ALIVE_WINDOW_SECONDS * 1000).allowed;
}

export async function handleKeepAlive(c: Context) {
  const req = c.req.raw;
  const isHead = req.method === 'HEAD';
  let redisStatus = 'disabled';

  if (!(await checkKeepAliveLimit(req))) {
    return c.json({ error: 'Rate limit exceeded' }, 429, { 'Cache-Control': 'no-store' });
  }

  const redisClient = getRedis();
  if (redisClient) {
    try {
      await redisClient.ping();
      redisStatus = 'connected';
    } catch (error) {
      console.error('[keep-alive] Redis ping failed:', error);
      redisStatus = 'error';
    }
  }

  if (isHead) {
    return new Response(null, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    });
  }

  return c.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      redis: redisStatus,
    },
    200,
    {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    }
  );
}
