import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const socket = net.createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const { port } = socket.address();
await new Promise((resolve) => socket.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-studio-smoke-'));
const secret = crypto.randomUUID();
const server = spawn(process.execPath, ['src/server.js'], { stdio: 'inherit', env: {
  ...process.env, NODE_ENV: 'test', PORT: String(port), BASE_URL: origin, DATA_DIR: directory,
  STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: secret, DEV_SKIP_PAYMENT: 'false',
  STRIPE_LINK_DIGITAL: 'https://buy.stripe.com/fixture_digital',
  STRIPE_LINK_CANVAS_SMALL: 'https://buy.stripe.com/fixture_small',
  STRIPE_LINK_CANVAS_LARGE: 'https://buy.stripe.com/fixture_large',
  GA_MEASUREMENT_ID: 'G-TESTSMOKE', META_PIXEL_ID: '123456789', PORTRAIT_GROWTH_PREVIEW: 'false',
} });
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt >= 60) throw Error('App failed to start');
    const ready = await fetch(origin + '/health').catch(() => null);
    if (ready?.ok) break;
    await wait(100);
  }
  for (const url of ['/', '/offer', '/royal', '/portraits/dog-from-photo', '/gifts/pet-memorial', '/gifts/christmas-gift', '/robots.txt', '/sitemap.xml', '/llms.txt']) {
    assert.equal((await fetch(origin + url, { redirect: 'manual' })).status, 200, url);
  }
  const homepage = await (await fetch(origin)).text();
  assert.match(homepage, /FAQPage/);
  assert.match(homepage, /"@type":"Product"/);
  assert.match(homepage, /Digital files are final sale/);
  assert.doesNotMatch(homepage, /Offer concepts|free repaint/i);
  const analytics = await (await fetch(origin + '/analytics.js')).text();
  assert.match(analytics, /G-TESTSMOKE/);
  assert.match(analytics, /123456789/);
  const key = crypto.randomUUID();
  const checkout = (petName = 'Fixture') => {
    const data = new FormData();
    data.set('photo', new Blob([Buffer.from('fixture')], { type: 'image/png' }), 'fixture.png');
    data.set('email', 'fixture@example.test'); data.set('style', 'royal');
    data.set('product', 'digital'); data.set('petName', petName);
    return fetch(origin + '/api/orders', { method: 'POST', body: data, headers: { 'Idempotency-Key': key } });
  };
  const duplicate = await Promise.all([checkout(), checkout()]);
  for (const response of duplicate) assert.equal(response.status, 200, await response.clone().text());
  const [one, two] = await Promise.all(duplicate.map((response) => response.json()));
  assert.equal(one.url, two.url);
  assert.equal((await checkout('Changed pet')).status, 409);
  assert.equal((await fs.readdir(path.join(directory, 'orders'))).length, 1);
  const id = new URL(one.url).searchParams.get('client_reference_id');
  const status = async () => (await (await fetch(origin + '/api/orders/' + id)).json()).status;
  assert.equal(await status(), 'pending_payment');
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: {
    id: 'cs_test_fixture', client_reference_id: id, metadata: { product: 'digital' },
    payment_status: 'paid', amount_subtotal: 2900, amount_total: 2900,
  } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + event).digest('hex');
  const send = (sig) => fetch(origin + '/webhooks/stripe', { method: 'POST', body: event, headers: {
    'Content-Type': 'application/json', 'Stripe-Signature': 't=' + timestamp + ',v1=' + sig,
  } });
  assert.equal((await send('0'.repeat(64))).status, 400);
  assert.equal(await status(), 'pending_payment');
  assert.equal((await send(signature)).status, 200);
  assert.equal(await status(), 'paid');
  assert.equal((await send(signature)).status, 200);
  assert.equal(await status(), 'paid');
  assert.equal((await fetch(origin + '/o/' + id)).status, 200);
  assert.equal((await fetch(origin + '/checkout/done?session_id=unknown')).status, 200);
  console.log('App startup, key URLs, schema, analytics, duplicate checkout, signed webhook and confirmation passed.');
} finally {
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
  }
}
