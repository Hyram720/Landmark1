// Run: npm run test:ledger
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
const { app, db } = createApp({ dataDir: dir, encryptionKey: 'test-key' });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

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
const portal = client();
const anon = client();
let ws, clientId;

test('first run requires setup; data is encrypted at rest', async () => {
  const s = await anon('GET', '/api/session');
  assert.strictEqual(s.body.setupRequired, true);
  assert.strictEqual((await anon('GET', '/api/workspace')).status, 401);
  assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@example.test', password: 'short' })).status, 400);
  const r = await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@example.test', password: 'correct horse battery' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await anon('POST', '/api/setup', { name: 'x', email: 'x@example.test', password: 'another long one' })).status, 409);
  assert.ok(!fs.readFileSync(db.file, 'utf8').includes('owner@example.test'), 'database file must not contain plaintext');
});

test('workspace save with optimistic concurrency', async () => {
  const g = await owner('GET', '/api/workspace');
  ws = g.body.data;
  assert.ok(ws.offers.length >= 10);
  ws.clients.push({ id: 'c1', name: 'Jordan Sample', firstName: 'Jordan', lastName: 'Sample', kind: 'personal', email: 'jordan@example.test', status: 'lead', onboarding: {} });
  ws.partnerReferrals.push({ id: 'r1', clientId: 'c1', offerId: 'offer-creditstrong', status: 'recommended', clicks: 0 });
  ws.offers.find(o => o.key === 'creditstrong').affiliateUrl = 'https://www.creditstrong.com/?ref=demo';
  const p = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws });
  assert.strictEqual(p.status, 200);
  const stale = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws });
  assert.strictEqual(stale.status, 409);
  clientId = 'c1';
});

test('public intake creates a business lead; honeypot ignored', async () => {
  assert.strictEqual((await anon('POST', '/api/intake', { firstName: 'A', lastName: 'B', email: 'bad' })).status, 400);
  const r = await anon('POST', '/api/intake', { kind: 'business', firstName: 'Avery', lastName: 'Placeholder', email: 'avery@example.test', businessName: 'Example Bakery LLC', consent: true });
  assert.strictEqual(r.status, 200);
  await anon('POST', '/api/intake', { firstName: 'Bot', lastName: 'Bot', email: 'bot@example.test', consent: true, website: 'spam' });
  const g = await owner('GET', '/api/workspace');
  const lead = g.body.data.clients.find(c => c.email === 'avery@example.test');
  assert.strictEqual(lead.kind, 'business');
  assert.strictEqual(lead.business.legalName, 'Example Bakery LLC');
  assert.ok(!g.body.data.clients.some(c => c.email === 'bot@example.test'));
});

test('client portal invite, CROA e-sign order, cancellation', async () => {
  const inv = await owner('POST', '/api/invites', { role: 'client', clientId });
  const token = inv.body.url.split('invite=')[1];
  assert.ok(token);
  assert.strictEqual((await portal('POST', '/api/invites/accept', { token, password: 'client password 1' })).status, 200);
  assert.strictEqual((await portal('POST', '/api/invites/accept', { token, password: 'client password 1' })).status, 400, 'invite is single use');
  assert.strictEqual((await portal('GET', '/api/workspace')).status, 403, 'clients cannot read the workspace');
  const me = await portal('GET', '/api/portal/me');
  assert.strictEqual(me.body.client.name, 'Jordan Sample');
  assert.match(me.body.documents.disclosure, /Consumer Credit File Rights/);
  assert.strictEqual(me.body.recommendations[0].url, '/go/r1');
  assert.strictEqual((await portal('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Jordan Sample', agree: true })).status, 400, 'contract before disclosure is refused');
  assert.strictEqual((await portal('POST', '/api/portal/sign', { doc: 'disclosure', typedName: 'Someone Else', agree: true })).status, 400);
  assert.strictEqual((await portal('POST', '/api/portal/sign', { doc: 'disclosure', typedName: 'jordan sample', agree: true })).status, 200);
  const c = await portal('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Jordan Sample', agree: true });
  assert.strictEqual(c.status, 200);
  assert.match(c.body.signature.documentSha256, /^[0-9a-f]{64}$/);
  const me2 = await portal('GET', '/api/portal/me');
  assert.strictEqual(me2.body.croa.inWindow, true);
  await portal('POST', '/api/portal/cancel');
  const g = await owner('GET', '/api/workspace');
  const jc = g.body.data.clients.find(x => x.id === clientId);
  assert.strictEqual(jc.status, 'cancelled');
  assert.strictEqual(g.body.data.signatures.length, 2);
});

