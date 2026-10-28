import { NextResponse } from 'next/server';
import { getAvailability, getProducts, updateAvailability } from '@/lib/deliveroo';
import { planAvailabilityUpdates, type AvailabilityUpdate } from '@/lib/availability';
import { fail } from '@/lib/http';
import { getSite } from '@/lib/sites';

export const dynamic = 'force-dynamic';
const valid = new Set(['available', 'unavailable', 'hidden']);

export async function POST(req: Request) {
  try {
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
    const site = getSite(body.siteId);
    if (!site) return NextResponse.json({ error: 'Select an allowlisted site' }, { status: 400 });
    if (body.sourceSiteId !== site.id) return NextResponse.json({ error: 'The imported Excel store does not match the selected store. Import the correct store file.' }, { status: 400 });
    if (body.allowUnhide !== undefined && typeof body.allowUnhide !== 'boolean') return NextResponse.json({ error: 'Invalid hidden-product option' }, { status: 400 });
    if (!Array.isArray(body.updates) || !body.updates.length || body.updates.length > 10000) return NextResponse.json({ error: 'Provide 1-10,000 updates' }, { status: 400 });
    if (body.updates.some((x: unknown) => !x || typeof x !== 'object' || typeof (x as { item_id?: unknown }).item_id !== 'string' || !valid.has((x as { status: string }).status))) return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
    const updates = body.updates as AvailabilityUpdate[];
    const ids = updates.map(x => x.item_id);
    if (new Set(ids).size !== ids.length) return NextResponse.json({ error: 'Duplicate product IDs in request' }, { status: 400 });

    const products = await getProducts(site.id);
    const known = new Set(products.map(x => x.id));
    const unknown = ids.filter(id => !known.has(id));
    if (unknown.length) return NextResponse.json({ error: 'Unknown product IDs: ' + unknown.slice(0, 10).join(', ') }, { status: 400 });

    // Fail closed if live availability cannot be read. The browser snapshot may be stale.
    const current = await getAvailability(site.id);
    const plan = planAvailabilityUpdates(updates, current, body.allowUnhide === true);
    const counts = { requested: updates.length, submitted: plan.changed.length, unchanged: plan.unchanged, protected: plan.protected };
    if (!plan.changed.length) {
      return NextResponse.json({ success: true, ...counts, verified: true, verificationError: null, availability: current, site, message: 'No stock changes sent. Products already match or are kept hidden.' });
    }

    // Individual updates leave omitted products untouched.
    await updateAvailability(site.id, plan.changed);
    let verification: typeof current | null = null;
    let verified: boolean | null = null;
    let verificationError: string | null = null;
    try {
      verification = await getAvailability(site.id);
      verified = planAvailabilityUpdates(plan.changed, verification, true).changed.length === 0;
    } catch (error) {
      verificationError = error instanceof Error ? error.message : 'Verification unavailable';
    }
    return NextResponse.json({
      success: true, ...counts, verified, verificationError, availability: verification, site,
      message: verified === true ? 'Deliveroo accepted the changed products and verification matched.' : verified === false ? 'Deliveroo accepted the changed products but verification does not yet match.' : 'Deliveroo accepted the changed products; sync again to verify availability.',
    });
  } catch (error) { return fail(error); }
}
