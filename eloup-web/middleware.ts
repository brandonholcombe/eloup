import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Lightweight auth gate. Only checks for the Auth.js v5 session cookie's
// presence — the real validation happens server-side in route handlers via
// auth(). This keeps middleware out of node:crypto / better-sqlite3 paths
// and lets it run on the edge.
const PROTECTED_PREFIXES = ['/matches', '/profile', '/games'];
const PROTECTED_API_MUTATIONS = ['/api/matches', '/api/games'];

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const hasSession = SESSION_COOKIES.some((n) => req.cookies.get(n));

  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/api/auth/signin';
      url.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(url);
    }
  }

  if (
    PROTECTED_API_MUTATIONS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) &&
    req.method !== 'GET'
  ) {
    if (!hasSession) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/matches/:path*', '/profile/:path*', '/games/:path*', '/api/matches/:path*', '/api/games/:path*'],
};
