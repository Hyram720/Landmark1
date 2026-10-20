// Business credit, coach/utilization, and the accuracy checker beyond Metro 2 (2026-10-19 scope).
// AI and email are mocked. Identity theft is out of scope and must not be offered anywhere.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { setAiFetch, clientDigest } from '../server/ledger-assistant.js';
import { setTransport } from '../server/mailer.js';
import { FileCheck, Business, DisputeReasons, Law, KB, Letters } from '../server/shared.js';

for (const k of ['OPENAI_API_KEY', 'LEDGER_AI_ENABLED', 'LEDGER_MAIL_MODE', 'LEDGER_SETUP_CODE']) delete process.env[k];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-biz-'));
const built = createApp({ dataDir: dir, encryptionKey: 'biz-test-key-not-a-secret-0000' });
const { app, db, auth } = built;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { setAiFetch((...a) => fetch(...a)); setTransport(null); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  const jar = {};
  return async (method, url, body) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
}
const owner = client(), bizA = client(), bizB = client(), anon = client();
const today = new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const personalReport = {
  id: 'pr1', clientId: 'pa', bureau: 'Equifax', date: today,
  personal: { names: ['Pat Example', 'Patricia Q Sample'], addresses: ['12 Main St, Newark NJ', '99 Nowhere Ave, Reno NV'], employers: ['Acme Corp', 'Unknown Widgets'], dobs: ['1979-01-01'], ssnLast4s: ['9999'] },
  inquiries: [{ id: 'q1', creditor: 'Mystery Bank', date: addDays(today, -40), kind: 'hard', clientSays: 'unrecognized' }, { id: 'q2', creditor: 'Old Auto', date: addDays(today, -800), kind: 'hard' }, { id: 'q3', creditor: 'My Card', date: addDays(today, -20), kind: 'hard', clientSays: 'authorized' }],
  accounts: [
    { id: 'a1', creditor: 'Accurate Collector', status: '93', balance: 300, dofd: addDays(today, -400), originalCreditor: 'Bank', accountNumber: '1111' },
    { id: 'a2', creditor: 'Disputed Lender', status: '71', balance: 200, pastDue: 50, dofd: addDays(today, -200), clientSays: 'unrecognized', clientExplanation: 'I paid this account in full in March; statement attached.' },
    { id: 'a3', creditor: 'No Reason Given', status: '71', balance: 90, pastDue: 30, dofd: addDays(today, -100), clientSays: 'unrecognized' },
    { id: 'a4', creditor: 'Says Not Mine', status: '93', balance: 500, dofd: addDays(today, -300), originalCreditor: 'X', clientSays: 'not-mine' }
  ]
};
const personalClient = { id: 'pa', name: 'Pat Example', firstName: 'Pat', lastName: 'Example', address: '12 Main St, Newark NJ', aka: [], employers: ['Acme Corp'], dob: '1980-05-05', ssnLast4: '1234' };

