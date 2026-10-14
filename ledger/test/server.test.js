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
  assert.match(ctx, /CLIENT FILE — Jordan Sample/);
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
