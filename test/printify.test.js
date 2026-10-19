// Run with: npm test   (Node's built-in test runner; no network, fetch is mocked)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printify-test-'));
process.env.DATA_DIR = tmp;
process.env.PRINTIFY_PIPELINE_ENABLED = 'true';
process.env.PRINTIFY_API_TOKEN = 'test-token';
process.env.PRINTIFY_SHOP_ID = '999';
process.env.PRINTIFY_TEMPLATES = 'ceramic,metal';

const sharp = (await import('sharp')).default;
const { buildProductFromTemplate, printifyRequest } = await import('../src/printify.js');
const { pushOrderToPrintify, TEMPLATES } = await import('../src/printify-pipeline.js');
const { saveOrder, getOrder, outputDir } = await import('../src/store.js');

const template = {
  id: 'tpl1',
  blueprint_id: 1599,
  print_provider_id: 99,
  variants: [
    { id: 1, price: 2499, is_enabled: true },
    { id: 2, price: 2499, is_enabled: false },
  ],
  print_areas: [
    {
      variant_ids: [1, 2],
      placeholders: [
        { position: 'front', images: [{ id: 'old', type: 'image/png', x: 0.5, y: 0.45, scale: 1.1, angle: 0 }] },
        { position: 'back', images: [{ id: 'old', type: 'image/png', x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
      ],
    },
  ],
};

test('tags are 13 and Etsy-sized', () => {
  for (const t of Object.values(TEMPLATES)) {
    assert.equal(t.tags.length, 13);
    for (const tag of t.tags) assert.ok(tag.length <= 20, tag);
    assert.ok(t.title('Biscuit').length <= 140);
  }
});

test('buildProductFromTemplate copies blueprint, enabled variants, geometry; hides in store', () => {
  const p = buildProductFromTemplate(template, { uploadId: 'new', title: 'T', description: 'D', tags: TEMPLATES.ceramic.tags });
  assert.equal(p.blueprint_id, 1599);
  assert.equal(p.print_provider_id, 99);
  assert.deepEqual(p.variants, [{ id: 1, price: 2499, is_enabled: true }]);
  assert.deepEqual(p.print_areas[0].variant_ids, [1]);
  assert.equal(p.print_areas[0].placeholders.length, 2);
  assert.deepEqual(p.print_areas[0].placeholders[0].images[0], { id: 'new', x: 0.5, y: 0.45, scale: 1.1, angle: 0 });
  assert.equal(p.tags.length, 13);
  assert.equal(p.visible, false);
});

test('client refuses publish and send_to_production endpoints', async () => {
  await assert.rejects(printifyRequest('POST', '/shops/1/products/2/publish.json', {}), /never publishes/);
  await assert.rejects(printifyRequest('POST', '/shops/1/orders/2/send_to_production.json', {}), /never publishes/);
});

let calls = [];
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body && JSON.parse(opts.body) });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/uploads/images.json')) return json({ id: 'up1', width: 2400, height: 2400 });
    if (/\/products\/[^/]+\.json$/.test(url) && opts.method === 'GET') return json(template);
    if (url.endsWith('/products.json')) return json({ id: `prod${calls.length}` });
    return json({ error: 'unexpected' }, 404);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('pushOrderToPrintify creates unpublished products, records them, and is idempotent', async () => {
  const id = 'a'.repeat(32);
  fs.mkdirSync(path.join(outputDir, id), { recursive: true });
  const png = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#a33' } }).png().toBuffer();
  fs.writeFileSync(path.join(outputDir, id, 'p1.png'), png);
  saveOrder({ id, createdAt: new Date().toISOString(), status: 'delivered', images: ['p1.png'], petName: 'Khabba' });

  const state = await pushOrderToPrintify(id);
  assert.equal(state.status, 'created');
  assert.ok(getOrder(id).printify.products.ceramic.productId);
  assert.ok(getOrder(id).printify.products.metal.productId);
  assert.ok(calls.every((c) => !/publish|send_to_production/.test(c.url)), 'no publish calls');
  const creates = calls.filter((c) => c.url.endsWith('/products.json'));
  assert.equal(creates.length, 2);
  assert.ok(creates.every((c) => c.body.visible === false && c.body.tags.length === 13));
  assert.match(creates[0].body.title, /^Khabba /);

  const before = calls.length;
  await pushOrderToPrintify(id);
  assert.equal(calls.length, before, 'second run makes no API calls');
});

test('flag off: does nothing', async () => {
  const { default: config } = await import('../src/config.js');
  config.printify.enabled = false;
  const n = calls.length;
  const r = await pushOrderToPrintify('b'.repeat(32));
  assert.match(r.skipped, /PRINTIFY_PIPELINE_ENABLED/);
  assert.equal(calls.length, n);
  config.printify.enabled = true;
});
