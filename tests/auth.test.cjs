const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const { NextRequest } = require('next/server');
const root = path.resolve(__dirname, '..');

function authModules(env = { APP_USER: 'test-admin', APP_PASSWORD: 'only-a-test-password' }) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const module = { exports: {} };
    cache.set(relative, module);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, process: { env }, crypto: webcrypto,
      TextEncoder, TextDecoder, Uint8Array, btoa, atob, Buffer, URL, Request, Response, Error,
      require: name => name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    }, { filename: relative });
    return module.exports;
  }
  return { load, env };
}

test('existing credentials accept only the configured username and password', async () => {
  const { load } = authModules(); const auth = load('lib/auth.ts');
  assert.equal(await auth.credentialsMatch('test-admin', 'only-a-test-password'), true);
  assert.equal(await auth.credentialsMatch('wrong', 'only-a-test-password'), false);
  assert.equal(await auth.credentialsMatch('test-admin', 'wrong'), false);
});

test('signed sessions reject tampering, expiration and credential changes', async () => {
  const { load, env } = authModules(); const auth = load('lib/auth.ts');
  const token = await auth.createSession(100000);
  assert.equal(await auth.verifySession(token, 100000), 'test-admin');
  assert.equal(await auth.verifySession(token + 'broken', 100000), null);
  const [payload, signature] = token.split('.');
  const changed = Buffer.from(JSON.stringify({ user: 'another-user', issued: 100, expires: 999999999, audience: 'deliveroo-retail' })).toString('base64url');
  assert.equal(await auth.verifySession(changed + '.' + signature, 100000), null);
  assert.equal(await auth.verifySession(token, 100000 + auth.SESSION_SECONDS * 1000), null);
  env.APP_PASSWORD = 'changed-password';
  assert.equal(await auth.verifySession(token, 100000), null);
});

test('page requests redirect to login and unauthenticated APIs return JSON 401', async () => {
  const { load } = authModules(); const middleware = load('middleware.ts').middleware;
  const page = await middleware(new NextRequest('http://localhost:3000/'));
  assert.equal(page.status, 307); assert.equal(page.headers.get('location'), 'http://localhost:3000/login');
  const api = await middleware(new NextRequest('http://localhost:3000/api/products?siteId=718446'));
  assert.equal(api.status, 401); assert.ok(api.headers.get('content-type').includes('application/json'));
  assert.equal(api.headers.has('www-authenticate'), false);
  const basic = await middleware(new NextRequest('http://localhost:3000/', { headers: { Authorization: 'Basic ' + Buffer.from('test-admin:only-a-test-password').toString('base64') } }));
  assert.equal(basic.status, 307);
});

test('valid session allows protected routes and redirects away from login', async () => {
  const { load } = authModules(); const auth = load('lib/auth.ts');
  const token = await auth.createSession();
  const headers = { cookie: auth.SESSION_COOKIE + '=' + token };
  const middleware = load('middleware.ts').middleware;
  const response = await middleware(new NextRequest('http://localhost:3000/api/products', { headers }));
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.ok(response.headers.get('cache-control').includes('no-store'));
  const login = await middleware(new NextRequest('http://localhost:3000/login', { headers }));
  assert.equal(login.status, 307); assert.equal(login.headers.get('location'), 'http://localhost:3000/');
});

test('login page is public and cross-origin writes are rejected', async () => {
  const { load } = authModules(); const middleware = load('middleware.ts').middleware;
  assert.equal((await middleware(new NextRequest('http://localhost:3000/login'))).headers.get('x-middleware-next'), '1');
  const response = await middleware(new NextRequest('http://localhost:3000/api/update', { method: 'POST', headers: { origin: 'https://other-site.example' } }));
  assert.equal(response.status, 403);
});

test('login sets an HttpOnly cookie usable on localhost and rejects invalid login data', async () => {
  const { load } = authModules(); const login = load('app/api/auth/login/route.ts').POST;
  const request = (body, url = 'http://localhost:3000/api/auth/login') => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: new URL(url).origin }, body: JSON.stringify(body) });
  assert.equal((await login(request({ username: 'test-admin', password: 'wrong' }))).status, 401);
  assert.equal((await login(request(null))).status, 400);
  const response = await login(request({ username: 'test-admin', password: 'only-a-test-password' }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie.includes('HttpOnly')); assert.ok(cookie.includes('SameSite=lax'));
  assert.ok(!cookie.includes('Secure')); assert.ok(!cookie.includes('only-a-test-password'));
  const secure = await login(request({ username: 'test-admin', password: 'only-a-test-password' }, 'https://stock.example/api/auth/login'));
  assert.ok(secure.headers.get('set-cookie').includes('Secure'));
});

test('logout expires the session cookie and rejects cross-origin requests', async () => {
  const { load } = authModules(); const logout = load('app/api/auth/logout/route.ts').POST;
  const response = await logout(new Request('http://localhost:3000/api/auth/logout', { method: 'POST' }));
  assert.equal(response.status, 200); assert.ok(response.headers.get('set-cookie').includes('Max-Age=0'));
  const rejected = await logout(new Request('http://localhost:3000/api/auth/logout', { method: 'POST', headers: { origin: 'https://other.example' } }));
  assert.equal(rejected.status, 403);
});

test('missing server credentials fail closed', async () => {
  const { load } = authModules({});
  const response = await load('middleware.ts').middleware(new NextRequest('http://localhost:3000/'));
  assert.equal(response.status, 503);
  assert.equal(await load('lib/auth.ts').verifySession('invalid'), null);
});