test('personal file checks: identifiers, inquiries, consumer-asserted; accurate negatives left alone', () => {
  const f = FileCheck.personalChecks(personalReport, personalClient, { today });
  const codes = f.map(x => x.code);
  for (const c of ['PII-NAME-VARIANT', 'PII-ADDRESS-UNKNOWN', 'PII-EMPLOYER-UNKNOWN', 'PII-DOB-VARIATION', 'PII-SSN-VARIATION', 'INQ-UNRECOGNIZED', 'INQ-OVER-2Y', 'CONSUMER-ASSERTED', 'CONSUMER-ASSERTED-NEEDS-REASON']) assert.ok(codes.includes(c), c);
  assert.strictEqual(f.filter(x => x.code === 'PII-NAME-VARIANT').length, 1, 'the client’s own name is not flagged');
  assert.ok(!f.some(x => x.creditor === 'My Card'), 'authorized inquiry is not disputed');
  const masked = f.filter(x => /DOB|SSN/.test(x.code));
  assert.ok(masked.every(x => !x.detail.includes('1979-01-01') && !x.detail.includes('9999')), 'DOB/SSN values are never echoed');
  assert.ok(!f.some(x => /NOT-MINE|ID-THEFT|605B/.test(x.code)), 'no not-mine / identity-theft path');
  const left = FileCheck.notDisputed(personalReport, f);
  assert.ok(left.some(l => l.creditor === 'Accurate Collector' && /can’t be removed/.test(l.why)));
  const items = f.map(x => DisputeReasons.toItem(x, personalReport.accounts.find(a => a.id === x.accountId))).filter(Boolean);
  assert.ok(!items.some(i => i.code === 'CONSUMER-ASSERTED-NEEDS-REASON'), 'no letter without a stated reason');
  const dob = items.find(i => i.code === 'PII-DOB-VARIATION');
  assert.strictEqual(dob.letterType, 'pii_611');
  assert.ok(!dob.discrepancy.includes('1979'));
  assert.strictEqual(items.find(i => i.code === 'INQ-UNRECOGNIZED').letterType, 'inquiry_604');
  assert.match(items.find(i => i.code === 'PII-ADDRESS-UNKNOWN').discrepancy, /\[CONFIRM/);
});

const bizClient = (id, extra) => Object.assign({ id, name: 'Owner ' + id, firstName: 'Owner', lastName: id, kind: 'business', email: `${id}@biz.test`, status: 'active', address: '77 Demo Market St', city: 'Denver', state: 'CO', zip: '80202', onboarding: {},
  business: { legalName: `Example ${id} Bakery LLC`, dba: 'Example Bakes', entityType: 'LLC', formedOn: '2023-05-01', naics: '311811', sic: '2051', phone: '(555) 010-0199', duns: '00-000-0000', einLast4: '4321' },
  businessChecklist: { entity: today, ein: today },
  businessScores: [{ id: 's1', model: 'paydex', score: 72, date: addDays(today, -30), source: 'Nav' }, { id: 's2', model: 'intelliscore', score: 54, date: today, source: 'Nav' }],
  vendorAccounts: [{ id: 'v1', vendor: 'Uline', terms: 'Net 30', limit: 1000, balance: 600, status: 'current', reportsTo: 'D&B' }, { id: 'v2', vendor: 'Quill', terms: 'Net 30', limit: 500, balance: 50, status: 'closed', reportsTo: 'D&B' }],
  creditLines: [{ id: 'l1', name: 'Biz Card', kind: 'card', limit: 5000, balance: 2000, personalGuarantee: true, reportsToPersonal: true }],
  creditPlan: { startedAt: addDays(today, -8) } }, extra || {});
const bizReport = (id) => ({ id: 'br-' + id, bureau: 'Experian Business', date: today,
  profile: { name: 'Different Name Inc', address: '1 Wrong Rd, Austin TX', phone: '555-999-0000', formedOn: '2019-01-01', naics: '722511', sic: '5812' },
  tradelines: [
    { id: 't1', creditor: 'Quill', accountNumber: '2222', status: 'open', balance: 0, limit: 500 },
    { id: 't2', creditor: 'Old Supply Co', accountNumber: '3333', status: 'open', balance: 400, lastReported: addDays(today, -500) },
    { id: 't3', creditor: 'Paid Vendor', accountNumber: '4444', status: 'paid', balance: 120 },
    { id: 't4', creditor: 'Uline', accountNumber: '5555', status: 'open', balance: 600, opened: '2026-08-01' },
    { id: 't5', creditor: 'Uline', accountNumber: '5555', status: 'open', balance: 600, opened: '2026-08-01' },
    { id: 't6', creditor: 'Someone Else', accountNumber: '6666', status: 'open', balance: 10, clientSays: 'not-ours' }
  ],
  publicRecords: [{ id: 'pr1', type: 'ucc', filedOn: '2024-02-01', status: 'open', securedParty: 'Example Equipment Finance', clientSatisfiedOn: '2025-09-15', docRef: 'UCC-3 termination' }] });

test('business file checks: profile mismatches, closed/stale/paid/duplicate tradelines, satisfied UCC', () => {
  const c = bizClient('x');
  const f = FileCheck.businessChecks(bizReport('x'), c, { today });
  const codes = f.map(x => x.code);
  for (const k of ['BIZ-NAME-MISMATCH', 'BIZ-ADDRESS-MISMATCH', 'BIZ-PHONE-MISMATCH', 'BIZ-FORMED-MISMATCH', 'BIZ-NAICS-MISMATCH', 'BIZ-SIC-MISMATCH', 'BIZ-TL-CLOSED-OPEN', 'BIZ-TL-STALE', 'BIZ-TL-PAID-BALANCE', 'BIZ-TL-DUPLICATE', 'BIZ-PR-SATISFIED-OPEN']) assert.ok(codes.includes(k), k);
  assert.ok(!f.some(x => x.creditor === 'Someone Else'), 'no “not ours” path');
  const same = FileCheck.businessChecks({ bureau: 'Dun & Bradstreet', profile: { name: 'Example x Bakery, L.L.C.', address: '77 Demo Market Street, Denver, CO 80202', phone: '555.010.0199', formedOn: '2023-05-10', naics: '311811' }, tradelines: [], publicRecords: [] }, c, { today });
  assert.strictEqual(same.length, 0, 'matching profile (formatting differences only) is not flagged');
  const yrs = FileCheck.businessChecks({ bureau: 'Dun & Bradstreet', profile: { yearsInBusiness: 9 }, tradelines: [] }, c, { today });
  assert.ok(yrs.some(x => x.code === 'BIZ-YEARS-MISMATCH'));
});

test('utilization: per account, overall, personal incl. owner-guaranteed; tips are “may”, no promises', () => {
  const c = bizClient('u');
  const ws = { reports: [{ id: 'r', clientId: 'u', bureau: 'Experian', date: today, accounts: [{ id: 'p1', type: 'R', balance: 900, limit: 1000 }, { id: 'p2', type: 'R', balance: 0, limit: 4000 }] }] };
  const u = Business.utilization(c, ws);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(u.business.accounts.map(a => [a.name, a.pct]))), [['Uline', 60], ['Biz Card', 40]], 'closed vendor excluded');
  assert.strictEqual(u.business.pct, Math.round(2600 / 6000 * 100));
  assert.strictEqual(u.personal[0].pct, Math.round((900 + 2000) / (5000 + 5000) * 100), 'guaranteed card that reports personally is included');
  assert.ok(u.tips.length >= 2 && u.tips.every(t => !/will (raise|increase|improve)|guarantee/i.test(t)));
  assert.ok(u.tips.some(t => /statement closing date/.test(t)) && u.tips.some(t => /PAYDEX/.test(t)));
  assert.ok(KB.byId('biz-util-intelliscore') && KB.byId('biz-paydex-timing') && KB.byId('util-30') && KB.byId('util-guarantee'));
});

