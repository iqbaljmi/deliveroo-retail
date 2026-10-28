const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const A = '718446';
const B = '793664';
const barcode = '0001234567890';
const json = value => Response.json(value);

// Execute the actual TS modules with isolated environment variables and fetch.
// Every HTTP request is intercepted; these tests cannot reach live Deliveroo.
function modules(fetch, overrides = {}) {
  const cache = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, fetch, Buffer, URL, URLSearchParams, Request, Response, FormData, File, Error, console,
      process: { env: { DELIVEROO_CLIENT_ID: 'mock-client', DELIVEROO_CLIENT_SECRET: 'mock-secret', DELIVEROO_BRAND_ID: 'production-brand-from-env', DELIVEROO_SITE_ID: 'ignored-legacy-site' } },
      require(name) {
        if (name in overrides) return overrides[name];
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        return require(name);
      },
    }, { filename: file });
    return module.exports;
  }
  return load;
}

function workbook(siteId = A, metadataSite = siteId, rows = [[siteId, barcode, 'Unavailable']]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Site ID', 'Barcode', 'Status'], ...rows]), 'Availability');
  if (metadataSite !== null) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Site ID'], [metadataSite]]), 'Store');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

function backend(overrides = {}) {
  const calls = [];
  const stock = new Map(overrides.initialStock ?? []);
  const upstream = async (url, options = {}) => {
    url = String(url);
    calls.push({ url, method: options.method ?? 'GET', body: options.body });
    if (url === 'https://auth.developers.deliveroo.com/oauth2/token') return json({ access_token: 'mock-token', expires_in: 3600 });
    const match = url.match(/^https:\/\/api\.developers\.deliveroo\.com\/menu\/v2\/brands\/production-brand-from-env\/sites\/(\d+)\/menu(\/item_unavailabilities)?$/);
    assert.ok(match, 'Unexpected upstream request: ' + url);
    const site = match[1];
    if (!match[2]) return json({ menu: { items: overrides.products ?? [{ id: 'item-' + site, name: { en: 'Product ' + site }, barcodes: [barcode, 'alias'], plu: 'PLU-1' }] } });
    if (options.method === 'POST') {
      if (!overrides.ignoreWrites) {
        const merged = new Map((stock.get(site) ?? []).map(row => [row.item_id, row]));
        for (const row of JSON.parse(options.body).item_unavailabilities) merged.set(row.item_id, row);
        stock.set(site, [...merged.values()]);
      }
      return new Response(null, { status: 204 });
    }
    if (overrides.failAvailability) return new Response('{"error":"Availability unavailable"}', { status: 503 });
    if (overrides.failVerification && calls.some(call => call.method === 'POST' && call.url.includes('/menu/'))) return new Response('{"error":"Verification unavailable"}', { status: 503 });
    const updates = stock.get(site) ?? [];
    return json({ unavailable_ids: updates.filter(x => x.status === 'unavailable').map(x => x.item_id), hidden_ids: updates.filter(x => x.status === 'hidden').map(x => x.item_id) });
  };
  let load;
  const fetch = async (url, options = {}) => {
    if (!String(url).startsWith('/')) return upstream(url, options);
    const pathname = new URL(url, 'http://test').pathname;
    const route = load('app' + pathname + '/route.ts');
    return route[options.method ?? 'GET'](new Request('http://test' + url, options));
  };
  load = modules(overrides.fetch ?? fetch, overrides.modules);
  return { load, calls, fetch, stock, writes: () => calls.filter(x => x.method === 'POST' && x.url.includes('/menu/')) };
}

function importRequest(siteId, data = workbook(siteId), name = 'availability.xlsx') {
  const form = new FormData();
  form.set('siteId', siteId);
  form.set('file', new File([data], name));
  return new Request('http://test/api/import', { method: 'POST', body: form });
}

function updateRequest(body) {
  return new Request('http://test/api/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('all 15 stores use their own Site ID and the environment Brand ID', async () => {
  const app = backend();
  const { SITES, getSite } = app.load('lib/sites.ts');
  assert.equal(SITES.length, 15);
  assert.equal(new Set(SITES.map(x => x.id)).size, 15);
  assert.equal(getSite('778414').name, 'K- Secret | MOE');
  for (const site of SITES) {
    for (const endpoint of ['products', 'availability']) {
      const response = await app.load('app/api/' + endpoint + '/route.ts').GET(new Request('http://test/api/' + endpoint + '?siteId=' + site.id));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).site.id, site.id);
      assert.ok(app.calls.at(-1).url.includes('/brands/production-brand-from-env/sites/' + site.id + '/menu'));
    }
  }
  assert.equal(app.writes().length, 0);
});

