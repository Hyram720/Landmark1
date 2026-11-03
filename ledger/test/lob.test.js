// Lob tracking webhooks. Signatures are computed locally. No live Lob calls and no real keys.
import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createApp } from '../server/app.js';
import { verifyLobWebhook, LOB_WEBHOOK_PATH } from '../server/mail.js';
import { Law } from '../server/shared.js';

const SECRET = 'webhook-secret-test-ABCD';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/lob\.com/i.test(u)) throw new Error('refusing live Lob call: ' + u);
  return realFetch(url, opts);
};

function sign(secret, timestamp, raw) {
  return crypto.createHmac('sha256', secret).update(String(timestamp) + '.' + raw).digest('hex');
}

test('Lob signature: valid', () => {
  const raw = '{"id":"evt_ok"}';
  const ts = '1700000000';
  const signature = sign(SECRET, ts, raw);
  const nowMs = 1700000000 * 1000;
  assert.deepStrictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature, rawBody: raw, nowMs }), { ok: true });
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature: signature.toUpperCase(), rawBody: Buffer.from(raw), nowMs }).ok, true);
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature, rawBody: raw, nowMs: nowMs + 300 * 1000 }).ok, true, 'exactly 5 minutes is still accepted');
});

test('Lob signature: bad signature', () => {
  const raw = '{"id":"evt_bad"}';
  const ts = '1700000000';
  const nowMs = 1700000000 * 1000;
  const wrong = sign('other-secret-not-ours', ts, raw);
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature: wrong, rawBody: raw, nowMs }).reason, 'bad');
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature: 'abc', rawBody: raw, nowMs }).reason, 'bad');
  const flipped = sign(SECRET, ts, raw + ' ');
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature: flipped, rawBody: raw, nowMs }).reason, 'bad');
});

test('Lob signature: missing', () => {
  const raw = '{"id":"evt_missing"}';
  const ts = '1700000000';
  const signature = sign(SECRET, ts, raw);
  const nowMs = 1700000000 * 1000;
  assert.strictEqual(verifyLobWebhook({ secret: '', timestamp: ts, signature, rawBody: raw, nowMs }).reason, 'missing');
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: '', signature, rawBody: raw, nowMs }).reason, 'missing');
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature: '', rawBody: raw, nowMs }).reason, 'missing');
  assert.strictEqual(verifyLobWebhook({ timestamp: ts, rawBody: raw, nowMs }).reason, 'missing');
});

test('Lob signature: stale timestamp', () => {
  const raw = '{"id":"evt_stale"}';
  const ts = '1700000000';
  const signature = sign(SECRET, ts, raw);
  const nowMs = 1700000000 * 1000 + 301 * 1000;
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature, rawBody: raw, nowMs }).reason, 'stale');
  const future = 1700000000 * 1000 - 301 * 1000;
  assert.strictEqual(verifyLobWebhook({ secret: SECRET, timestamp: ts, signature, rawBody: raw, nowMs: future }).reason, 'stale');
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-lob-'));
const { app, db } = createApp({ dataDir: dir, encryptionKey: 'lob-test-key-not-a-secret' });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { globalThis.fetch = realFetch; server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
}
const owner = client();
const anon = client();

function postWebhook(raw, headers) {
  return fetch(base + LOB_WEBHOOK_PATH, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: raw
  }).then(async r => {
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  });
}
function signed(raw, timestamp = Math.floor(Date.now() / 1000), secret = SECRET) {
  return postWebhook(raw, { 'lob-signature': sign(secret, timestamp, raw), 'lob-signature-timestamp': String(timestamp) });
}

const DUE = '2026-11-05';
const RECEIVED = '2026-10-06';
function dispute(id, letterId) {
  return {
    id, clientId: 'c-lob', type: 'cra_611', round: 1, recipient: 'Experian', status: 'sent',
    sentAt: '2026-10-01', receivedAt: RECEIVED, dueAt: DUE, tracking: '', outcome: null, items: [],
    mail: { provider: 'lob', id: letterId, service: 'certified', events: [] }
  };
}