test('identity theft is removed: no letter type, no KB rule, letters refuse it', () => {
  assert.strictEqual(Law.DISPUTE_TYPES.block_605b, undefined);
  assert.ok(!KB.rules.some(r => /605B|1681c-2|identity-theft block|mixed-file/i.test(r.id + r.cite + r.title)));
  assert.ok(!Letters.build('block_605b', { client: { name: 'X' }, recipient: { name: 'Y' }, items: [{ creditor: 'Z', discrepancy: 'something specific here' }], today: 'x' }).ok);
  assert.strictEqual(Law.typeInfo('block_605b').retired, true, 'old records still display');
  assert.ok(!Object.keys(DisputeReasons.MAP).some(k => /NOT-MINE|NOT-OURS|ID-THEFT/.test(k)));
});

test('setup: owner, two business clients with portal logins, one personal client', async () => {
  assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@biz.test', password: 'biz owner password 1' })).status, 200);
  const g = await owner('GET', '/api/workspace');
  const ws = g.body.data;
  const A = bizClient('ba', { businessReports: [bizReport('ba')] });
  const B = bizClient('bb', { creditPlan: { startedAt: addDays(today, -1) } });
  ws.clients.push(A, B, Object.assign({}, personalClient, { kind: 'personal', status: 'active', email: 'pat@biz.test', onboarding: {} }));
  ws.reports.push(personalReport);
  assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws })).status, 200);
  for (const [c, id, pw] of [[bizA, 'ba', 'business a password'], [bizB, 'bb', 'business b password']]) {
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: id });
    assert.strictEqual((await c('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: pw })).status, 200);
  }
});