test('invalid or missing sites are rejected before any upstream request', async () => {
  const app = backend();
  for (const endpoint of ['products', 'availability']) {
    for (const query of ['', '?siteId=999999', '?siteId=..%2F718446', '?siteId=']) {
      const response = await app.load('app/api/' + endpoint + '/route.ts').GET(new Request('http://test/api/' + endpoint + query));
      assert.equal(response.status, 400);
    }
  }
  assert.equal((await app.load('app/api/import/route.ts').POST(importRequest('999999'))).status, 400);
  assert.equal(app.calls.length, 0);
});

test('backend imports same-store Excel and preserves leading-zero barcodes', async () => {
  const app = backend();
  const response = await app.load('app/api/import/route.ts').POST(importRequest(A));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.site.id, A);
  assert.equal(data.source[0].barcode, barcode);
  assert.equal(data.products[0].id, 'item-' + A);
  assert.equal(data.invalid, 0);
  assert.equal(app.writes().length, 0);
});

test('wrong-store, mixed-store, missing IDs and conflicting Store metadata are rejected', async () => {
  const app = backend();
  const route = app.load('app/api/import/route.ts');
  for (const data of [workbook(B), workbook(A, B), workbook(A, A, [[A, barcode, 'available'], [B, barcode, 'hidden']]), workbook(A, null, [['', barcode, 'available']])]) {
    assert.equal((await route.POST(importRequest(A, data))).status, 400);
  }
  assert.equal(app.calls.length, 0, 'Reject store mismatches before fetching catalogues');
});

test('imports validate unknown products, invalid statuses and duplicate aliases', async () => {
  const app = backend();
  const response = await app.load('app/api/import/route.ts').POST(importRequest(A, workbook(A, A, [[A, barcode, 'Available'], [A, 'alias', 'hidden'], [A, 'unknown', 'available'], [A, 'PLU-1', 'invalid']])));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).invalid, 3);
  const { validateImportRows } = app.load('lib/availability.ts');
  const product = { id: 'one', barcodes: [barcode], plu: 'PLU-1' };
  const rows = validateImportRows([{ siteId: A, barcode: 'PLU-1', rawStatus: 'in stock' }], [product], A);
  assert.equal(rows[0].status, 'available');
  assert.equal(rows[0].error, '');
});

test('bad files, excessive row counts and malformed update JSON return 400', async () => {
  const app = backend();
  const route = app.load('app/api/import/route.ts');
  for (const request of [importRequest(A, workbook(), 'wrong.csv'), importRequest(A, new ArrayBuffer(0)), importRequest(A, new ArrayBuffer(4 * 1024 * 1024 + 1)), importRequest(A, workbook(A, null, Array.from({ length: 10001 }, () => [A, barcode, 'hidden'])))]) {
    assert.equal((await route.POST(request)).status, 400);
  }
  assert.equal((await app.load('app/api/update/route.ts').POST(new Request('http://test/api/update', { method: 'POST', body: '{broken' }))).status, 400);
  assert.equal(app.calls.length, 0);
});

