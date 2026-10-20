// Stripe Checkout + webhook. Never talks to Stripe: the API client is a mock, and webhook
// signatures are made locally with Stripe's own test helper. Run: npm run test:ledger
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';

// Whatever Stripe settings the shell has (e.g. a real key) must never reach these tests.
for (const k of Object.keys(process.env)) if (/STRIPE|PAYMENTS_ENABLED|APP_BASE_URL/.test(k)) delete process.env[k];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => { if (/stripe\.com/.test(String(url))) throw new Error('test tried to reach Stripe'); return realFetch(url, opts); };

const { createApp } = await import('../server/app.js');

const created = [];
const sessions = {};
const mockStripe = {
  checkout: { sessions: {
    async create(params) { const id = 'cs_test_' + (created.length + 1) + 'abcdef'; created.push(params); sessions[id] = { id, payment_status: 'unpaid', amount_total: params.line_items[0].price_data.unit_amount, currency: params.line_items[0].price_data.currency, client_reference_id: params.client_reference_id, metadata: params.metadata, payment_intent: null }; return { id, url: 'https://checkout.stripe.com/c/pay/' + id }; },
    async retrieve(id) { return sessions[id]; }
  } }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-stripe-'));
const { app } = createApp({ dataDir: dir, encryptionKey: 'test-key', stripeClient: mockStripe });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); globalThis.fetch = realFetch; });

function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const raw = typeof body === 'string';
    const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, body && !raw ? { 'content-type': 'application/json' } : {}, headers), body: body ? (raw ? body : JSON.stringify(body)) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
}
const owner = client(), portal = client(), anon = client();
const WHSEC = 'whsec_test_dummy_secret_123456';
const signed = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const ws = async () => (await owner('GET', '/api/workspace')).body.data;
const inv = async id => (await ws()).invoices.find(i => i.id === id);
function hook(event, secret = WHSEC) {
  const payload = JSON.stringify(event);
  return anon('POST', '/api/stripe/webhook', payload, { 'content-type': 'application/json', 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret }) });
}
const completed = (id, o) => ({ id, type: 'checkout.session.completed', data: { object: Object.assign({ id: 'cs_test_hook', object: 'checkout.session', payment_status: 'paid', currency: 'usd' }, o) } });

test('setup: owner, a cleared client with invoices, and a client portal login', async () => {
  assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@example.test', password: 'correct horse battery' })).status, 200);
  const g = await owner('GET', '/api/workspace');
  const w = g.body.data;
  w.clients.push({ id: 'cs1', name: 'Sam Stripe', firstName: 'Sam', lastName: 'Stripe', kind: 'personal', email: 'sam@example.test', status: 'active', onboarding: { disclosureSignedAt: signed, contractSignedAt: signed } });
  w.clients.push({ id: 'cs2', name: 'New Lead', firstName: 'New', lastName: 'Lead', kind: 'personal', email: 'new@example.test', status: 'lead', onboarding: {} });
  w.invoices.push({ id: 'invA', clientId: 'cs1', description: 'Dispute letter mailed', amount: 49, status: 'issued', issuedAt: signed, serviceCompletedAt: signed, payToken: 'tokA1234567890' });
  w.invoices.push({ id: 'invB', clientId: 'cs1', description: 'Dispute letter mailed', amount: 49, status: 'issued', issuedAt: signed, serviceCompletedAt: signed, payToken: 'tokB1234567890' });
  w.invoices.push({ id: 'invC', clientId: 'cs2', description: 'Too early', amount: 49, status: 'issued', issuedAt: signed, payToken: 'tokC1234567890' });
  w.invoices.push({ id: 'invD', clientId: 'cs1', description: 'Portal pay', amount: 75.5, status: 'issued', issuedAt: signed, serviceCompletedAt: signed, payToken: 'tokD1234567890' });
  w.settings.billing = Object.assign({}, w.settings.billing, { provider: 'stripe' });
  assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: w })).status, 200);
  const i = await owner('POST', '/api/invites', { role: 'client', clientId: 'cs1' });
  assert.strictEqual((await portal('POST', '/api/invites/accept', { token: i.body.url.split('invite=')[1], password: 'client password 1' })).status, 200);
});

