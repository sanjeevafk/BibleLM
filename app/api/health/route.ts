import { NextResponse } from 'next/server';
import { validateDataIntegrity } from '@/lib/validate-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — lightweight liveness probe for Docker / orchestrators.
 * Never calls LLM or external network. Checks local data integrity only,
 * with a short timeout so unhealthy builds fail fast.
 */
export async function GET() {
  try {
    await Promise.race([
      validateDataIntegrity(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('health timeout')), 5000)),
    ]);
  } catch (error) {
    console.error('[health] data integrity check failed:', error);
    return NextResponse.json(
      { status: 'degraded', timestamp: new Date().toISOString() },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
