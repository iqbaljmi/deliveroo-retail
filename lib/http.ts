import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export function fail(e: unknown, status = 502) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status }); }