test('payments are off by default: 503s, health still 200, no Stripe calls', async () => {
  assert.strictEqual((await anon('GET', '/api/health')).status, 200);
  const st = await owner('GET', '/api/settings/stripe');
  assert.deepStrictEqual([st.body.enabled, st.body.keyConfigured, st.body.ready, st.body.webhookConfigured], [false, false, false, false]);
  assert.match((await anon('GET', '/pay/tokA1234567890')).body, /isn’t set up yet/);
  assert.strictEqual((await anon('POST', '/pay/tokA1234567890/stripe')).status, 503);
  const p = await portal('POST', '/api/portal/invoices/invD/checkout');
  assert.strictEqual(p.status, 503); assert.match(p.body.error, /not configured/);
  assert.strictEqual((await hook(completed('evt_0', { client_reference_id: 'invA', amount_total: 4900 }))).status, 503, 'webhook off without STRIPE_WEBHOOK_SECRET');
  assert.strictEqual(created.length, 0);
});

test('kill switch: a key alone does not turn payments on', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_tests';
  process.env.PAYMENTS_ENABLED = 'false';
  assert.strictEqual((await anon('POST', '/pay/tokA1234567890/stripe')).status, 503);
  process.env.PAYMENTS_ENABLED = 'true';
  delete process.env.STRIPE_SECRET_KEY;
  assert.strictEqual((await anon('POST', '/pay/tokA1234567890/stripe')).status, 503);
  assert.strictEqual(created.length, 0);
});

test('enabled: pay page posts to Stripe Checkout for the invoice amount (one-time), CROA guard holds', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_tests';
  process.env.PAYMENTS_ENABLED = 'true';
  process.env.APP_BASE_URL = 'https://ledger.example.test/';
  const st = await owner('GET', '/api/settings/stripe');
  assert.strictEqual(st.body.ready, true); assert.strictEqual(st.body.mode, 'test');
  assert.ok(!JSON.stringify(st.body).includes('dummy'), 'never returns the key');
  const page = await anon('GET', '/pay/tokA1234567890');
  assert.match(page.body, /action="\/pay\/tokA1234567890\/stripe"/);
  assert.match(page.headers.get('content-security-policy'), /form-action[^;]*https:\/\/checkout\.stripe\.com/);
  const r = await anon('POST', '/pay/tokA1234567890/stripe');
  assert.strictEqual(r.status, 303);
  assert.match(r.headers.get('location'), /^https:\/\/checkout\.stripe\.com\//);
  const p = created.at(-1);
  assert.strictEqual(p.mode, 'payment');
  assert.strictEqual(p.line_items[0].price_data.unit_amount, 4900);
  assert.strictEqual(p.line_items[0].price_data.currency, 'usd');
  assert.strictEqual(p.client_reference_id, 'invA');
  assert.deepStrictEqual(p.metadata, { ledgerInvoiceId: 'invA', ledgerClientId: 'cs1' });
  assert.strictEqual(p.customer_email, 'sam@example.test');
  assert.strictEqual(p.success_url, 'https://ledger.example.test/pay/tokA1234567890/stripe/done?session_id={CHECKOUT_SESSION_ID}');
  assert.strictEqual(p.cancel_url, 'https://ledger.example.test/pay/tokA1234567890');
  const n = created.length;
  assert.strictEqual((await anon('POST', '/pay/tokC1234567890/stripe')).status, 409, 'not payable before service + cancellation window');
  assert.strictEqual((await anon('POST', '/pay/nope/stripe')).status, 404);
  assert.strictEqual(created.length, n);
});

test('portal: a signed-in client can start checkout only for their own invoice', async () => {
  const r = await portal('POST', '/api/portal/invoices/invD/checkout');
  assert.strictEqual(r.status, 200); assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.strictEqual(created.at(-1).line_items[0].price_data.unit_amount, 7550);
  assert.strictEqual((await portal('POST', '/api/portal/invoices/invC/checkout')).status, 404, 'another client’s invoice');
  assert.strictEqual((await anon('POST', '/api/portal/invoices/invD/checkout')).status, 401);
  assert.strictEqual((await owner('POST', '/api/portal/invoices/invD/checkout')).status, 403);
});

