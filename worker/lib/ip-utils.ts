/**
 * IP address parsing utilities.
 * Pure functions — no side effects, no external I/O.
 */

import { isIP } from 'net';

function normalizeIpCandidate(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  let value = candidate.trim();
  if (!value) return null;

  // x-forwarded-for may contain a comma-separated chain — take the leftmost.
  if (value.includes(',')) {
    value = value.split(',')[0]?.trim() || '';
  }
  if (!value) return null;

  // Strip brackets from IPv6 format "[::1]:443".
  if (value.startsWith('[') && value.includes(']')) {
    value = value.slice(1, value.indexOf(']'));
  }

  // Strip port from IPv4 "1.2.3.4:1234".
  const ipv4WithPortMatch = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch) {
    value = ipv4WithPortMatch[1];
  }

  // Normalize IPv4-mapped IPv6 "::ffff:1.2.3.4".
  const lowerValue = value.toLowerCase();
  if (lowerValue.startsWith('::ffff:')) {
    value = value.slice(7); // '::ffff:'.length === 7
  }

  // Remove IPv6 scope zone, e.g. "fe80::1%eth0".
  value = value.split('%')[0];

  return isIP(value) !== 0 ? value.toLowerCase() : null;
}

/**
 * Extracts a normalized client IP from a request's headers.
 * Checks Vercel → Cloudflare → reverse-proxy headers in priority order.
 */
export function getClientIp(req: Request): string | null {
  const candidates = [
    req.headers.get('x-vercel-forwarded-for'),
    req.headers.get('cf-connecting-ip'),
    req.headers.get('x-real-ip'),
    req.headers.get('x-forwarded-for'),
  ];

  for (const candidate of candidates) {
    const parsed = normalizeIpCandidate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Builds a rate-limit key that never skips limiting.
 * When no valid client IP is present (direct IP, stripped headers),
 * falls back to a shared `unknown` bucket so abuse without headers
 * is still throttled instead of unlimited.
 */
export function getRateLimitKey(req: Request, prefix = 'ratelimit'): string {
  const ip = getClientIp(req);
  return ip ? `${prefix}:${ip}` : `${prefix}:unknown`;
}