test('setup disputes that were mailed through Lob', async () => {
  assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@lob.test', password: 'correct horse battery' })).status, 200);
  const g = await owner('GET', '/api/workspace');
  const w = g.body.data;
  w.clients.push({ id: 'c-lob', name: 'Ada Letter', firstName: 'Ada', lastName: 'Letter', kind: 'personal', status: 'active', email: 'ada@lob.test', onboarding: {} });
  const kinds = [];
  for (const prefix of ['letter', 'letter.certified']) {
    for (const suffix of ['mailed', 'in_transit', 'delivered', 're-routed', 'returned_to_sender']) {
      const slug = `${prefix}_${suffix}`.replace(/[^a-z0-9_]/gi, '_');
      kinds.push(slug);
      w.disputes.push(dispute('d_' + slug, 'ltr_' + slug));
    }
  }
  w.disputes.push(dispute('d_dup', 'ltr_dup'));
  w.disputes.push(dispute('d_sig', 'ltr_sig'));
  assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: w })).status, 200);
  assert.ok(kinds.length === 10);
});

test('webhook URL is shown and the signing secret is stored encrypted', async () => {
  const before = await owner('GET', '/api/settings/mail');
  assert.strictEqual(before.body.webhookPath, '/api/webhooks/lob');
  assert.match(before.body.webhookUrl, /\/api\/webhooks\/lob$/);
  assert.strictEqual(before.body.webhookSecretConfigured, false);
  const raw = JSON.stringify({ id: 'evt_no_secret', event_type: { id: 'letter.mailed' }, body: { id: 'ltr_sig' } });
  assert.strictEqual((await signed(raw)).status, 401, 'unsigned until a secret is saved');
  assert.strictEqual((await owner('PUT', '/api/settings/mail', { lobWebhookSecret: 'short' })).status, 400);
  const saved = await owner('PUT', '/api/settings/mail', { lobWebhookSecret: SECRET });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.webhookSecretConfigured, true);
  assert.strictEqual(saved.body.webhookSecretLast4, 'ABCD');
  assert.ok(!JSON.stringify(saved.body).includes(SECRET));
  const again = await owner('GET', '/api/settings/mail');
  assert.ok(!JSON.stringify(again.body).includes(SECRET));
  const ws = await owner('GET', '/api/workspace');
  assert.ok(!JSON.stringify(ws.body).includes(SECRET), 'secret is not in the workspace');
  const audit = await owner('GET', '/api/audit');
  assert.ok(!JSON.stringify(audit.body).includes(SECRET));
  assert.ok(fs.readFileSync(db.file, 'utf8').includes('aes-256-gcm') || !fs.readFileSync(db.file, 'utf8').includes(SECRET));
  assert.ok(!fs.readFileSync(db.file, 'utf8').includes(SECRET), 'webhook secret encrypted at rest');
  const staffInv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff@lob.test' });
  const staff = client();
  await staff('POST', '/api/invites/accept', { token: staffInv.body.url.split('invite=')[1], password: 'staff password 1' });
  assert.strictEqual((await staff('PUT', '/api/settings/mail', { lobWebhookSecret: SECRET + '-staff' })).status, 403);
  assert.strictEqual((await staff('GET', '/api/settings/mail')).body.webhookPath, '/api/webhooks/lob');
});

test('webhook rejects missing, bad, and stale signatures', async () => {
  const raw = JSON.stringify({ id: 'evt_reject', event_type: { id: 'letter.in_transit' }, body: { id: 'ltr_sig', tracking_events: [{ name: 'In Transit', time: '2026-10-08T00:00:00.000Z' }] } });
  const ts = Math.floor(Date.now() / 1000);
  assert.strictEqual((await postWebhook(raw, {})).status, 401, 'missing');
  assert.strictEqual((await postWebhook(raw, { 'lob-signature-timestamp': String(ts) })).status, 401, 'missing signature');
  assert.strictEqual((await postWebhook(raw, { 'lob-signature': sign(SECRET, ts, raw) })).status, 401, 'missing timestamp');
  assert.strictEqual((await postWebhook(raw + ' ', { 'lob-signature': sign(SECRET, ts, raw), 'lob-signature-timestamp': String(ts) })).status, 401, 'bad signature');
  const old = ts - 600;
  assert.strictEqual((await postWebhook(raw, { 'lob-signature': sign(SECRET, old, raw), 'lob-signature-timestamp': String(old) })).status, 401, 'stale');
  const d = (await owner('GET', '/api/workspace')).body.data.disputes.find(x => x.id === 'd_sig');
  assert.strictEqual(d.dueAt, DUE, 'rejected notifications do not move the deadline');
  assert.strictEqual(d.receivedAt, RECEIVED);
});