test('success page confirms a paid session', async () => {
  const sid = (await inv('invD')).stripeSessionId;
  assert.match((await anon('GET', `/pay/tokD1234567890/stripe/done?session_id=${sid}`)).body, /confirming/, 'unpaid session stays pending');
  sessions[sid].payment_status = 'paid';
  assert.match((await anon('GET', '/pay/tokD1234567890/stripe/done?session_id=cs_test_other123')).body, /confirming/, 'only the invoice’s own session counts');
  assert.match((await anon('GET', `/pay/tokD1234567890/stripe/done?session_id=${sid}`)).body, /Thank you/);
  const d = await inv('invD');
  assert.strictEqual(d.status, 'paid'); assert.strictEqual(d.paidVia, 'Stripe');
});

test('webhook: rejects bad or missing signatures', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
  const ev = completed('evt_bad', { client_reference_id: 'invA', amount_total: 4900 });
  assert.strictEqual((await hook(ev, 'whsec_wrong_secret_000000')).status, 400);
  assert.strictEqual((await anon('POST', '/api/stripe/webhook', JSON.stringify(ev), { 'content-type': 'application/json' })).status, 400);
  const payload = JSON.stringify(ev);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  assert.strictEqual((await anon('POST', '/api/stripe/webhook', payload.replace('4900', '1'), { 'content-type': 'application/json', 'stripe-signature': header })).status, 400, 'tampered body');
  assert.strictEqual((await inv('invA')).status, 'issued');
});

test('webhook: checkout.session.completed marks the invoice paid once; mismatches go to staff', async () => {
  const r = await hook(completed('evt_1', { client_reference_id: 'invA', metadata: { ledgerInvoiceId: 'invA' }, amount_total: 4900, payment_intent: 'pi_test_1' }));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.result, 'ok');
  const a = await inv('invA');
  assert.strictEqual(a.status, 'paid'); assert.strictEqual(a.transId, 'pi_test_1'); assert.strictEqual(a.paidVia, 'Stripe');
  assert.strictEqual((await hook(completed('evt_1', { client_reference_id: 'invA', amount_total: 4900 }))).body.result, 'duplicate');
  await hook(completed('evt_2', { client_reference_id: 'invB', amount_total: 100 }));
  const w = await ws();
  assert.strictEqual(w.invoices.find(i => i.id === 'invB').status, 'issued');
  assert.ok(w.tasks.some(t => /doesn’t match the invoice amount/.test(t.title)));
  await hook(completed('evt_3', { client_reference_id: 'invB', amount_total: 4900, payment_status: 'unpaid' }));
  assert.strictEqual((await inv('invB')).status, 'issued', 'async (bank) payment still pending');
  await hook({ id: 'evt_4', type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_test_b', payment_status: 'paid', currency: 'usd', amount_total: 4900, client_reference_id: 'invB' } } });
  assert.strictEqual((await inv('invB')).status, 'paid');
});

test('webhook: subscription and invoice failure events are recorded', async () => {
  assert.strictEqual((await hook({ id: 'evt_5', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', customer: 'cus_1', metadata: {} } } })).status, 200);
  assert.strictEqual((await hook({ id: 'evt_6', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: {} } } })).status, 200);
  assert.strictEqual((await hook({ id: 'evt_7', type: 'invoice.payment_failed', data: { object: { id: 'in_1', customer: 'cus_1', amount_due: 4900 } } })).status, 200);
  assert.strictEqual((await hook({ id: 'evt_8', type: 'charge.refunded', data: { object: { id: 'ch_1' } } })).body.result, 'ignored');
  assert.ok((await ws()).tasks.some(t => /failed payment/.test(t.title)));
  const audit = (await owner('GET', '/api/audit')).body;
  assert.ok(audit.some(a => a.action === 'stripe.subscription' && /sub_1 canceled/.test(a.detail)));
});
