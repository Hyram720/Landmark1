// QA / hardening tests (2026-10-19). Run: npm run test:ledger
// Every external call is mocked: AI via setAiFetch, email via setTransport. No real keys are used.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Metro2 as M, DisputeReasons as R } from '../server/shared.js';
import { createApp } from '../server/app.js';
import { setAiFetch } from '../server/ledger-assistant.js';
import { setTransport } from '../server/mailer.js';
import { redact } from '../server/redact.js';

for (const k of ['OPENAI_API_KEY', 'LEDGER_AI_ENABLED', 'LEDGER_MAIL_MODE', 'ANTHROPIC_API_KEY', 'LEDGER_SETUP_CODE']) delete process.env[k];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-qa-'));
const built = createApp({ dataDir: dir, encryptionKey: 'qa-test-key-not-a-secret-000' });
const { app, db } = built;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { setAiFetch((...a) => fetch(...a)); setTransport(null); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client(extraHeaders = {}) {
  const jar = {};
  const f = async (method, url, body, headers = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, extraHeaders, headers, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
  f.jar = jar;
  return f;
}

const owner = client();
const anon = client();
const alice = client();
const bob = client();
let version;
const outbox = [];

async function saveWs(mutate) {
  const g = await owner('GET', '/api/workspace');
  mutate(g.body.data);
  const p = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
  assert.strictEqual(p.status, 200, JSON.stringify(p.body));
  version = p.body.version;
  return g.body.data;
}

test('setup + seed two synthetic clients with reports', async () => {
  assert.strictEqual((await owner('POST', '/api/setup', { name: 'QA Owner', email: 'owner@qa.test', password: 'qa owner password 1' })).status, 200);
  await saveWs(ws => {
    ws.clients.push({ id: 'ca', name: 'Alice Example', firstName: 'Alice', lastName: 'Example', kind: 'personal', email: 'alice@qa.test', dob: '1980-02-03', ssnLast4: '6789', address: '1 Test St\nTrenton, NJ 08601', status: 'active', onboarding: {} });
    ws.clients.push({ id: 'cb', name: 'Bob Example', firstName: 'Bob', lastName: 'Example', kind: 'personal', email: 'bob@qa.test', status: 'active', onboarding: {} });
    ws.reports = ws.reports || [];
    ws.reports.push({ id: 'rep-a', clientId: 'ca', bureau: 'Experian', date: '2026-10-01', accounts: [
      { id: 'ta1', creditor: 'Example Card Co', accountNumber: '4111222233334444', status: '11', balance: 240, pastDue: 75 },
      { id: 'ta2', creditor: 'Fine Bank', accountNumber: '9999888877776666', status: '11', balance: 100, pastDue: 0 }
    ] });
    ws.partnerReferrals.push({ id: 'ref-a', clientId: 'ca', offerId: 'offer-creditstrong', status: 'recommended', clicks: 0 });
    ws.partnerReferrals.push({ id: 'ref-b', clientId: 'cb', offerId: 'offer-creditstrong', status: 'recommended', clicks: 0 });
    ws.offers.find(o => o.key === 'creditstrong').affiliateUrl = 'https://www.creditstrong.com/?ref=qa';
  });
  for (const [c, who, pw] of [[alice, 'ca', 'alice password 1'], [bob, 'cb', 'bob password 12']]) {
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: who });
    assert.strictEqual((await c('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: pw })).status, 200);
  }
});

// ---------- platform ----------
test('health endpoint, security headers, JSON 404 and malformed cookies', async () => {
  for (const p of ['/api/health', '/healthz']) {
    const h = await anon('GET', p);
    assert.strictEqual(h.status, 200, p);
    assert.strictEqual(h.body.ok, true);
    assert.strictEqual(h.body.encrypted, true);
    assert.ok(!JSON.stringify(h.body).includes('qa-test-key'), 'no secrets in health');
  }
  const r = await anon('GET', '/');
  assert.match(r.headers.get('content-security-policy') || '', /object-src 'none'/);
  assert.match(r.headers.get('content-security-policy') || '', /base-uri/);
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  const nf = await anon('GET', '/api/does-not-exist');
  assert.strictEqual(nf.status, 404);
  assert.strictEqual(typeof nf.body, 'object');
  const bad = await fetch(base + '/api/session', { headers: { cookie: 'ledger_session=%E0%A4%A; other=%%%' } });
  assert.strictEqual(bad.status, 200, 'malformed cookie does not crash');
  const forged = await fetch(base + '/api/workspace', { headers: { cookie: 'ledger_session=eyJ4Ijoi.bm90LWpzb24' } });
  assert.strictEqual(forged.status, 401);
});

test('versioned static assets are cached immutably; pages are not', async () => {
  const page = await anon('GET', '/');
  const m = String(page.body).match(/js\/app\.js\?v=([\w.-]+)/);
  if (m) {
    const a = await fetch(base + '/js/app.js?v=' + m[1]);
    assert.match(a.headers.get('cache-control') || '', /immutable/);
  }
  assert.doesNotMatch(page.headers.get('cache-control') || '', /immutable/);
});

test('oversized public bodies are rejected with JSON 413', async () => {
  const r = await anon('POST', '/api/intake', { firstName: 'A', lastName: 'B', email: 'a@qa.test', consent: true, goals: 'x'.repeat(40 * 1024) });
  assert.strictEqual(r.status, 413);
  assert.ok(r.body.error);
});

test('login: spoofed X-Forwarded-For cannot bypass the per-account limit', async () => {
  let last;
  for (let i = 0; i < 22; i++) last = await anon('POST', '/api/login', { email: 'victim@qa.test', password: 'wrong guess ' + i }, { 'x-forwarded-for': `203.0.113.${i}` });
  assert.strictEqual(last.status, 429);
  assert.match(last.body.error, /this account/);
});

test('intake validation: email, state, SMS needs phone; SSNs are scrubbed', async () => {
  const ip = { 'x-forwarded-for': '198.51.100.7' };
  assert.strictEqual((await anon('POST', '/api/intake', { firstName: 'A', lastName: 'B', email: 'nope', consent: true }, ip)).status, 400);
  assert.strictEqual((await anon('POST', '/api/intake', { firstName: 'A', lastName: 'B', email: 'a@qa.test', state: 'New Jersey', consent: true }, ip)).status, 400);
  assert.strictEqual((await anon('POST', '/api/intake', { firstName: 'A', lastName: 'B', email: 'a@qa.test', smsConsent: true, consent: true }, ip)).status, 400);
  const ok = await anon('POST', '/api/intake', { firstName: 'Casey', lastName: 'Lead', email: 'casey@qa.test', state: 'nj', goals: 'my ssn is 123-45-6789 please help', consent: true }, ip);
  assert.strictEqual(ok.status, 200);
  const ws = (await owner('GET', '/api/workspace')).body.data;
  const lead = ws.clients.find(c => c.email === 'casey@qa.test');
  assert.strictEqual(lead.state, 'NJ');
  assert.ok(!JSON.stringify(lead).includes('123-45-6789'), 'SSN removed from free text');
});

test('pay page: CROA guard refuses payment before service is complete / window cleared', async () => {
  await saveWs(ws => { ws.invoices = ws.invoices || []; ws.invoices.push({ id: 'inv1', clientId: 'cb', amount: 99, description: 'Round 1', status: 'open', payToken: 'paytokqa1' }); });
  const r = await anon('GET', '/pay/paytokqa1');
  assert.strictEqual(r.status, 409);
  assert.match(r.body, /can’t be paid online yet/);
});

// ---------- IDOR / role separation ----------
test('IDOR: client A cannot reach client B data, files or links; clients cannot use staff routes', async () => {
  const a = await alice('GET', '/api/portal/me');
  const b = await bob('GET', '/api/portal/me');
  assert.strictEqual(a.body.client.name, 'Alice Example');
  assert.strictEqual(b.body.client.name, 'Bob Example');
  assert.ok(!JSON.stringify(a.body).includes('Bob Example'));
  // Owner uploads a file for Bob.
  const fd = new FormData();
  fd.append('type', 'report');
  fd.append('file', new Blob(['%PDF-1.4 bob only'], { type: 'application/pdf' }), 'bob.pdf');
  const ownerCookie = Object.entries(owner.jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const up = await fetch(base + '/api/clients/cb/files', { method: 'POST', headers: { cookie: ownerCookie }, body: fd });
  const { doc } = await up.json();
  assert.strictEqual((await bob('GET', `/api/files/${doc.id}`)).status, 200);
  assert.notStrictEqual((await alice('GET', `/api/files/${doc.id}`)).status, 200, 'Alice cannot download Bob’s file');
  assert.strictEqual((await alice('GET', '/go/ref-b')).status, 404, 'Alice cannot click Bob’s tracked link');
  assert.strictEqual((await alice('GET', '/go/ref-a')).status, 302);
  for (const [m, u] of [['GET', '/api/workspace'], ['GET', '/api/users'], ['GET', '/api/clients/cb/dispute-suggestions'], ['POST', '/api/letters/draft'], ['POST', '/api/assistant/staff'], ['GET', '/api/partners/clicks'], ['GET', '/api/settings/auth'], ['GET', '/api/kb']]) {
    assert.strictEqual((await alice(m, u, m === 'POST' ? {} : undefined)).status, 403, `${m} ${u}`);
  }
  assert.strictEqual((await owner('GET', '/api/portal/me')).status, 403, 'staff are not clients');
});

// ---------- rules engine + letters ----------
test('dispute suggestions come only from findings; accurate tradelines produce none', async () => {
  const r = await owner('GET', '/api/clients/ca/dispute-suggestions');
  assert.strictEqual(r.status, 200);
  const s = r.body.suggestions;
  assert.ok(s.some(x => x.accountId === 'ta1' && x.code === 'M2-CURRENT-PASTDUE'));
  assert.ok(!s.some(x => x.accountId === 'ta2'), 'accurate account is not disputable');
  assert.ok(s.every(x => !/guarantee/i.test(x.discrepancy)));
  assert.strictEqual(s.find(x => x.accountId === 'ta1').accountNumber, '4444');
});

test('letters/draft: refuses items with no identified inaccuracy', async () => {
  const r = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta2', code: 'M2-CURRENT-PASTDUE' }] });
  assert.strictEqual(r.status, 400);
  const mixed = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }, { accountId: 'ta2', code: 'MADE-UP' }] });
  assert.strictEqual(mixed.status, 400);
});

