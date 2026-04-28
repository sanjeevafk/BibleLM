/**
 * In-memory sliding-window rate limiter.
 * Used as a fallback when Upstash Redis is not configured.
 *
 * Each key maps to an array of request timestamps.
 * On each check, stale timestamps (older than windowMs) are pruned.
 *
 * ⚠️  SERVERLESS DELUSION WARNING ⚠️
 * This module is UNSAFE for production serverless / Edge deployments:
 *
 *   1. STATELESS ISOLATES — Each Vercel / Cloudflare Worker isolate has its own
 *      independent heap. Memory written by isolate A is NEVER visible to isolate B.
 *      Concurrent requests will bypass the limit entirely when routed to different
 *      isolates.
 *
 *   2. COLD STARTS — The `store` Map is reset to empty on every cold start.
 *      A burst of requests that each land on a fresh isolate will all pass through,
 *      defeating the rate limit entirely.
 *
 * This module is safe ONLY for:
 *   - Local development / testing
 *   - Single-process Node.js servers (not serverless)
 *
 * For multi-instance production workloads, configure Upstash Redis instead
 * and use the `ratelimit` helper from `@upstash/ratelimit`.
 */

type WindowEntry = {
  timestamps: number[];
  windowMs: number;
};

const store = new Map<string, WindowEntry>();

// Emit a one-time warning when this module is loaded in a serverless context
// so the issue is visible in deployment logs, not just in source comments.
// Detect common serverless/edge platforms
const isServerless =
  process.env.VERCEL ||
  process.env.NEXT_RUNTIME === 'edge' ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.FUNCTION_NAME ||  // Google Cloud Functions
  process.env.FUNCTION_TARGET ||  // Google Cloud Functions (newer)
  typeof (globalThis as any).EdgeRuntime !== 'undefined';  // Cloudflare Workers

if (isServerless) {
  console.warn(
    '[rate-limit-memory] WARNING: In-memory rate limiting is active in a serverless ' +
    'environment. State is NOT shared across isolates. Configure UPSTASH_REDIS_REST_URL ' +
    'and UPSTASH_REDIS_REST_TOKEN to enable distributed rate limiting.'
  );
}

// Basic cleanup to prevent unbounded memory growth — runs on request if needed.
let lastCleanup = 0;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

function performCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < entry.windowMs);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

export type InMemoryRateLimitResult = {
  count: number;
  allowed: boolean;
};

/**
 * Increments the request counter for the given key within the sliding window.
 * Returns the current count and whether the request is within the limit.
 */
export function inMemoryRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): InMemoryRateLimitResult {
  const now = Date.now();
  performCleanup();

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [], windowMs };
    store.set(key, entry);
  }

  // Update window if it changed
  entry.windowMs = windowMs;

  // Prune timestamps outside the sliding window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  // Record this request
  entry.timestamps.push(now);

  const count = entry.timestamps.length;
  return { count, allowed: count <= maxRequests };
}