test('update rejects cross-store source and foreign products without a stock POST', async () => {
  const app = backend();
  const route = app.load('app/api/update/route.ts');
  for (const body of [null, { siteId: '999999' }, { siteId: A, sourceSiteId: B, updates: [{ item_id: 'item-' + A, status: 'hidden' }] }, { siteId: A, sourceSiteId: A, updates: [{ item_id: 'item-' + B, status: 'available' }] }, { siteId: A, sourceSiteId: A, updates: [{ item_id: 'item-' + A, status: 'hidden' }, { item_id: 'item-' + A, status: 'available' }] }]) {
    assert.equal((await route.POST(updateRequest(body))).status, 400);
  }
  assert.equal(app.writes().length, 0);
});

test('mocked submissions target the selected store and verify every supported status', async () => {
  const app = backend();
  for (const status of ['available', 'unavailable', 'hidden']) {
    const response = await app.load('app/api/update/route.ts').POST(updateRequest({ siteId: B, sourceSiteId: B, updates: [{ item_id: 'item-' + B, status }] }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.site.id, B);
    assert.equal(result.verified, true);
    if (status === 'available') {
      assert.equal(result.submitted, 0);
      assert.equal(app.writes().length, 0);
      continue;
    }
    const write = app.writes().at(-1);
    assert.ok(write.url.includes('/sites/' + B + '/menu/item_unavailabilities'));
    assert.deepEqual(JSON.parse(write.body), { item_unavailabilities: [{ item_id: 'item-' + B, status }] });
  }
});

// A small hook harness exercises the actual page handlers without a browser or API account.
function pageHarness(fetchOverride) {
  const hooks = [];
  let cursor = 0;
  const exports = [];
  const react = {
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return hooks[index] ?? (hooks[index] = { current: initial }); },
    useMemo(fn) { cursor++; return fn(); },
  };
  const jsx = (type, props) => ({ type, props });
  const app = backend({ modules: { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, xlsx: { ...XLSX, writeFile: (book, name) => exports.push({ book, name }) } } });
  const load = modules(fetchOverride ?? app.fetch, { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, xlsx: { ...XLSX, writeFile: (book, name) => exports.push({ book, name }) } });
  const Page = load('app/page.tsx').default;
  let tree;
  function render() { cursor = 0; tree = Page(); return tree; }
  function nodes(node) { if (!arguments.length) node = tree; if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child))]; }
  function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return [node.props?.children].flat(Infinity).map(text).join(''); }
  function button(label) { return nodes().find(node => node.type === 'button' && text(node).includes(label)); }
  function select(id) { nodes().find(node => node.props?.id === 'site-select').props.onChange({ target: { value: id } }); render(); }
  async function flush() { await new Promise(setImmediate); await new Promise(setImmediate); render(); }
  async function upload(data = workbook(A)) { nodes().find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [new File([data], 'stock.xlsx')] }, currentTarget: { value: 'stock.xlsx' } }); await flush(); }
  render();
  return { app, exports, render, nodes, text: () => text(tree), button, select, flush, upload };
}

test('page scopes sync, Excel exports and imports; switching clears pending review and availability', async () => {
  const page = pageHarness();
  assert.equal(page.button('Sync Products').props.disabled, true);
  page.select(A);
  await page.button('Sync Products').props.onClick(); page.render();
  page.button('Export Products to Excel').props.onClick();
  const exported = page.exports[0];
  assert.ok(exported.name.includes(A));
  assert.equal(exported.book.Sheets.Availability.C2.t, 's');
  assert.equal(exported.book.Sheets.Availability.C2.v, barcode);
  assert.equal(exported.book.Sheets.Store.A2.v, A);
  await page.upload();
  assert.ok(page.text().includes('1 valid'));
  assert.ok(page.text().includes('stock.xlsx'));
  page.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); page.render();
  assert.equal(page.button('Submit 1 updates').props.disabled, false);
  page.select(B);
  assert.ok(!page.text().includes('stock.xlsx'));
  assert.ok(!page.text().includes('3. Review'));
  assert.equal(page.button('Export Products to Excel').props.disabled, true);
  assert.equal(page.button('Choose an Excel').props.disabled, true);
  await page.button('Sync Products').props.onClick(); page.render();
  await page.upload(workbook(A));
  assert.ok(page.text().includes('does not match') || page.text().includes('not selected Site ID'));
  assert.ok(!page.text().includes('3. Review'));
  assert.equal(page.app.writes().length, 0);
});