test('letters/draft: template when AI is off, with citations and approval required', async () => {
  const r = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.mode, 'template');
  assert.strictEqual(r.body.requiresApproval, true);
  assert.ok(r.body.citations.some(c => c.id === 'fcra-611'));
  assert.match(r.body.text, /§ 611/);
  assert.ok(!r.body.text.includes('4111222233334444'), 'full account number never printed');
  assert.doesNotMatch(r.body.text, /guarantee/i);
});

test('letters/draft: AI mode sends only the redacted body; output is checked', async () => {
  process.env.LEDGER_AI_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  let payload = '';
  setAiFetch(async (url, opts) => {
    payload = opts.body;
    const sent = JSON.parse(opts.body).messages[1].content;
    return new Response(JSON.stringify({ model: 'mock', usage: { prompt_tokens: 900, completion_tokens: 400 }, choices: [{ message: { content: sent.replace('Re:', 'Re:') + '\nThank you for reviewing this.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const r = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }], newEvidence: 'statement attached; my SSN 123-45-6789; card 4111 2222 3333 4444' });
    assert.strictEqual(r.status, 200);
    // The echo mock returns "[SSN REDACTED]": the AI version lost a fact, so the template is used instead.
    assert.strictEqual(r.body.mode, 'template');
    assert.ok(payload, 'AI was called');
    for (const leak of ['123-45-6789', '4111222233334444', '4111 2222 3333 4444', 'Alice', '1980-02-03', '1 Test St', 'sk-test-not-real']) {
      const inMessages = JSON.stringify(JSON.parse(payload).messages);
      assert.ok(!inMessages.includes(leak), 'payload leaked ' + leak);
    }
    assert.match(r.body.text, /Alice Example/, 'header/signature re-attached locally');
    const rClean = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }], newEvidence: 'statement attached' });
    assert.strictEqual(rClean.body.mode, 'ai');
    assert.match(rClean.body.text, /Alice Example/, 'header/signature re-attached locally');
    // A model that promises results is replaced with the template.
    setAiFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'We guarantee this will be deleted.' } }] }), { status: 200 }));
    const r2 = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }] });
    assert.strictEqual(r2.body.mode, 'template');
    assert.doesNotMatch(r2.body.text, /guarantee/i);
    // AI outage falls back to the template.
    setAiFetch(async () => new Response('{}', { status: 500 }));
    const r3 = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }] });
    assert.strictEqual(r3.body.mode, 'template');
    assert.ok(r3.body.notice);
  } finally { delete process.env.LEDGER_AI_ENABLED; delete process.env.OPENAI_API_KEY; setAiFetch((...a) => fetch(...a)); }
});

