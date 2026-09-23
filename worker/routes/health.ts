import type { Context } from 'hono';
import { validateDataIntegrity } from '@/lib/validate-data';

/**
 * GET /api/health — lightweight liveness probe for Cloudflare Workers / orchestrators.
 * Checks local data integrity with a short timeout.
 */
export async function handleHealth(c: Context) {
  try {
    await Promise.race([
      validateDataIntegrity(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('health timeout')), 5000)),
    ]);
  } catch (error) {
    console.error('[health] data integrity check failed:', error);
    return c.json(
      { status: 'degraded', timestamp: new Date().toISOString() },
      503,
      { 'Cache-Control': 'no-store' }
    );
  }

  return c.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    200,
    { 'Cache-Control': 'no-store' }
  );
}