test('a late import response cannot restore another store upload after switching away and back', async () => {
  let resolveImport;
  const api = backend();
  const page = pageHarness((url, options) => url === '/api/import' ? new Promise(resolve => { resolveImport = resolve; }) : api.fetch(url, options));
  page.select(A); await page.button('Sync Products').props.onClick(); page.render();
  await page.upload();
  assert.ok(page.text().includes('Validating spreadsheet'));
  page.select(B); page.select(A);
  resolveImport(json({ site: { id: A }, products: [], source: [{ siteId: A, barcode, rawStatus: 'hidden' }] }));
  await page.flush();
  assert.ok(!page.text().includes('stock.xlsx'));
  assert.ok(!page.text().includes('3. Review'));
  assert.equal(page.button('Export Products to Excel').props.disabled, true);
});

test('a late sync response cannot replace the newly selected store catalogue', async () => {
  const pending = [];
  const api = backend();
  const page = pageHarness((url, options) => url.includes('siteId=' + A) ? new Promise(resolve => pending.push({ url, resolve })) : api.fetch(url, options));
  page.select(A);
  const firstSync = page.button('Sync Products').props.onClick();
  page.select(B);
  await page.button('Sync Products').props.onClick(); page.render();
  for (const request of pending) request.resolve(await api.fetch(request.url));
  await firstSync; page.render();
  page.button('Export Products to Excel').props.onClick();
  assert.equal(page.exports[0].book.Sheets.Store.A2.v, B);
  assert.equal(page.exports[0].book.Sheets.Availability.D2.v, 'Product ' + B);
});

test('page submits the reviewed store and locks selection until mocked verification completes', async () => {
  const page = pageHarness();
  page.select(A);
  await page.button('Sync Products').props.onClick(); page.render();
  await page.upload();
  page.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); page.render();
  const submit = page.button('Submit 1 updates').props.onClick(); page.render();
  assert.equal(page.nodes().find(node => node.props?.id === 'site-select').props.disabled, true);
  await submit; page.render();
  assert.equal(page.app.writes().length, 1);
  assert.ok(page.app.writes()[0].url.includes('/sites/' + A + '/menu/'));
  assert.ok(page.text().includes('verification matched'));
  assert.equal(page.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
});

test('HTTP helper reports plain-text/HTML server failures and preserves API JSON errors', async () => {
  for (const [body, status, message] of [['Internal Server Error', 500, /HTTP 500.*Restart/], ['<html>Not found</html>', 404, /HTTP 404/], ['Authentication required', 401, /sign in again/], [JSON.stringify({ error: 'Deliveroo authentication failed' }), 502, /Deliveroo authentication failed/]]) {
    const { fetchJson } = modules(async () => new Response(body, { status }))('lib/client-http.ts');
    await assert.rejects(fetchJson('/api/products?siteId=' + A), message);
  }
});

test('missing Deliveroo store explains the configured Brand ID and store assignment', async () => {
  const failing = modules(async url => String(url).includes('/oauth2/token') ? json({ access_token: 'mock-token' }) : new Response('{"error":"site not found"}', { status: 404 }));
  await assert.rejects(failing('lib/deliveroo.ts').getProducts(A), /Site ID 718446.*production-brand-from-env.*DELIVEROO_BRAND_ID/);
});

test('delta planner separates changes, matches and protected hidden products', () => {
  const { planAvailabilityUpdates } = modules(async () => { throw new Error('Unexpected network'); })('lib/availability.ts');
  const updates = [{ item_id: 'a', status: 'available' }, { item_id: 'b', status: 'unavailable' }, { item_id: 'c', status: 'available' }, { item_id: 'd', status: 'hidden' }];
  const current = { unavailable_ids: ['a', 'b'], hidden_ids: ['c', 'untouched'] };
  const plan = planAvailabilityUpdates(updates, current);
  assert.equal(plan.changed.length, 2); assert.equal(plan.unchanged, 1); assert.equal(plan.protected, 1);
  assert.equal(planAvailabilityUpdates(updates, current, true).changed.length, 3);
});

