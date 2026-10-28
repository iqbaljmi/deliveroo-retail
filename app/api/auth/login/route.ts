import { NextResponse } from 'next/server';
import { authConfigured, createSession, credentialsMatch, sameOrigin, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!authConfigured()) return NextResponse.json({ error: 'Login is not configured on the server.' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid login request.' }, { status: 400 }); }
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 200 || body.password.length > 1000) {
    return NextResponse.json({ error: 'Enter your username and password.' }, { status: 400 });
  }
  if (!await credentialsMatch(body.username.trim(), body.password)) return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
  const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, await createSession(), {
    httpOnly: true, sameSite: 'lax', secure: new URL(req.url).protocol === 'https:', path: '/', maxAge: SESSION_SECONDS,
  });
  return response;
}
