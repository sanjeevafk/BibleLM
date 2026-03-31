/**
 * IP address parsing utilities.
 * Pure functions — no side effects, no external I/O.
 */

function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function isLikelyIPv6(value: string): boolean {
  if (!value.includes(':')) return false;
  return /^[0-9a-f:]+$/i.test(value);
}

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

  if (isValidIPv4(value) || isLikelyIPv6(value)) {
    return value.toLowerCase();
  }
  return null;
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