test('tracked referral link redirects and records the click', async () => {
  const r = await anon('GET', '/go/r1');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), 'https://www.creditstrong.com/?ref=demo');
  const g = await owner('GET', '/api/workspace');
  const ref = g.body.data.partnerReferrals.find(x => x.id === 'r1');
  assert.strictEqual(ref.status, 'clicked');
  assert.strictEqual(ref.clicks, 1);
  assert.strictEqual((await anon('GET', '/go/nope')).status, 404);
});

test('staff invites are owner-only and audit log records actions', async () => {
  const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staffer', email: 'staff@example.test' });
  const staff = client();
  await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' });
  assert.strictEqual((await staff('GET', '/api/workspace')).status, 200);
  assert.strictEqual((await staff('POST', '/api/invites', { role: 'staff', email: 'x@example.test' })).status, 403);
  assert.strictEqual((await staff('GET', '/api/audit')).status, 403);
  const audit = await owner('GET', '/api/audit');
  ['setup', 'workspace.save', 'intake', 'portal.sign', 'portal.cancel', 'referral.click'].forEach(a => assert.ok(audit.body.some(x => x.action === a), a));
});

test('login rejects wrong password and static pages are served', async () => {
  assert.strictEqual((await anon('POST', '/api/login', { email: 'owner@example.test', password: 'nope nope nope' })).status, 401);
  for (const p of ['/', '/portal', '/apply', '/js/app.js', '/css/app.css']) assert.strictEqual((await anon('GET', p)).status, 200, p);
  assert.strictEqual((await anon('GET', '/server/app.js')).status, 404);
  assert.strictEqual((await anon('GET', '/test/server.test.js')).status, 404);
});

test('messaging is disabled until a provider is configured', async () => {
  const cfg = await owner('GET', '/api/config');
  assert.strictEqual(cfg.body.email, false);
  const r = await owner('POST', '/api/messages', { clientId, channel: 'email', body: 'Hello' });
  assert.strictEqual(r.status, 501);
});

test('documents upload encrypted and are isolated per client', async () => {
  const fd = new FormData();
  fd.append('type', 'report');
  fd.append('file', new Blob(['%PDF-1.4 synthetic report for Jordan'], { type: 'application/pdf' }), 'mfsn-report.pdf');
  const login = await owner('GET', '/api/session');
  assert.ok(login.body.user);
  const cookieRes = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.test', password: 'correct horse battery' }) });
  const cookie = cookieRes.headers.get('set-cookie').split(';')[0];
  const up = await fetch(base + `/api/clients/${clientId}/files`, { method: 'POST', headers: { cookie }, body: fd });
  assert.strictEqual(up.status, 200);
  const { doc } = await up.json();
  assert.ok(!fs.readFileSync(path.join(dir, 'files', doc.id)).includes('synthetic report'), 'file stored encrypted');
  const dl = await fetch(base + `/api/files/${doc.id}`, { headers: { cookie } });
  assert.strictEqual(await dl.text(), '%PDF-1.4 synthetic report for Jordan');
  assert.strictEqual((await portal('GET', `/api/files/${doc.id}`)).status, 200, 'client can read own file');
  const other = client();
  assert.strictEqual((await other('GET', `/api/files/${doc.id}`)).status, 401);
});

test('Ledger AI needs an API key and sees the client file', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const r = await owner('POST', '/api/assistant', { clientId, history: [{ role: 'user', content: 'What next?' }] });
  assert.strictEqual(r.status, 501);
  assert.strictEqual((await portal('POST', '/api/assistant', { history: [{ role: 'user', content: 'hi' }] })).status, 403, 'clients cannot use the staff assistant');
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
  const { clientContext } = await import('../server/assistant.js');
  const ctx = clientContext(db.data.workspace, clientId);
  assert.match(ctx, /CLIENT FILE — client/);
  assert.ok(!ctx.includes('Jordan Sample'), 'no client name sent to the AI');
  assert.match(ctx, /CROA:/);
});

