export const SESSION_COOKIE = 'deliveroo_retail_session';
export const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

export function authConfigured(): boolean {
  return Boolean(process.env.APP_USER && process.env.APP_PASSWORD);
}
async function signingKey() {
  if (!authConfigured()) throw new Error('Login is not configured on the server.');
  return crypto.subtle.importKey('raw', encoder.encode('deliveroo-retail/session/v1:' + process.env.APP_USER + ':' + process.env.APP_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
}
export async function credentialsMatch(user: string, password: string): Promise<boolean> {
  if (!authConfigured()) return false;
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([user, password]))),
    crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([process.env.APP_USER, process.env.APP_PASSWORD]))),
  ]);
  const a = new Uint8Array(actual); const b = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}
export async function createSession(now = Date.now()): Promise<string> {
  const issued = Math.floor(now / 1000);
  const payload = encode(encoder.encode(JSON.stringify({ user: process.env.APP_USER, issued, expires: issued + SESSION_SECONDS, audience: 'deliveroo-retail' })));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(payload));
  return payload + '.' + encode(new Uint8Array(signature));
}
export async function verifySession(token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!authConfigured() || !token || token.length > 2048) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
    if (!await crypto.subtle.verify('HMAC', await signingKey(), decode(parts[1]) as BufferSource, encoder.encode(parts[0]))) return null;
    const session = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const seconds = Math.floor(now / 1000);
    return session.audience === 'deliveroo-retail' && session.user === process.env.APP_USER &&
      Number.isInteger(session.issued) && Number.isInteger(session.expires) &&
      session.issued <= seconds + 60 && session.expires > seconds &&
      session.expires - session.issued === SESSION_SECONDS ? session.user : null;
  } catch { return null; }
}
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}