test('letters/draft: near-duplicate repeats are blocked (FCRA § 611(a)(3))', async () => {
  const sug = (await owner('GET', '/api/clients/ca/dispute-suggestions')).body.suggestions.find(x => x.accountId === 'ta1');
  await saveWs(ws => { ws.disputes = ws.disputes || []; ws.disputes.push({ id: 'd-pend', clientId: 'ca', recipient: 'Experian', type: 'cra_611', round: 1, sentAt: '2026-10-05', dueAt: '2026-11-09', items: [{ accountId: 'ta1', creditor: 'Example Card Co', discrepancy: sug.discrepancy }] }); });
  const r = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }] });
  assert.strictEqual(r.status, 409);
  assert.match(r.body.blocked[0].why, /awaiting a response/);
  await saveWs(ws => { const d = ws.disputes.find(x => x.id === 'd-pend'); d.outcome = 'verified'; d.items[0].result = 'verified'; d.respondedAt = '2026-10-15'; });
  assert.strictEqual((await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }] })).status, 409, 'same reason after verification is blocked');
  const esc = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', letterType: 'mov_611a7', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }] });
  assert.strictEqual(esc.status, 200, 'escalation (method of verification) is allowed');
  const ev = await owner('POST', '/api/letters/draft', { clientId: 'ca', recipient: 'Experian', items: [{ accountId: 'ta1', code: 'M2-CURRENT-PASTDUE' }], newEvidence: 'Statement dated 2026-09-30 showing $0 past due' });
  assert.strictEqual(ev.status, 200, 'new evidence allows a new round');
});