test('AI scan and round plan are gated on an API key; HTML reports are flattened to text', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.strictEqual((await owner('POST', `/api/clients/${clientId}/ai-plan`)).status, 501);
  assert.strictEqual((await owner('POST', `/api/clients/${clientId}/files/nope/scan`)).status, 501);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
  const { htmlToText } = await import('../server/ai.js');
  const t = htmlToText('<table><tr><td>Creditor</td><td>Example Bank</td></tr><tr><td>Balance</td><td>$240</td></tr></table><script>x()</script>');
  assert.match(t, /Creditor \| Example Bank/);
  assert.ok(!t.includes('x()'));
});

test('pasted-text AI scan is gated on an API key and validates input', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.strictEqual((await owner('POST', `/api/clients/${clientId}/scan-text`, { text: 'x'.repeat(500) })).status, 501);
  process.env.ANTHROPIC_API_KEY = 'test';
  assert.strictEqual((await owner('POST', `/api/clients/${clientId}/scan-text`, { text: 'too short' })).status, 400);
  if (saved) process.env.ANTHROPIC_API_KEY = saved; else delete process.env.ANTHROPIC_API_KEY;
});

test('owner can save, view and remove the AI key in Settings; it never leaks', async () => {
  const savedEnv = process.env.ANTHROPIC_API_KEY, savedBase = process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9'; // unreachable: key is saved but not verified
  assert.strictEqual((await owner('GET', '/api/settings/ai')).body.configured, false);
  assert.strictEqual((await owner('PUT', '/api/settings/ai', { anthropicKey: 'not-a-key' })).status, 400);
  const key = 'sk-ant-api03-' + 'x'.repeat(40) + 'WXYZ';
  const r = await owner('PUT', '/api/settings/ai', { anthropicKey: key });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.configured, true);
  assert.strictEqual(r.body.source, 'settings');
  assert.strictEqual(r.body.last4, 'WXYZ');
  assert.ok(!JSON.stringify(r.body).includes(key));
  assert.strictEqual((await owner('GET', '/api/config')).body.assistant, true);
  assert.ok(!JSON.stringify((await owner('GET', '/api/workspace')).body).includes(key), 'key is not in the workspace or backups');
  assert.ok(!fs.readFileSync(db.file, 'utf8').includes(key), 'key is encrypted at rest');
  const staff = client();
  await staff('POST', '/api/login', { email: 'staff@example.test', password: 'staff password 1' });
  assert.strictEqual((await staff('GET', '/api/settings/ai')).status, 403);
  assert.strictEqual((await owner('DELETE', '/api/settings/ai')).body.configured, false);
  if (savedEnv) process.env.ANTHROPIC_API_KEY = savedEnv;
  if (savedBase) process.env.ANTHROPIC_BASE_URL = savedBase; else delete process.env.ANTHROPIC_BASE_URL;
});

