import { NextRequest, NextResponse } from 'next/server';
import { authConfigured, SESSION_COOKIE, sameOrigin, verifySession } from '@/lib/auth';

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }
  if (path === '/api/auth/login' || path === '/api/auth/logout') return NextResponse.next();
  if (!authConfigured() && path !== '/login') return NextResponse.json({ error: 'APP_USER and APP_PASSWORD must be configured.' }, { status: 503 });
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (path === '/login') return user ? NextResponse.redirect(new URL('/', req.url)) : NextResponse.next();
  if (!user) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Your session has expired. Please sign in again.' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