test('unit: re-aging, duplicate collections, stale XB, repeat guard', () => {
  const cur = { bureau: 'Experian', accounts: [{ id: 'x', creditor: 'Collector A', status: '93', balance: 500, dofd: '2023-06-01', originalCreditor: 'Bank' }] };
  const prev = { bureau: 'Experian', accounts: [{ id: 'x', creditor: 'Collector A', status: '93', balance: 500, dofd: '2021-01-01', originalCreditor: 'Bank' }] };
  assert.ok(M.compareOverTime(prev, cur).some(f => f.code === 'M2-DOFD-MOVED'));
  const dup = M.duplicateCollections([{ id: '1', creditor: 'Collector A', status: '93', balance: 300, originalCreditor: 'Bank One' }, { id: '2', creditor: 'Collector B', status: '93', balance: 300, originalCreditor: 'Bank One' }]);
  assert.ok(dup.length >= 1);
  const ok = R.checkRepeat({ items: [{ accountId: 'q', creditor: 'Z', discrepancy: 'a' }], recipient: 'Experian', letterType: 'cra_611', priorDisputes: [] });
  assert.strictEqual(ok.ok, true);
  const many = R.checkRepeat({ items: Array.from({ length: 8 }, (_, i) => ({ accountId: 'q' + i, creditor: 'Z' + i, discrepancy: 'a' })), recipient: 'Experian', letterType: 'cra_611', priorDisputes: [] });
  assert.ok(many.warnings.length, 'long lists warn');
});

test('redaction masks SSN, DOB, card/account numbers and contact data but keeps dates', () => {
  const t = redact('SSN 123-45-6789, DOB: 02/03/1980, acct 4111222233334444, email a@b.com, phone (609) 555-1212, opened 2021-05-01');
  assert.ok(!t.includes('123-45-6789') && !t.includes('02/03/1980') && !t.includes('4111222233334444') && !t.includes('a@b.com') && !t.includes('555-1212'));
  assert.match(t, /\*{4}4444/);
  assert.match(t, /2021-05-01/);
});

// ---------- assistant ----------
test('assistant: staff offline summary, client-facing FAQ and rate limit', async () => {
  const s = await owner('POST', '/api/assistant/staff', { clientId: 'ca', history: [{ role: 'user', content: 'What should we dispute?' }] });
  assert.strictEqual(s.status, 200);
  assert.strictEqual(s.body.mode, 'offline');
  assert.ok(s.body.suggestions.length);
  const p = await anon('POST', '/api/assistant/public', { message: 'Can you guarantee my score goes up?', page: 'apply' });
  assert.strictEqual(p.body.mode, 'faq');
  assert.doesNotMatch(p.body.text, /\bwe guarantee\b/i);
  const helper = client();
  let last;
  for (let i = 0; i < 21; i++) last = await helper('POST', '/api/assistant/public', { message: 'how long does it take?', page: 'portal' }, { 'x-forwarded-for': '192.0.2.' + i });
  assert.strictEqual(last.status, 429, 'per-session limit');
});

