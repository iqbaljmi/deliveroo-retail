import { NextResponse } from 'next/server';
import { getProducts } from '@/lib/deliveroo';
import { fail } from '@/lib/http';
import { getSite } from '@/lib/sites';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const site = getSite(new URL(req.url).searchParams.get('siteId'));
    if (!site) return NextResponse.json({error:'Select an allowlisted site'}, {status:400});
    const products = await getProducts(site.id);
    return NextResponse.json({products, count:products.length, site});
  } catch(e) {return fail(e);}
}
