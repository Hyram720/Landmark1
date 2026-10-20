// PRIVACY: nothing identifying reaches an AI provider. Every outbound model call (Anthropic SDK and the
// OpenAI fetch) is mocked here and the exact request body is checked for SSN, ITIN, card, account,
// EIN, routing, DOB, email, phone and street-address patterns.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/app.js';
import { setAnthropicFactory } from '../server/assistant.js';
import { scanReport, pdfText } from '../server/ai.js';
import { setAiFetch } from '../server/ledger-assistant.js';
import { redact, redactObject, findSensitive, assertNoSensitive, redactPayload } from '../server/redact.js';

for (const k of ['OPENAI_API_KEY', 'LEDGER_AI_ENABLED', 'ANTHROPIC_API_KEY', 'LEDGER_SETUP_CODE']) delete process.env[k];

// Synthetic identifiers (test values only).
const PII = {
  ssn: '123-45-6789', ssnSpaced: '123 45 6789', ssnPlain: '123456789', itin: '912-70-1234',
  card: '4111111111111111', cardSpaced: '4111 1111 1111 1111', amex: '378282246310005',
  acct: '5500123498765432', acctAlpha: 'AB12CD345678', ein: '12-3456789', routing: '021000021',
  dob: '04/17/1979', dobIso: '1979-04-17', email: 'jordan.sample@example.test', phone: '(555) 010-0199', street: '4521 Oak Ridge Dr'
};
const LEAKS = [PII.ssn, PII.ssnSpaced, PII.itin, PII.card, PII.cardSpaced, '4111-1111-1111-1111', PII.amex, PII.acct, PII.acctAlpha, PII.ein, PII.routing, PII.dob, PII.dobIso, PII.email, PII.phone, PII.street, 'Jordan Sample'];
const REPORT_TEXT = `EXPERIAN CREDIT REPORT
Name: Jordan Sample   SSN: ${PII.ssn}   Date of birth: ${PII.dob}
Also reported: SSN ${PII.ssnSpaced}, ITIN ${PII.itin}, DOB ${PII.dobIso}
Current address: ${PII.street}, Dallas TX 75201   Phone ${PII.phone}   Email ${PII.email}
Employer EIN ${PII.ein}
ACCOUNTS
CAPITAL ONE   Account #: ${PII.acct}   Status: Open   Balance $1,200   Limit $2,000   Opened 2019-03-01
CHASE CARD   Card number ${PII.cardSpaced}   Status: Charge-off   Balance $900   DOFD 2021-06-01
AMEX   ${PII.amex}   Status: Current
BANK LOAN   Acct# ${PII.acctAlpha}   routing number ${PII.routing}   Status: Paid
`;
function assertClean(body, where) {
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  for (const l of LEAKS) assert.ok(!s.includes(l), `${where} leaked ${l}`);
  assert.deepStrictEqual(findSensitive(s), [], `${where}: guard pattern still present`);
}

test('redact(): masks every identifier type and keeps last 4 / ordinary dates', () => {
  const out = redact(REPORT_TEXT);
  assertClean(out, 'redact');
  for (const k of ['****5432', '****1111', '****0005', '****5678']) assert.ok(out.includes(k), 'last 4 kept: ' + k);
  for (const d of ['2019-03-01', '2021-06-01']) assert.ok(out.includes(d), 'tradeline dates kept');
  assert.ok(out.includes('Dallas TX') && out.includes('CAPITAL ONE'));
  assert.ok(!redact(`ssn ${PII.ssnPlain}`).includes(PII.ssnPlain));
  const o = redactObject({ name: 'x', ssn: PII.ssn, dob: PII.dob, email: PII.email, accountNumber: PII.acct, notes: `call ${PII.phone}` });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(o)), { name: 'x', accountNumber: '****5432', notes: 'call [PHONE]' });
});