// ---------- print & mail, payments, partner portal ----------
const realFetch = globalThis.fetch;
const calls = [];
function mockExternal() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.lob.com/')) {
      calls.push({ u, opts });
      if (opts.method === 'POST') return new Response(JSON.stringify({ id: 'ltr_test123', expected_delivery_date: '2026-10-20', tracking_number: '9407000000000000000000', url: 'https://lob.example/ltr.pdf' }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes('/letters/ltr_test123')) return new Response(JSON.stringify({ id: 'ltr_test123', tracking_events: [{ name: 'In Transit', time: '2026-10-16T10:00:00Z' }, { name: 'Delivered', time: '2026-10-19T10:00:00Z' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith('https://apitest.authorize.net/')) {
      calls.push({ u, opts });
      const body = JSON.parse(opts.body);
      const ok = { messages: { resultCode: 'Ok', message: [{ code: 'I00001', text: 'Successful.' }] } };
      if (body.authenticateTestRequest) return new Response('﻿' + JSON.stringify(ok));
      if (body.getHostedPaymentPageRequest) return new Response('﻿' + JSON.stringify(Object.assign({ token: 'FORMTOKEN' }, ok)));
      if (body.getUnsettledTransactionListRequest) return new Response('﻿' + JSON.stringify(Object.assign({ transactions: [{ transId: '555', invoiceNumber: 'inv9abc', transactionStatus: 'capturedPendingSettlement', settleAmount: 49.0, submitTimeUTC: '2026-10-14T12:00:00Z' }] }, ok)));
    }
    return realFetch(url, opts);
  };
}

test('online mailing through Lob is gated, then mails an approved letter and tracks delivery', async () => {
  mockExternal();
  try {
    const g = await owner('GET', '/api/workspace');
    const w = g.body.data;
    const signed = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    w.clients.push({ id: 'c9', name: 'Morgan Mailer', firstName: 'Morgan', lastName: 'Mailer', kind: 'personal', email: 'm@example.test', address: '12 Example Rd', city: 'Austin', state: 'TX', zip: '78701', status: 'active', onboarding: { disclosureSignedAt: signed, contractSignedAt: signed } });
    w.letters.push({ id: 'l9', clientId: 'c9', disputeId: 'd9', type: 'cra_611', status: 'approved', text: 'Morgan Mailer\n12 Example Rd\n\nRe: dispute\n\nPlease correct the balance.' });
    w.disputes.push({ id: 'd9', clientId: 'c9', type: 'cra_611', round: 1, recipient: 'Experian', status: 'ready', items: [{ creditor: 'Example Bank', discrepancy: 'Balance should be zero — paid in full.' }], letterId: 'l9', sentAt: null });
    w.invoices.push({ id: 'inv9abc', clientId: 'c9', description: 'Letter mailed', amount: 49, status: 'issued', issuedAt: signed, serviceCompletedAt: signed, payToken: 'paytokentest123' });
    w.referrals = w.referrals || [];
    w.referrals.push({ id: 'ref9', name: 'Pat Partner', email: 'pat@example.test', commissionType: 'flat', commissionAmount: 25 });
    w.clients.find(c => c.id === 'c9').referralId = 'ref9';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: w })).status, 200);

    assert.strictEqual((await owner('POST', '/api/disputes/d9/mail', { service: 'certified' })).status, 501, 'off until a key is saved');
    assert.strictEqual((await owner('PUT', '/api/settings/mail', { lobKey: 'nope' })).status, 400);
    const k = await owner('PUT', '/api/settings/mail', { lobKey: 'test_' + 'a'.repeat(30) });
    assert.strictEqual(k.status, 200); assert.strictEqual(k.body.mode, 'test');
    assert.ok(!fs.readFileSync(db.file, 'utf8').includes('test_' + 'a'.repeat(30)), 'Lob key encrypted at rest');
    const m = await owner('POST', '/api/disputes/d9/mail', { service: 'certified_return_receipt' });
    assert.strictEqual(m.status, 200, JSON.stringify(m.body));
    const sent = calls.filter(c => c.opts.method === 'POST' && c.u.endsWith('/letters')).pop();
    const body = JSON.parse(sent.opts.body);
    assert.strictEqual(body.to.address_city, 'Allen'); assert.strictEqual(body.to.address_state, 'TX');
    assert.strictEqual(body.from.name, 'Morgan Mailer'); assert.strictEqual(body.extra_service, 'certified_return_receipt');
    assert.strictEqual(body.use_type, 'operational'); assert.ok(body.file.includes('Please correct the balance'));
    let d = (await owner('GET', '/api/workspace')).body.data.disputes.find(x => x.id === 'd9');
    assert.strictEqual(d.sentAt.length, 10); assert.strictEqual(d.tracking, '9407000000000000000000'); assert.strictEqual(d.receivedAt, '2026-10-20');
    assert.strictEqual((await owner('POST', '/api/disputes/d9/mail', {})).status, 409, 'cannot mail twice');
    const t = await owner('POST', '/api/disputes/d9/mail/refresh');
    assert.strictEqual(t.body.deliveredAt, '2026-10-19');
    d = (await owner('GET', '/api/workspace')).body.data.disputes.find(x => x.id === 'd9');
    assert.strictEqual(d.receivedAt, '2026-10-19');
  } finally { globalThis.fetch = realFetch; }
});

test('invoice pay link uses Authorize.net hosted page and confirms payment', async () => {
  mockExternal();
  try {
    assert.strictEqual((await anon('GET', '/pay/nope')).status, 404);
    const none = await anon('GET', '/pay/paytokentest123');
    assert.match(none.body, /isn’t set up yet/);
    const s = await owner('PUT', '/api/settings/payments', { loginId: 'LOGIN1234', transactionKey: 'TXKEY', sandbox: true });
    assert.strictEqual(s.status, 200); assert.strictEqual(s.body.sandbox, true);
    const page = await anon('GET', '/pay/paytokentest123');
    assert.match(page.body, /test\.authorize\.net\/payment\/payment/); assert.match(page.body, /FORMTOKEN/);
    const done = await anon('GET', '/pay/paytokentest123/done');
    assert.match(done.body, /Thank you/);
    const inv = (await owner('GET', '/api/workspace')).body.data.invoices.find(i => i.id === 'inv9abc');
    assert.strictEqual(inv.status, 'paid'); assert.strictEqual(inv.transId, '555');
  } finally { globalThis.fetch = realFetch; }
});