test('all nine status transitions are classified correctly', () => {
  const { planAvailabilityUpdates } = modules(async () => { throw new Error('Unexpected network'); })('lib/availability.ts');
  for (const current of ['available', 'unavailable', 'hidden']) {
    for (const desired of ['available', 'unavailable', 'hidden']) {
      const stock = { unavailable_ids: current === 'unavailable' ? ['one'] : [], hidden_ids: current === 'hidden' ? ['one'] : [] };
      const plan = planAvailabilityUpdates([{ item_id: 'one', status: desired }], stock);
      assert.equal(plan.comparisons[0].action, current === desired ? 'unchanged' : current === 'hidden' ? 'protected' : 'changed');
      const explicit = planAvailabilityUpdates([{ item_id: 'one', status: desired }], stock, true);
      assert.equal(explicit.changed.length, current === desired ? 0 : 1);
    }
  }
});

test('backend skips matches, protects hidden products and leaves omitted products untouched', async () => {
  const app = backend({
    products: ['a', 'b', 'c', 'd', 'omitted'].map(id => ({ id, barcodes: [id] })),
    initialStock: [[A, [{ item_id: 'b', status: 'unavailable' }, { item_id: 'c', status: 'hidden' }, { item_id: 'omitted', status: 'hidden' }]]],
  });
  const response = await app.load('app/api/update/route.ts').POST(updateRequest({
    siteId: A, sourceSiteId: A,
    updates: [{ item_id: 'a', status: 'available' }, { item_id: 'b', status: 'unavailable' }, { item_id: 'c', status: 'available' }, { item_id: 'd', status: 'hidden' }],
  }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.requested, 4); assert.equal(data.submitted, 1); assert.equal(data.unchanged, 2); assert.equal(data.protected, 1);
  assert.equal(data.verified, true);
  assert.deepEqual(JSON.parse(app.writes()[0].body), { item_unavailabilities: [{ item_id: 'd', status: 'hidden' }] });
  assert.ok(data.availability.hidden_ids.includes('c'));
  assert.ok(data.availability.hidden_ids.includes('omitted'));
});

test('repeating the same upload sends no second stock POST', async () => {
  const app = backend();
  const route = app.load('app/api/update/route.ts');
  const body = { siteId: A, sourceSiteId: A, updates: [{ item_id: 'item-' + A, status: 'unavailable' }] };
  assert.equal((await (await route.POST(updateRequest(body))).json()).submitted, 1);
  const repeated = await (await route.POST(updateRequest(body))).json();
  assert.equal(repeated.submitted, 0); assert.equal(repeated.unchanged, 1);
  assert.equal(app.writes().length, 1);
});

test('backend requires explicit boolean permission before unhiding', async () => {
  const app = backend({ initialStock: [[A, [{ item_id: 'item-' + A, status: 'hidden' }]]] });
  const route = app.load('app/api/update/route.ts');
  const body = { siteId: A, sourceSiteId: A, updates: [{ item_id: 'item-' + A, status: 'available' }] };
  const kept = await (await route.POST(updateRequest(body))).json();
  assert.equal(kept.submitted, 0); assert.equal(kept.protected, 1);
  assert.equal(app.writes().length, 0);
  assert.equal((await route.POST(updateRequest({ ...body, allowUnhide: 'false' }))).status, 400);
  const allowed = await (await route.POST(updateRequest({ ...body, allowUnhide: true }))).json();
  assert.equal(allowed.submitted, 1); assert.equal(allowed.verified, true);
});

test('failure to read live availability prevents stock writes', async () => {
  const app = backend({ failAvailability: true });
  const response = await app.load('app/api/update/route.ts').POST(updateRequest({ siteId: A, sourceSiteId: A, updates: [{ item_id: 'item-' + A, status: 'hidden' }] }));
  assert.equal(response.status, 502);
  assert.equal(app.writes().length, 0);
});

test('verification mismatches are reported accurately', async () => {
  const app = backend({ ignoreWrites: true });
  const response = await app.load('app/api/update/route.ts').POST(updateRequest({ siteId: A, sourceSiteId: A, updates: [{ item_id: 'item-' + A, status: 'unavailable' }] }));
  const data = await response.json();
  assert.equal(data.submitted, 1); assert.equal(data.verified, false);
  assert.ok(data.message.includes('does not yet match'));
});

test('verification failures report accepted writes and require resync', async () => {
  const app = backend({ failVerification: true });
  const response = await app.load('app/api/update/route.ts').POST(updateRequest({ siteId: A, sourceSiteId: A, updates: [{ item_id: 'item-' + A, status: 'unavailable' }] }));
  const data = await response.json();
  assert.equal(data.submitted, 1); assert.equal(data.verified, null); assert.equal(data.availability, null);
  assert.ok(data.message.includes('sync again'));
});

test('page disables submission when the entire file already matches', async () => {
  const page = pageHarness();
  page.select(A); await page.button('Sync Products').props.onClick(); page.render();
  await page.upload(workbook(A, A, [[A, barcode, 'available']]));
  assert.ok(page.text().includes('0 changed')); assert.ok(page.text().includes('1 unchanged'));
  assert.ok(page.text().includes('Unchanged - skipped'));
  assert.equal(page.button('Submit 0 updates').props.disabled, true);
  assert.equal(page.app.writes().length, 0);
});

test('page requires a separate unhide choice and resets review confirmation', async () => {
  const api = backend({ initialStock: [[A, [{ item_id: 'item-' + A, status: 'hidden' }]]] });
  const page = pageHarness(api.fetch);
  page.select(A); await page.button('Sync Products').props.onClick(); page.render();
  await page.upload(workbook(A, A, [[A, barcode, 'available']]));
  assert.ok(page.text().includes('1 hidden kept'));
  assert.equal(page.button('Submit 0 updates').props.disabled, true);
  page.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); page.render();
  assert.ok(page.text().includes('1 changed'));
  const checkboxes = page.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(checkboxes.at(-1).props.checked, false);
  checkboxes.at(-1).props.onChange({ target: { checked: true } }); page.render();
  await page.button('Submit 1 updates').props.onClick(); page.render();
  assert.equal(api.writes().length, 1);
  assert.ok(page.text().includes('0 changed'));
});