test('final guard: refuses an SSN or Luhn-valid card; ignores non-card numbers', () => {
  assert.throws(() => assertNoSensitive({ messages: [{ content: `ssn ${PII.ssn}` }] }), /Nothing was sent/);
  assert.throws(() => assertNoSensitive({ messages: [{ content: PII.card }] }), e => e.privacyBlock && e.status === 422);
  assert.deepStrictEqual(findSensitive('order 1234567890123 and 2024-01-15'), [], 'non-Luhn 13 digits and dates pass');
  assert.throws(() => redactPayload({ messages: [{ role: 'user', content: [{ type: 'image', source: { data: 'x' } }] }] }), /can’t be redacted/);
});

// ---------- Anthropic SDK mocked ----------
const sent = [];
const reply = obj => ({ stop_reason: 'end_turn', model: 'mock', content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] });
setAnthropicFactory(() => ({
  beta: { messages: {
    create: async p => { sent.push(JSON.stringify(p)); return reply('Here is my answer.'); },
    stream: p => { sent.push(JSON.stringify(p)); return { finalMessage: async () => reply({ bureaus: [], summary: '', letters: [], doNotDispute: [], clientMessage: '' }) }; }
  } },
  messages: { create: async p => { sent.push(JSON.stringify(p)); return reply('ok'); } }
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-priv-'));
const { app } = createApp({ dataDir: dir, encryptionKey: 'privacy-test-key-not-a-secret-00' });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { setAnthropicFactory(null); setAiFetch((...a) => fetch(...a)); delete process.env.ANTHROPIC_API_KEY; delete process.env.LEDGER_AI_ENABLED; delete process.env.OPENAI_API_KEY; server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const jar = {};
async function call(method, url, body) {
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const isForm = body instanceof FormData;
  const r = await fetch(base + url, { method, headers: Object.assign({ cookie }, body && !isForm ? { 'content-type': 'application/json' } : {}), body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('setup a client file full of identifiers', async () => {
  assert.strictEqual((await call('POST', '/api/setup', { name: 'Owner', email: 'owner@priv.test', password: 'privacy owner pass 1' })).status, 200);
  const g = await call('GET', '/api/workspace');
  const ws = g.body.data;
  ws.clients.push({ id: 'cp', name: 'Jordan Sample', firstName: 'Jordan', lastName: 'Sample', kind: 'both', status: 'active', email: PII.email, phone: PII.phone, address: PII.street, city: 'Dallas', state: 'TX', zip: '75201', dob: PII.dobIso, ssnLast4: '6789', ssn: PII.ssn, notes: `SSN ${PII.ssn}, DOB ${PII.dob}, call ${PII.phone}, lives at ${PII.street}`, onboarding: {},
    business: { legalName: 'Jordan Sample Holdings LLC', ein: PII.ein, entityType: 'LLC', phone: PII.phone, address: PII.street },
    vendorAccounts: [{ id: 'v1', vendor: 'Uline', terms: `Net 30, acct ${PII.acct}`, limit: 1000, balance: 100, status: 'current' }] });
  ws.reports.push({ id: 'rp', clientId: 'cp', bureau: 'Experian', date: '2026-10-01', accounts: [
    { id: 'ta', creditor: 'CAPITAL ONE', accountNumber: PII.acct, type: 'R', status: '11', balance: 1200, pastDue: 100, limit: 2000, issue: `Card ${PII.cardSpaced} isn't late; my SSN is ${PII.ssn}`, evidence: `statement mailed to ${PII.street}` },
    { id: 'tb', creditor: 'CHASE', accountNumber: PII.card, type: 'R', status: '97', balance: 900, dofd: '2021-06-01' }] });
  ws.disputes.push({ id: 'dp', clientId: 'cp', type: 'cra_611', recipient: 'Experian', round: 1, status: 'sent', sentAt: '2026-09-01', items: [{ accountId: 'ta', creditor: 'CAPITAL ONE', discrepancy: `Account ${PII.acct} — DOB ${PII.dob} wrong, EIN ${PII.ein}` }] });
  assert.strictEqual((await call('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws })).status, 200);
  process.env.ANTHROPIC_API_KEY = 'test-not-a-real-key';
});

test('Anthropic: pasted report scan sends only redacted text (last 4 kept)', async () => {
  sent.length = 0;
  const r = await call('POST', '/api/clients/cp/scan-text', { text: REPORT_TEXT });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(sent.length, 1);
  assertClean(sent[0], 'scan-text');
  assert.ok(sent[0].includes('****5432'), 'last 4 kept for matching');
});

test('Anthropic: round planning (clientContext) and Ledger AI chat send no identifiers', async () => {
  sent.length = 0;
  assert.strictEqual((await call('POST', '/api/clients/cp/ai-plan')).status, 200);
  const r = await call('POST', '/api/assistant', { clientId: 'cp', history: [{ role: 'user', content: `Client SSN ${PII.ssn}, card ${PII.card}, EIN ${PII.ein}, DOB ${PII.dob}, routing ${PII.routing}, email ${PII.email}. What next?` }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(sent.length, 2);
  sent.forEach((s, i) => assertClean(s, ['ai-plan', 'assistant'][i]));
  assert.ok(sent[0].includes('****5432') && sent[0].includes('****1111'), 'tradelines still identifiable by last 4');
});

function tinyPdf(text) {
  const lines = text.split('\n').map((l, i) => `BT /F1 9 Tf 20 ${780 - i * 12} Td (${l.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
let hasPdftotext = true;
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { hasPdftotext = false; }

test('Anthropic: PDFs are text-extracted and redacted; the raw PDF is never sent', { skip: !hasPdftotext && 'pdftotext not installed' }, async () => {
  sent.length = 0;
  const pdf = tinyPdf(REPORT_TEXT);
  assert.match(await pdfText(pdf), /CAPITAL ONE/);
  await scanReport({ buffer: pdf, mime: 'application/pdf' });
  assert.strictEqual(sent.length, 1);
  assertClean(sent[0], 'pdf scan');
  assert.ok(!sent[0].includes('"document"') && !sent[0].includes('base64'), 'no raw PDF part');
});

test('Anthropic: images and scanned PDFs are blocked with a staff message; nothing sent', async () => {
  sent.length = 0;
  await assert.rejects(scanReport({ buffer: Buffer.from('\x89PNG fake'), mime: 'image/png' }), e => e.privacyBlock && /Nothing was sent/.test(e.message));
  await assert.rejects(scanReport({ buffer: Buffer.from('%PDF-1.4 no text layer'), mime: 'application/pdf' }), e => e.privacyBlock && /no readable text layer/.test(e.message));
  const fd = new FormData();
  fd.append('type', 'report');
  fd.append('file', new Blob([Buffer.from('\x89PNG\r\n\x1a\nfake')], { type: 'image/png' }), 'report.png');
  const up = await call('POST', '/api/clients/cp/files', fd);
  assert.strictEqual(up.status, 200, JSON.stringify(up.body));
  const scan = await call('POST', `/api/clients/cp/files/${up.body.doc.id}/scan`);
  assert.strictEqual(scan.status, 400);
  assert.match(scan.body.error, /can’t be redacted/);
  assert.strictEqual(sent.length, 0, 'the SDK was never called');
});

test('OpenAI: staff assistant, coach and letter polish bodies are redacted and guarded', async () => {
  process.env.LEDGER_AI_ENABLED = 'true'; process.env.OPENAI_API_KEY = 'sk-test-not-real';
  const bodies = [];
  setAiFetch(async (u, o) => { bodies.push(o.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'Next, review the Capital One tradeline with the client.' } }] }), { status: 200 }); });
  const q = `SSN ${PII.ssn} / ${PII.ssnSpaced}, ITIN ${PII.itin}, card ${PII.cardSpaced}, acct ${PII.acct}, EIN ${PII.ein}, DOB ${PII.dob}, routing ${PII.routing}, ${PII.email}, ${PII.phone}, ${PII.street}`;
  await call('POST', '/api/assistant/staff', { clientId: 'cp', history: [{ role: 'user', content: q }] });
  await call('POST', '/api/coach/cp/chat', { message: q });
  await call('POST', '/api/assistant/public', { message: q, page: 'apply' });
  assert.ok(bodies.length >= 2, 'AI was called');
  bodies.forEach((b, i) => assertClean(JSON.parse(b).messages, 'openai #' + i));
});