test('a valid signature updates tracking', async () => {
  const raw = JSON.stringify({
    id: 'evt_sig_ok',
    event_type: { id: 'letter.certified.in_transit' },
    reference_id: 'ltr_sig',
    body: { id: 'ltr_sig', tracking_number: '9400111899223344556601', tracking_events: [{ name: 'In Transit', time: '2026-10-08T12:00:00.000Z', location: '75001' }] }
  });
  const r = await signed(raw);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.matched, true);
  const d = (await owner('GET', '/api/workspace')).body.data.disputes.find(x => x.id === 'd_sig');
  assert.strictEqual(d.tracking, '9400111899223344556601');
  assert.strictEqual(d.mail.events.some(e => e.name === 'In Transit' && e.at === '2026-10-08'), true);
  assert.strictEqual(d.dueAt, DUE, 'in transit does not move the deadline');
  assert.strictEqual(d.receivedAt, RECEIVED);
});

test('each letter event updates the matching dispute', async () => {
  const deliveredDue = Law.responseDue('cra_611', '2026-10-19');
  assert.notStrictEqual(deliveredDue, DUE);
  for (const prefix of ['letter', 'letter.certified']) {
    for (const [suffix, name, delivers, returned] of [
      ['mailed', 'Mailed', false, false],
      ['in_transit', 'In Transit', false, false],
      ['delivered', 'Delivered', true, false],
      ['re-routed', 'Re-Routed', false, false],
      ['returned_to_sender', 'Returned to Sender', false, true]
    ]) {
      const slug = `${prefix}_${suffix}`.replace(/[^a-z0-9_]/gi, '_');
      const typeId = `${prefix}.${suffix}`;
      const events = [{ name, time: delivers ? '2026-10-19T15:00:00.000Z' : returned ? '2026-10-22T15:00:00.000Z' : '2026-10-10T15:00:00.000Z' }];
      if (returned) events.unshift({ name: 'Delivered', time: '2026-10-19T15:00:00.000Z' });
      const raw = JSON.stringify({
        id: 'evt_' + slug,
        event_type: { id: typeId },
        body: {
          id: 'ltr_' + slug,
          tracking_number: suffix === 'mailed' ? '94001118992233445566' + slug.slice(-2) : '',
          to: { address_line1: '123 Should Not Be Logged' },
          tracking_events: events
        }
      });
      const r = await signed(raw);
      assert.strictEqual(r.status, 200, typeId + ' ' + JSON.stringify(r.body));
      assert.strictEqual(r.body.matched, true, typeId);
      const d = (await owner('GET', '/api/workspace')).body.data.disputes.find(x => x.id === 'd_' + slug);
      assert.ok(d.mail.events.some(e => e.name === name), typeId + ' stored the tracking event');
      if (delivers) {
        assert.strictEqual(d.receivedAt, '2026-10-19', typeId);
        assert.strictEqual(d.dueAt, deliveredDue, typeId + ' uses the refresh-button deadline');
        assert.strictEqual(d.mail.deliveredAt, '2026-10-19', typeId);
        assert.ok(!d.mail.returnedToSender, typeId);
      } else if (returned) {
        assert.strictEqual(d.receivedAt, RECEIVED, typeId + ' does not restart the received date');
        assert.strictEqual(d.dueAt, DUE, typeId + ' does not restart the deadline');
        assert.ok(!d.mail.deliveredAt, typeId + ' does not count the return as delivery');
        assert.strictEqual(d.mail.returnedToSender, true, typeId);
        assert.strictEqual(d.outcome, null, typeId);
      } else {
        assert.strictEqual(d.receivedAt, RECEIVED, typeId);
        assert.strictEqual(d.dueAt, DUE, typeId);
        assert.ok(!d.mail.returnedToSender, typeId);
      }
      if (suffix === 'mailed') assert.ok(d.tracking, typeId + ' saves the tracking number');
    }
  }
});