test('assistant digest covers fundability, scores, vendors, plan, utilization — redacted', () => {
  const d = clientDigest(db.data.workspace, 'ba', today);
  for (const re of [/Fundability checklist 2\/14/, /PAYDEX 72/, /Intelliscore Plus 54/, /Uline \| Net 30 \| limit 1000 \| balance 600/, /90-day plan started/, /Current step: \[/, /Business revolving utilization: \d+%/, /Personal revolving utilization|Business revolving/]) assert.match(d.text, re);
  assert.ok(!d.text.includes('Owner ba') && !d.text.includes('ba@biz.test') && !d.text.includes('(555) 010-0199'), 'no name/contact data');
  assert.ok(d.suggestions.some(s => s.business && s.code === 'BIZ-PR-SATISFIED-OPEN'));
});

test('business correction letters: same pipeline and guardrails', async () => {
  const sug = (await owner('GET', '/api/clients/ba/dispute-suggestions')).body.suggestions;
  const ucc = sug.find(s => s.code === 'BIZ-PR-SATISFIED-OPEN');
  assert.ok(ucc && ucc.business && ucc.bureau === 'Experian Business');
  const r = await owner('POST', '/api/letters/draft', { clientId: 'ba', recipient: 'Experian Business', letterType: 'cra_611', items: [{ accountId: ucc.accountId, code: ucc.code }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.letterType, 'business_correction', 'business items always use the business correction letter');
  assert.match(r.body.text, /not covered by the Fair Credit Reporting Act/);
  assert.match(r.body.scopeNote, /biz-fcra-scope/);
  assert.ok(r.body.citations.some(c => c.id === 'biz-dispute-letters'));
  assert.strictEqual(r.body.requiresApproval, true);
  assert.strictEqual((await owner('POST', '/api/letters/draft', { clientId: 'ba', recipient: 'Experian Business', items: [{ accountId: 'made-up', code: 'BIZ-TL-NOT-OURS' }] })).status, 400, 'no letter without a finding');
  // Repeat guard: pending dispute for the same item and bureau blocks a new one.
  const g = await owner('GET', '/api/workspace');
  g.body.data.disputes.push({ id: 'bd1', clientId: 'ba', recipient: 'Experian Business', type: 'business_correction', round: 1, sentAt: today, items: [{ accountId: ucc.accountId, creditor: ucc.creditor, discrepancy: ucc.discrepancy }] });
  await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
  assert.strictEqual((await owner('POST', '/api/letters/draft', { clientId: 'ba', recipient: 'Experian Business', items: [{ accountId: ucc.accountId, code: ucc.code }] })).status, 409);
});

test('personal-info letters go to the reporting bureau only; unrecognized needs a reason', async () => {
  const sug = (await owner('GET', '/api/clients/pa/dispute-suggestions')).body.suggestions;
  const addr = sug.find(s => s.code === 'PII-ADDRESS-UNKNOWN');
  assert.ok(addr);
  assert.strictEqual((await owner('POST', '/api/letters/draft', { clientId: 'pa', recipient: 'TransUnion', items: [{ accountId: addr.accountId, code: addr.code }] })).status, 400, 'wrong bureau refused');
  const ok = await owner('POST', '/api/letters/draft', { clientId: 'pa', recipient: 'Equifax', items: [{ accountId: addr.accountId, code: addr.code }] });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.letterType, 'pii_611');
  assert.ok(!ok.body.text.includes('1979-01-01') && !ok.body.text.includes('9999'));
  assert.ok(!sug.some(s => s.accountId === 'a3'), 'unrecognized without an explanation is not offered');
  assert.ok(!sug.some(s => s.accountId === 'a4'), '“not mine” is not offered');
  assert.ok(!sug.some(s => s.accountId === 'a1'), 'accurate collection is not offered');
});

test('coach: staff view/start/step; client sees only their own plan; client confirmations need review', async () => {
  const s = await owner('GET', '/api/coach/ba');
  assert.strictEqual(s.status, 200);
  assert.strictEqual(s.body.state.started, true);
  assert.match(s.body.text, /Step \d+ of 12/);
  assert.match(s.body.text, /Is this step done\?/);
  const key = s.body.state.current.key;
  assert.strictEqual((await bizA('GET', '/api/coach/ba')).status, 403, 'clients cannot use staff coach routes');
  assert.strictEqual((await bizA('GET', '/api/coach/bb')).status, 403);
  const a = await bizA('GET', '/api/portal/coach');
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.body.state.pending, undefined, 'staff review queue hidden from clients');
  assert.ok(!JSON.stringify(a.body).includes('Owner bb'), 'no other client’s data');
  const conf = await bizA('POST', '/api/portal/coach/step', { key, note: 'done Monday', clientId: 'bb' });
  assert.strictEqual(conf.status, 200);
  const ws = (await owner('GET', '/api/workspace')).body.data;
  const A = ws.clients.find(c => c.id === 'ba'), B = ws.clients.find(c => c.id === 'bb');
  assert.ok(A.creditPlan.clientConfirmed[key], 'recorded on A');
  assert.ok(!(A.creditPlan.done || {})[key], 'client confirmation does not complete the step');
  assert.ok(!(B.creditPlan.clientConfirmed || {})[key], 'clientId in the body is ignored — B untouched');
  const s2 = await owner('GET', '/api/coach/ba');
  assert.ok(s2.body.state.pending.some(p => p.key === key), 'flagged for staff review');
  const done = await owner('POST', '/api/coach/ba/step', { key, done: true });
  assert.ok(done.body.state.steps.find(x => x.key === key).complete);
  assert.ok(!done.body.state.pending.some(p => p.key === key), 'review cleared');
  assert.strictEqual((await anon('GET', '/api/portal/coach')).status, 401);
  const pat = client();
  const inv = await owner('POST', '/api/invites', { role: 'client', clientId: 'pa' });
  await pat('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'personal password 1' });
  assert.strictEqual((await pat('GET', '/api/portal/coach')).status, 404, 'personal-only clients have no business plan');
});

test('coach chat: offline plan coach, AI mocked with redaction and no promises', async () => {
  const off = await bizA('POST', '/api/portal/coach/chat', { message: 'What next?' });
  assert.strictEqual(off.body.mode, 'offline');
  process.env.LEDGER_AI_ENABLED = 'true'; process.env.OPENAI_API_KEY = 'sk-test-not-real';
  let sent;
  setAiFetch(async (u, o) => { sent = JSON.parse(o.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'Your PAYDEX will definitely hit 80 — guaranteed.' } }] }), { status: 200 }); });
  try {
    const r = await bizA('POST', '/api/portal/coach/chat', { message: 'My SSN is 123-45-6789, what next?' });
    assert.strictEqual(r.body.mode, 'ai');
    assert.doesNotMatch(r.body.text, /guaranteed/i, 'promise replaced with the plan coach');
    const all = JSON.stringify(sent.messages);
    assert.ok(!all.includes('123-45-6789') && !all.includes('Owner ba') && !all.includes('ba@biz.test'));
    assert.match(sent.messages[0].content, /PAYDEX is payment timing only/);
  } finally { delete process.env.LEDGER_AI_ENABLED; delete process.env.OPENAI_API_KEY; setAiFetch((...a) => fetch(...a)); }
});

