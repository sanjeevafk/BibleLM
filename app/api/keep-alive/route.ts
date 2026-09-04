import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { inMemoryRateLimit } from '@/lib/rate-limit-memory';
import { getRateLimitKey } from '../chat/lib/ip-utils';

export const dynamic = 'force-dynamic';

const KEEP_ALIVE_WINDOW_SECONDS = 60;
const KEEP_ALIVE_MAX_REQUESTS = 120;

async function checkKeepAliveLimit(req: Request): Promise<boolean> {
  const key = `keepalive:${getRateLimitKey(req)}`;
  if (redis) {
    try {
      const count = Number(await redis.incr(key));
      if (count === 1) await redis.expire(key, KEEP_ALIVE_WINDOW_SECONDS);
      return count <= KEEP_ALIVE_MAX_REQUESTS;
    } catch {
      // fall through to memory
    }
  }
  return inMemoryRateLimit(key, KEEP_ALIVE_MAX_REQUESTS, KEEP_ALIVE_WINDOW_SECONDS * 1000).allowed;
}

/**
 * Keep-alive endpoint for BibleLM to prevent Vercel cold starts and Upstash Redis hibernation.
 * Optimized for hobby tier limits (fast execution, minimal dependencies).
 *
 * Supports:
 * - GET: Returns full JSON status (for manual health checks)
 * - HEAD: Returns 200 OK without body (optimized for UptimeRobot)
 */
async function handleKeepAlive(req: Request) {
  const start = Date.now();
  const isHead = req.method === 'HEAD';
  let redisStatus = 'disabled';

  if (!(await checkKeepAliveLimit(req))) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (redis) {
    try {
      // Execute a lightweight operation to keep Upstash Redis active (prevents hibernation)
      await redis.ping();
      redisStatus = 'connected';
    } catch (error) {
      // Log error but return 200 OK to avoid false positives in UptimeRobot
      console.error('[keep-alive] Redis %s ping failed:', req.method, error);
      redisStatus = 'error';
    }
  }

  // Optimized HEAD response (no body, headers only)
  if (isHead) {
    return new Response(null, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    });
  }

  // Detailed GET response
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      redis: redisStatus,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}

export async function GET(req: Request) {
  return handleKeepAlive(req);
}

export async function HEAD(req: Request) {
  return handleKeepAlive(req);
}
