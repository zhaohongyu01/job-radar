import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SECURITY_HEADERS: [string, string][] = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ['X-Frame-Options', 'DENY'],
  ['Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"],
];

function applySecurityHeaders(response: NextResponse) {
  for (const [key, value] of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (
    pathname === '/' &&
    (searchParams.get('workspace') === 'exams' || searchParams.get('mode') === 'exams')
  ) {
    const dest = request.nextUrl.clone();
    dest.pathname = '/exams';
    dest.searchParams.delete('workspace');
    dest.searchParams.delete('mode');
    return applySecurityHeaders(NextResponse.redirect(dest, 307));
  }
  return applySecurityHeaders(NextResponse.next());
}