test('assistant: AI mode is grounded, redacted, and logs metadata only', async () => {
  process.env.LEDGER_AI_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  let sent;
  setAiFetch(async (url, opts) => { sent = JSON.parse(opts.body); return new Response(JSON.stringify({ usage: { prompt_tokens: 3000, completion_tokens: 300 }, choices: [{ message: { content: 'The Experian tradeline shows status 11 with $75 past due, which conflicts [m2-status]. Next: dispute under [fcra-611].' } }] }), { status: 200 }); });
  try {
    const s = await owner('POST', '/api/assistant/staff', { clientId: 'ca', history: [{ role: 'user', content: 'Explain. Her SSN is 123-45-6789' }] });
    assert.strictEqual(s.body.mode, 'ai');
    const all = JSON.stringify(sent.messages);
    assert.ok(!all.includes('123-45-6789') && !all.includes('Alice') && !all.includes('4111222233334444'));
    assert.match(sent.messages[0].content, /KNOWLEDGE BASE/);
    const audit = (await owner('GET', '/api/audit')).body.filter(a => a.action === 'assistant.staff');
    assert.ok(audit.length && audit.every(a => !/status 11|SSN|Explain/.test(a.detail)), 'audit holds metadata only');
  } finally { delete process.env.LEDGER_AI_ENABLED; delete process.env.OPENAI_API_KEY; setAiFetch((...a) => fetch(...a)); }
});