test('duplicate events are ignored and unknown letters do not crash', async () => {
  const raw = JSON.stringify({
    id: 'evt_dup',
    event_type: { id: 'letter.certified.delivered' },
    body: { id: 'ltr_dup', tracking_events: [{ name: 'Delivered', time: '2026-10-19T15:00:00.000Z' }] }
  });
  const first = await signed(raw);
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.deliveredAt, '2026-10-19');
  const before = (await owner('GET', '/api/workspace')).body;
  const second = await signed(raw);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.duplicate, true);
  const after = (await owner('GET', '/api/workspace')).body;
  const d = after.data.disputes.find(x => x.id === 'd_dup');
  assert.strictEqual(d.dueAt, Law.responseDue('cra_611', '2026-10-19'));
  assert.strictEqual(d.mail.events.length, 1, 'tracking events are not duplicated');
  assert.strictEqual(after.data.activity.filter(a => String(a.text).includes('ltr_dup') || String(a.text).includes('was delivered')).length, before.data.activity.filter(a => String(a.text).includes('was delivered')).length);

  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
  try {
    const unknown = JSON.stringify({
      id: 'evt_unknown',
      event_type: { id: 'letter.certified.in_transit' },
      body: { id: 'ltr_nobody', to: { address_line1: '123 Should Not Be Logged' }, tracking_events: [{ name: 'In Transit', time: '2026-10-08T00:00:00.000Z' }] }
    });
    const u1 = await signed(unknown);
    assert.strictEqual(u1.status, 200);
    assert.strictEqual(u1.body.matched, false);
    const u2 = await signed(unknown);
    assert.strictEqual(u2.status, 200);
    assert.strictEqual(u2.body.duplicate, true);
  } finally { console.warn = orig; }
  const logged = warns.filter(w => w.includes('[lob]'));
  assert.strictEqual(logged.length, 1, 'unknown letter is logged once');
  assert.ok(logged[0].includes('ltr_nobody'));
  assert.ok(!logged[0].includes('Should Not Be Logged'));
  assert.ok(!logged[0].includes(SECRET));
  const still = (await owner('GET', '/api/workspace')).body.data.disputes.find(x => x.mail && x.mail.id === 'ltr_nobody');
  assert.strictEqual(still, undefined);
});

test('returned mail is flagged on the dashboard and in alerts', () => {
  const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Set, Map, Error, URLSearchParams, crypto, navigator: {} };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.top = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  const root = path.join(import.meta.dirname, '../js');
  for (const f of ['law.js', 'partners.js', 'metro2.js', 'store.js', 'ui.js', 'views.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  ctx.Store.load();
  const s = ctx.Store.state;
  s.clients.push({ id: 'c1', name: 'Ada Letter', firstName: 'Ada', lastName: 'Letter', kind: 'personal', status: 'active', onboarding: {}, createdAt: '2026-01-01' });
  s.disputes.push({
    id: 'd1', clientId: 'c1', type: 'cra_611', round: 1, recipient: 'Experian', status: 'sent',
    sentAt: '2026-10-01', receivedAt: RECEIVED, dueAt: DUE, outcome: null, items: [],
    mail: { provider: 'lob', id: 'ltr_back', returnedToSender: true, events: [{ name: 'Returned to Sender', at: '2026-10-22' }] }
  });
  const alerts = ctx.Views.alerts();
  const hit = alerts.filter(a => a.link === '#/disputes/d1' && /returned/i.test(a.text) && /address/i.test(a.text));
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].sev, 'high');
  const dash = ctx.Views.dashboard();
  assert.match(dash, /Returned — correct address/);
  assert.match(dash, /correct the address/);
  const compliance = ctx.Views.compliance();
  assert.match(compliance, /correct the address/);
  const page = ctx.Views.dispute({ id: 'd1' });
  assert.match(page, /Returned to sender/);
  assert.match(page, /was not restarted/);
  assert.match(page, /Refresh tracking/);
});

test('robots.txt blocks crawlers, favicon.ico is served, bot scans are a quiet 404', async () => {
  const robots = await anon('GET', '/robots.txt');
  assert.strictEqual(robots.status, 200);
  assert.match(robots.headers.get('content-type') || '', /text\/plain/);
  assert.match(robots.body, /User-agent:\s*\*/);
  assert.match(robots.body, /Disallow:\s*\//);
  const ico = await fetch(base + '/favicon.ico');
  const buf = Buffer.from(await ico.arrayBuffer());
  assert.strictEqual(ico.status, 200);
  assert.match(ico.headers.get('content-type') || '', /icon/);
  assert.ok(buf.length > 22);
  assert.strictEqual(buf.readUInt16LE(2), 1, 'ICO type');

  const lines = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const m of Object.keys(orig)) console[m] = (...a) => { lines.push(a.map(x => String(x)).join(' ')); };
  try {
    for (const p of ['/wp-admin', '/wp-admin/install.php', '/wp-login.php', '/.env', '/.env.local', '/vendor/.env']) {
      const r = await anon('GET', p);
      assert.strictEqual(r.status, 404, p);
      assert.strictEqual(r.body, 'Not found');
    }
    assert.strictEqual((await anon('POST', '/wp-login.php', { a: 1 })).status, 404);
  } finally {
    Object.assign(console, orig);
  }
  const blob = lines.join('\n');
  assert.ok(!/wp-admin|wp-login|\.env/.test(blob), blob);
});
