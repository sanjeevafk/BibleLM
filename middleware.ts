import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Allowed origins for CORS. In production, restrict to your actual domain.
 * Set NEXT_PUBLIC_APP_URL in environment variables.
 */
const PRODUCTION_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || '';

const ALLOWED_ORIGINS = new Set(
  [
    PRODUCTION_ORIGIN,
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter(Boolean)
);

const CORS_HEADERS_BASE: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-translation, x-bible-translation',
  'Access-Control-Max-Age': '86400',
};

function getCorsOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  // Allow any localhost port in development
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(requestOrigin)) {
    return requestOrigin;
  }
  if (ALLOWED_ORIGINS.has(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Only apply CORS logic to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const requestOrigin = request.headers.get('origin');
  const allowedOrigin = getCorsOrigin(requestOrigin);

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    const preflightHeaders: Record<string, string> = {
      ...CORS_HEADERS_BASE,
    };
    if (allowedOrigin) {
      preflightHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
      preflightHeaders['Vary'] = 'Origin';
    }
    return new NextResponse(null, {
      status: 204,
      headers: preflightHeaders,
    });
  }

  const response = NextResponse.next();

  // Attach CORS headers to all API responses
  for (const [key, value] of Object.entries(CORS_HEADERS_BASE)) {
    response.headers.set(key, value);
  }
  if (allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Vary', 'Origin');
  }

  return response;
}

export const config = {
  // Match all API routes
  matcher: '/api/:path*',
};
