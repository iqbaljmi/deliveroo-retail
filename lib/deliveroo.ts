import { getSite } from '@/lib/sites';

const API = 'https://api.developers.deliveroo.com/menu/v2';
const AUTH = 'https://auth.developers.deliveroo.com/oauth2/token';
export type Product = { id: string; name: string; barcode: string; barcodes: string[]; plu: string; price: number | null };
export type Status = 'available' | 'unavailable' | 'hidden';
let tokenCache: { token: string; until: number } | null = null;
function config() {
  const id = process.env.DELIVEROO_CLIENT_ID;
  const secret = process.env.DELIVEROO_CLIENT_SECRET;
  const brand = process.env.DELIVEROO_BRAND_ID;
  if (!id || !secret || !brand) throw new Error('Deliveroo environment variables are missing.');
  if (!/^[\w-]+$/.test(brand)) throw new Error('Invalid Deliveroo brand configuration.');
  return { id, secret, brand };
}
function allowedSite(siteId: string) {
  const site = getSite(siteId);
  if (!site) throw new Error('The selected Deliveroo site is not allowlisted.');
  return site;
}
async function token(force = false) {
  if (!force && tokenCache && tokenCache.until > Date.now()) return tokenCache.token;
  const { id, secret } = config();
  const res = await fetch(AUTH, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'client_credentials' }), cache: 'no-store' });
  if (!res.ok) throw new Error(`Deliveroo authentication failed (HTTP ${res.status}). Check API credentials.`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Deliveroo did not return an access token');
  tokenCache = { token: json.access_token, until: Date.now() + Math.max(30, Number(json.expires_in || 300) - 30) * 1000 };
  return tokenCache.token;
}
async function request(siteId: string, path: string, options: RequestInit = {}) {
  const { brand } = config();
  const site = allowedSite(siteId);
  const url = `${API}/brands/${brand}/sites/${site.id}/menu${path}`;
  let access = await token();
  let res = await fetch(url, { ...options, headers: { Accept: 'application/json', Authorization: `Bearer ${access}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
  if (res.status === 401) {
    access = await token(true);
    res = await fetch(url, { ...options, headers: { Accept: 'application/json', Authorization: `Bearer ${access}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
  }
  const raw = await res.text();
  let data: unknown = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (res.status === 404) throw new Error(`Deliveroo could not find ${site.name} (Site ID ${site.id}) under Brand ID ${brand}. Check the production DELIVEROO_BRAND_ID and this store's assignment in Deliveroo. Details: ${JSON.stringify(data).slice(0, 500)}`);
  if (!res.ok) throw new Error(`Deliveroo HTTP ${res.status}: ${JSON.stringify(data).slice(0, 800)}`);
  return data;
}
export async function getProducts(siteId: string): Promise<Product[]> {
  const data = await request(siteId, '') as { menu?: { items?: Array<Record<string, unknown>> } };
  const items = data?.menu?.items;
  if (!Array.isArray(items)) throw new Error('Unexpected Deliveroo Get Menu format (menu.items missing).');
  return items.filter(x => x && typeof x.id === 'string').map(x => ({
    id: String(x.id), name: String((x.name as {en?:string} | undefined)?.en || x.operational_name || x.id),
    barcodes: Array.isArray(x.barcodes) ? x.barcodes.map(String).filter(Boolean) : [],
    barcode: Array.isArray(x.barcodes) && x.barcodes.length ? String(x.barcodes[0]) : '',
    plu: String(x.plu || ''), price: typeof (x.price_info as {price?:unknown} | undefined)?.price === 'number' ? Number((x.price_info as {price:number}).price) / 100 : null
  }));
}
export async function getAvailability(siteId: string) {
  const result = await request(siteId, '/item_unavailabilities') as { unavailable_ids?: string[] | null; hidden_ids?: string[] | null };
  return { unavailable_ids: result?.unavailable_ids || [], hidden_ids: result?.hidden_ids || [] };
}
export async function updateAvailability(siteId: string, items: Array<{item_id:string;status:Status}>) {
  await request(siteId, '/item_unavailabilities', { method: 'POST', body: JSON.stringify({ item_unavailabilities: items }) });
}