test('referral partner portal shows referrals, hides progress without consent, and commissions', async () => {
  const partner = client();
  assert.strictEqual((await owner('POST', '/api/invites', { role: 'partner', referralId: 'missing' })).status, 404);
  const inv = await owner('POST', '/api/invites', { role: 'partner', referralId: 'ref9' });
  assert.match(inv.body.url, /\/partner#invite=/);
  const token = inv.body.url.split('invite=')[1];
  assert.strictEqual((await partner('POST', '/api/invites/accept', { token, password: 'partner password 1' })).status, 200);
  assert.strictEqual((await partner('GET', '/api/workspace')).status, 403);
  assert.strictEqual((await partner('GET', '/api/portal/me')).status, 403);
  const me = await partner('GET', '/api/partner/me');
  assert.strictEqual(me.status, 200);
  assert.match(me.body.link, /\/apply\?ref=ref9$/);
  const c = me.body.clients[0];
  assert.strictEqual(c.name, 'Morgan M.'); assert.strictEqual(c.progress, null, 'progress is private without consent');
  assert.strictEqual(me.body.commission.earned, 25);
  assert.ok(!JSON.stringify(me.body).includes('m@example.test'), 'no client contact details');
  assert.strictEqual((await anon('GET', '/partner')).status, 200);
});

test('a report uploaded in the portal creates an import task when AI is off', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const p2 = client();
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: 'c9' });
    await p2('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'client password 9' });
    const fd = new FormData();
    fd.append('type', 'report');
    fd.append('file', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'report.pdf');
    const cookie = await (async () => { const r = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'm@example.test', password: 'client password 9' }) }); return r.headers.get('set-cookie').split(';')[0]; })();
    const up = await realFetch(base + '/api/portal/files', { method: 'POST', body: fd, headers: { cookie } });
    assert.strictEqual(up.status, 200);
    await new Promise(r => setTimeout(r, 50));
    const w = (await owner('GET', '/api/workspace')).body.data;
    assert.ok(w.tasks.some(t => t.clientId === 'c9' && /Import the credit report/.test(t.title)));
  } finally { if (saved) process.env.ANTHROPIC_API_KEY = saved; }
});

test('invoices can be emailed with the PDF attached', async () => {
  assert.strictEqual((await owner('POST', '/api/invoices/inv9abc/email', {})).status, 501, 'email off until Resend is configured');
  process.env.LEDGER_RESEND_KEY = 're_test'; process.env.LEDGER_EMAIL_FROM = 'billing@example.test';
  let sent;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('https://api.resend.com/')) { sent = JSON.parse(opts.body); return new Response(JSON.stringify({ id: 'em_1' }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return realFetch(url, opts);
  };
  try {
    const r = await owner('POST', '/api/invoices/inv9abc/email', { message: 'Thanks for your business.' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(sent.to, ['m@example.test']);
    assert.match(sent.subject, /^Invoice INV-/);
    const pdf = Buffer.from(sent.attachments[0].content, 'base64').toString('latin1');
    assert.ok(pdf.startsWith('%PDF-1.4') && pdf.includes('Morgan Mailer'));
    assert.match(sent.attachments[0].filename, /\.pdf$/);
    const inv = (await owner('GET', '/api/workspace')).body.data.invoices.find(i => i.id === 'inv9abc');
    assert.strictEqual(inv.emailedTo, 'm@example.test');
  } finally { globalThis.fetch = realFetch; delete process.env.LEDGER_RESEND_KEY; delete process.env.LEDGER_EMAIL_FROM; }
});

test('pages stamp scripts with a build version and are never cached', async () => {
  const r = await anon('GET', '/');
  assert.match(r.body, /src="js\/app\.js\?v=[\w-]+"/);
  assert.match(r.body, /href="css\/app\.css\?v=[\w-]+"/);
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  const js = await anon('GET', '/js/app.js?v=x');
  assert.strictEqual(js.status, 200);
  assert.strictEqual(js.headers.get('cache-control'), 'no-cache');
});