test('step-due reminders go to the client once, via the notifications mailer', async () => {
  const out = [];
  setTransport(async m => { out.push(m); });
  try {
    auth.deadlineSweep();
    await new Promise(r => setTimeout(r, 50));
    const toB = out.filter(m => m.to === 'bb@biz.test');
    assert.ok(toB.length === 1 && /business credit plan step is due/.test(toB[0].text));
    auth.deadlineSweep();
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(out.filter(m => m.to === 'bb@biz.test').length, 1, 'deduplicated');
  } finally { setTransport(null); }
});

test('assistants decline identity-theft help and refer to IdentityTheft.gov', async () => {
  const p = await anon('POST', '/api/assistant/public', { message: 'Someone opened an account in my name, identity theft — can you dispute it?', page: 'apply' });
  assert.match(p.body.text, /IdentityTheft\.gov/);
  assert.match(p.body.text, /don’t handle identity theft/);
  process.env.LEDGER_AI_ENABLED = 'true'; process.env.OPENAI_API_KEY = 'sk-test-not-real';
  let sys = '';
  setAiFetch(async (u, o) => { sys = JSON.parse(o.body).messages[0].content; return new Response(JSON.stringify({ choices: [{ message: { content: 'Sure — send a 605B identity theft block letter.' } }] }), { status: 200 }); });
  try {
    const s = await owner('POST', '/api/assistant/staff', { clientId: 'pa', history: [{ role: 'user', content: 'Client says identity theft. Draft a block letter.' }] });
    assert.match(sys, /Identity theft disputes are out of scope/);
    assert.match(s.body.text, /IdentityTheft\.gov/);
    assert.doesNotMatch(s.body.text, /send a 605B/);
  } finally { delete process.env.LEDGER_AI_ENABLED; delete process.env.OPENAI_API_KEY; setAiFetch((...a) => fetch(...a)); }
});
