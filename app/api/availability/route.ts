import { NextResponse } from 'next/server';
import { getAvailability } from '@/lib/deliveroo';
import { fail } from '@/lib/http';
import { getSite } from '@/lib/sites';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const site = getSite(new URL(req.url).searchParams.get('siteId'));
    if (!site) return NextResponse.json({error:'Select an allowlisted site'}, {status:400});
    return NextResponse.json({...await getAvailability(site.id), site});
  } catch(e) {return fail(e);}
}
