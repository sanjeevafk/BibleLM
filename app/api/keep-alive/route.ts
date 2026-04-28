import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

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

  if (redis) {
    try {
      // Execute a lightweight operation to keep Upstash Redis active (prevents hibernation)
      await redis.ping();
      redisStatus = 'connected';
    } catch (error) {
      // Log error but return 200 OK to avoid false positives in UptimeRobot
      console.error(`[keep-alive] Redis ${req.method} ping failed:`, error);
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