// ---------- partner links ----------
test('partner links: hashed sub-ID, metadata-only click log, admin report', async () => {
  const off = await anon('GET', '/go/partner/nav');
  assert.strictEqual(off.status, 404, 'no link until the owner pastes one');
  const r = await alice('GET', '/go/partner/creditstrong');
  assert.strictEqual(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /^https:\/\/www\.creditstrong\.com\//);
  assert.ok(!loc.includes('ca') || /c-[\w-]{10}/.test(loc) || !/[?&]\w+=ca\b/.test(loc), 'client id is not exposed raw');
  db.flush();
  const rep = await owner('GET', '/api/partners/clicks');
  const cs = rep.body.offers.find(o => o.key === 'creditstrong');
  assert.ok(cs.total >= 1);
  assert.ok(cs.byRole.client >= 1);
  assert.match(rep.body.disclosure, /commission/i);
  const raw = JSON.stringify(db.data.partnerClicks);
  assert.ok(!raw.includes('alice@qa.test') && !raw.includes('127.0.0.1'), 'no emails or IPs in click log');
});

// ---------- sign-in upgrades ----------
test('forgot password: neutral response, single-use hashed token, sessions revoked', async () => {
  setTransport(async m => { outbox.push(m); });
  try {
    const known = await anon('POST', '/api/auth/forgot', { email: 'alice@qa.test' });
    const unknown = await anon('POST', '/api/auth/forgot', { email: 'nobody@qa.test' });
    assert.strictEqual(known.status, 200);
    assert.deepStrictEqual(known.body, unknown.body, 'same response either way');
    const mail = outbox.find(m => m.to === 'alice@qa.test' && /reset/i.test(m.subject));
    assert.ok(mail, 'reset email sent via mock transport');
    const token = mail.text.match(/reset=([\w-]+)/)[1];
    assert.ok(!JSON.stringify(db.data.authTokens || []).includes(token), 'token stored hashed');
    assert.strictEqual((await alice('GET', '/api/portal/me')).status, 200);
    assert.strictEqual((await anon('POST', '/api/auth/reset', { token, password: 'short' })).status, 400);
    assert.strictEqual((await anon('POST', '/api/auth/reset', { token, password: 'alice new password 2' })).status, 200);
    assert.strictEqual((await anon('POST', '/api/auth/reset', { token, password: 'alice new password 3' })).status, 400, 'single use');
    assert.strictEqual((await alice('GET', '/api/portal/me')).status, 401, 'old session revoked (sessionEpoch bumped)');
    assert.strictEqual((await alice('POST', '/api/login', { email: 'alice@qa.test', password: 'alice new password 2' })).status, 200);
  } finally { setTransport(null); }
});

test('magic link and email code are off by default and need mail; then work once', async () => {
  assert.strictEqual((await anon('GET', '/api/auth/options')).body.magicLink, false);
  assert.strictEqual((await owner('PUT', '/api/settings/auth', { magicLink: true })).status, 400, 'refused without outbound email');
  const neutral = await anon('POST', '/api/auth/magic', { email: 'bob@qa.test' });
  assert.ok(neutral.status === 200 || neutral.status === 404);
  setTransport(async m => { outbox.push(m); });
  try {
    assert.strictEqual((await owner('PUT', '/api/settings/auth', { magicLink: true, emailOtp: true })).status, 200);
    await anon('POST', '/api/auth/magic', { email: 'bob@qa.test' });
    const ml = outbox.filter(m => m.to === 'bob@qa.test').pop();
    const mtok = ml.text.match(/magic=([\w-]+)/)[1];
    const fresh = client();
    assert.strictEqual((await fresh('POST', '/api/auth/magic/verify', { token: mtok })).status, 200);
    assert.strictEqual((await fresh('GET', '/api/portal/me')).body.client.name, 'Bob Example');
    assert.strictEqual((await client()('POST', '/api/auth/magic/verify', { token: mtok })).status, 400, 'magic link is single use');
    // Email code after password
    const two = client();
    const l = await two('POST', '/api/login', { email: 'bob@qa.test', password: 'bob password 12' });
    assert.strictEqual(l.body.otpRequired, true);
    assert.strictEqual((await two('GET', '/api/portal/me')).status, 401, 'no session before the code');
    const code = outbox.filter(m => m.to === 'bob@qa.test').pop().text.match(/\b(\d{6})\b/)[1];
    const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
    assert.strictEqual((await two('POST', '/api/auth/otp', { code: wrong })).status, 400);
    assert.strictEqual((await two('POST', '/api/auth/otp', { code })).status, 200);
    assert.strictEqual((await two('GET', '/api/portal/me')).status, 200);
  } finally {
    await owner('PUT', '/api/settings/auth', { magicLink: false, emailOtp: false });
    setTransport(null);
  }
});

test('notifications: response email on save, opt-out respected', async () => {
  setTransport(async m => { outbox.push(m); });
  try {
    const n = await bob('GET', '/api/portal/notifications');
    assert.strictEqual(n.status, 200);
    assert.strictEqual(n.body.email, true);
    await saveWs(ws => { ws.disputes.push({ id: 'd-bob', clientId: 'cb', recipient: 'Equifax', type: 'cra_611', round: 1, sentAt: '2026-09-01', dueAt: '2026-10-06', items: [{ accountId: 'z', creditor: 'Some Lender' }] }); });
    const before = outbox.length;
    await saveWs(ws => { const d = ws.disputes.find(x => x.id === 'd-bob'); d.respondedAt = '2026-10-10'; d.outcome = 'deleted'; d.items[0].result = 'deleted'; });
    const sent = outbox.slice(before).filter(m => m.to === 'bob@qa.test');
    assert.ok(sent.length >= 1, 'Bob was emailed');
    assert.ok(sent.every(m => !/Some Lender|\d{8,}/.test(m.text)), 'emails carry no account details');
    assert.strictEqual((await bob('PUT', '/api/portal/notifications', { email: false })).status, 200);
    const b2 = outbox.length;
    await saveWs(ws => { ws.disputes.push({ id: 'd-bob2', clientId: 'cb', recipient: 'Experian', type: 'cra_611', round: 1, sentAt: '2026-09-01', dueAt: '2026-10-06', respondedAt: '2026-10-11', outcome: 'corrected', items: [{ accountId: 'y', creditor: 'Other', result: 'corrected' }] }); });
    assert.strictEqual(outbox.slice(b2).filter(m => m.to === 'bob@qa.test').length, 0, 'opt-out respected');
  } finally { setTransport(null); }
});

test('portal payload includes deadline fields for the 30/45-day bar', async () => {
  const me = await bob('GET', '/api/portal/me');
  const d = me.body.disputes.find(x => x.sentAt);
  assert.ok(d && 'dueAt' in d && 'receivedAt' in d);
});

// ---------- persistence ----------
test('graceful shutdown flushes batched writes; daily encrypted snapshot exists', async () => {
  await alice('GET', '/go/partner/creditstrong');
  await built.shutdown();
  const raw = fs.readFileSync(db.file, 'utf8');
  assert.ok(!raw.includes('Alice Example'), 'still encrypted at rest');
  const snaps = fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : [];
  assert.ok(snaps.some(f => /^ledger-db-\d{4}-\d{2}-\d{2}\.json$/.test(f)), 'daily snapshot written');
  assert.ok(!fs.readFileSync(path.join(dir, 'backups', snaps[0]), 'utf8').includes('Alice Example'), 'snapshot encrypted');
});
