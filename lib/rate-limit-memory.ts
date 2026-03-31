/**
 * In-memory sliding-window rate limiter.
 * Used as a fallback when Upstash Redis is not configured.
 *
 * Each key maps to an array of request timestamps.
 * On each check, stale timestamps (older than windowMs) are pruned.
 * This is NOT cluster-safe — each serverless instance has its own state.
 * For multi-instance production workloads, configure Upstash Redis instead.
 */

type WindowEntry = {
  timestamps: number[];
};

const store = new Map<string, WindowEntry>();

// Basic cleanup to prevent unbounded memory growth — runs on request if needed.
let lastCleanup = 0;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

function performCleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
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
  performCleanup(windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Prune timestamps outside the sliding window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  // Record this request
  entry.timestamps.push(now);

  const count = entry.timestamps.length;
  return { count, allowed: count <= maxRequests };
}