test('page sends only reviewed changes when previously unchanged rows drift', async () => {
  const api = backend({ products: [{ id: 'first', barcodes: [barcode] }, { id: 'second', barcodes: ['SECOND'] }] });
  const page = pageHarness(api.fetch);
  page.select(A); await page.button('Sync Products').props.onClick(); page.render();
  await page.upload(workbook(A, A, [[A, barcode, 'unavailable'], [A, 'SECOND', 'available']]));
  assert.ok(page.text().includes('1 changed')); assert.ok(page.text().includes('1 unchanged'));
  api.stock.set(A, [{ item_id: 'second', status: 'unavailable' }]);
  page.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); page.render();
  await page.button('Submit 1 updates').props.onClick(); page.render();
  assert.deepEqual(JSON.parse(api.writes()[0].body), { item_unavailabilities: [{ item_id: 'first', status: 'unavailable' }] });
  assert.ok(api.stock.get(A).some(row => row.item_id === 'second' && row.status === 'unavailable'));
});

test('backend drops reviewed changes that already match at submission time', async () => {
  const app = backend({ initialStock: [[A, [{ item_id: 'item-' + A, status: 'unavailable' }]]] });
  const response = await app.load('app/api/update/route.ts').POST(updateRequest({ siteId: A, sourceSiteId: A, updates: [{ item_id: 'item-' + A, status: 'unavailable' }] }));
  const data = await response.json();
  assert.equal(data.submitted, 0); assert.equal(data.unchanged, 1);
  assert.equal(app.writes().length, 0);
});
