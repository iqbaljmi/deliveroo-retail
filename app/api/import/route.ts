import { NextResponse } from 'next/server';
import { getAvailability, getProducts } from '@/lib/deliveroo';
import { parseAvailabilityWorkbook } from '@/lib/availability-import';
import { validateImportRows } from '@/lib/availability';
import { getSite } from '@/lib/sites';
import { fail } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let site;
  let source;
  try {
    const form = await req.formData();
    site = getSite(form.get('siteId'));
    if (!site) return NextResponse.json({ error: 'Select an allowlisted site' }, { status: 400 });
    const file = form.get('file');
    if (!(file instanceof File) || !/\.xlsx?$/i.test(file.name)) {
      return NextResponse.json({ error: 'Upload an .xlsx or .xls file' }, { status: 400 });
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Upload a nonempty Excel file (maximum 5MB)' }, { status: 400 });
    }
    source = parseAvailabilityWorkbook(await file.arrayBuffer(), site.id);
  } catch (error) {
    return fail(error, 400);
  }
  try {
    const [products, availability] = await Promise.all([getProducts(site.id), getAvailability(site.id)]);
    const rows = validateImportRows(source, products, site.id);
    return NextResponse.json({ site, products, source, availability, invalid: rows.filter(row => row.error).length });
  } catch (error) {
    return fail(error);
  }
}
