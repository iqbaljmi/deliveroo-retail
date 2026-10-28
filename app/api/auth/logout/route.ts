import { NextResponse } from 'next/server';
import { sameOrigin, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: new URL(req.url).protocol === 'https:', path: '/', maxAge: 0 });
  return response;
}
