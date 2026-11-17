// Photo-rights consent is required before an order is saved or a portrait is generated.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portrait-consent-'));
process.env.DATA_DIR = tmp;
process.env.DEV_SKIP_PAYMENT = 'true';
process.env.IMAGE_PROVIDER = 'mock';
process.env.IMAGE_VARIANTS = '1';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.BASE_URL = 'http://127.0.0.1:3000';
process.env.ENHANCE_IMAGES = 'true';
delete process.env.RESEND_API_KEY;
delete process.env.ALERT_EMAIL;
delete process.env.SAMPLE_ORDER_ID;

const { photoRightsTimestamp, assertPhotoRights } = await import('../src/consent.js');
const { app } = await import('../src/server.js');
const { processOrder } = await import('../src/pipeline.js');
const { saveOrder, getOrder } = await import('../src/store.js');

const server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).png().toBuffer();

function orderForm(fields) {
  const form = new FormData();
  form.append('photo', new Blob([png], { type: 'image/png' }), 'pet.png');
  form.append('email', 'buyer@example.com');
  form.append('style', 'royal');
  form.append('product', 'digital');
  form.append('petName', 'Duke');
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

test('photo rights timestamp is stored only when the checkbox is accepted', () => {
  assert.throws(() => photoRightsTimestamp({}), /own this photo or have the right to use it/);
  assert.throws(() => photoRightsTimestamp({ photoRights: 'no' }), /own this photo/);
  const at = photoRightsTimestamp({ photoRights: 'yes' }, new Date('2026-11-17T18:00:00.000Z'));
  assert.equal(at, '2026-11-17T18:00:00.000Z');
  assert.throws(() => assertPhotoRights({ id: 'x' }), /Generation did not run/);
});

test('POST /api/orders does not start generation without the photo-rights checkbox', async () => {
  const denied = await fetch(`${base}/api/orders`, { method: 'POST', body: orderForm({}) });
  const deniedBody = await denied.json();
  assert.equal(denied.status, 400);
  assert.match(deniedBody.error, /own this photo or have the right to use it/);
  assert.equal(fs.readdirSync(path.join(tmp, 'orders')).length, 0);

  const accepted = await fetch(`${base}/api/orders`, { method: 'POST', body: orderForm({ photoRights: 'yes' }) });
  const acceptedBody = await accepted.json();
  assert.equal(accepted.status, 200);
  const id = acceptedBody.url.split('/').pop();
  const order = getOrder(id);
  assert.equal(order.photoRightsAt != null && !Number.isNaN(Date.parse(order.photoRightsAt)), true);
});

test('admin manual orders also require photo rights before generation', async () => {
  const denied = await fetch(`${base}/admin/manual-order?key=test-admin-key`, { method: 'POST', body: orderForm({ channel: 'etsy' }) });
  assert.equal(denied.status, 400);
  const text = await denied.text();
  assert.match(text, /own this photo or have the right to use it/);

  const accepted = await fetch(`${base}/admin/manual-order?key=test-admin-key`, {
    method: 'POST',
    redirect: 'manual',
    body: orderForm({ channel: 'etsy', photoRights: 'yes' }),
  });
  assert.equal(accepted.status, 302);
  const id = new URL(accepted.headers.get('location'), base).searchParams.get('created');
  assert.equal(getOrder(id).photoRightsAt != null, true);
});

test('the pipeline does not generate when the stored consent timestamp is missing', async () => {
  const id = 'ab'.repeat(16);
  saveOrder({
    id,
    createdAt: new Date().toISOString(),
    status: 'paid',
    email: 'buyer@example.com',
    petName: 'Duke',
    style: 'royal',
    product: 'digital',
    physical: false,
    photo: 'missing.png',
    photoMime: 'image/png',
  });
  await assert.rejects(() => processOrder(id), /Generation did not run/);
  const after = getOrder(id);
  assert.equal(after.status, 'paid');
  assert.equal(after.images, undefined);
});

test('the upload form and the policy drafts state ownership and final sale', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const admin = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const privacy = fs.readFileSync(new URL('../docs/policies/privacy-terms-contact.md', import.meta.url), 'utf8');
  const returns = fs.readFileSync(new URL('../docs/policies/returns.md', import.meta.url), 'utf8');
  assert.match(html, /name="photoRights"/);
  assert.match(html, /I own this photo or have the right to use it/);
  assert.match(admin, /I own this photo or have the right to use it/);
  assert.match(privacy, /photoRightsAt/);
  assert.match(privacy, /final sale/i);
  assert.match(returns, /final sale/i);
  assert.doesNotMatch(privacy, /money-back|refund/i);
  assert.doesNotMatch(returns, /money-back|refund/i);
});
