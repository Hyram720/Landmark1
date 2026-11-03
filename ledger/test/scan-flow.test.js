// Upload limits, generic PDF MIME, duplicate scans, and the heartbeat that keeps a long AI
// scan from being closed before the model returns.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { setAnthropicFactory } from '../server/assistant.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-scan-'));
const { app } = createApp({ dataDir: dir, encryptionKey: 'scan-flow-test-key-00' });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const sent = [];
let release = null;
let blockModel = false;
let failModel = null;
const scanResult = {
  reportDate: '2026-01-15', source: 'Equifax', notes: '',
  bureaus: [{ bureau: 'Equifax', score: '640', accounts: [{ creditor: 'Example Bank', accountNumber: '****5432', status: 'Open', balance: '100', pastDue: '0', opened: '2020-01-01', dofd: '', remarks: '' }] }]
};
const reply = obj => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] });

setAnthropicFactory(() => ({
  beta: { messages: {
    stream: (p) => {
      sent.push(JSON.stringify(p));
      return { finalMessage: () => new Promise((resolve, reject) => {
        const finish = () => (failModel ? reject(Object.assign(new Error(failModel), { status: 502 })) : resolve(reply(scanResult)));
        if (!blockModel) finish();
        else release = finish;
      }) };
    }
  } }
}));

test.after(() => {
  setAnthropicFactory(null);
  delete process.env.ANTHROPIC_API_KEY;
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  const send = async (method, url, body) => {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const r = await fetch(base + url, {
      method,
      headers: Object.assign({ cookie }, body && !isForm ? { 'content-type': 'application/json' } : {}),
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    });
    const set = r.headers.get('set-cookie');
    if (set && set.startsWith('ledger_session=')) cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  send.cookie = () => cookie;
  return send;
}
const owner = client();

function formFile(name, bytes, type) {
  const fd = new FormData();
  fd.append('type', 'report');
  fd.append('file', new Blob([bytes], { type }), name);
  return fd;
}

test('report upload accepts a mislabeled PDF, rejects non-files, and enforces 15 MB', async () => {
  assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@scan.test', password: 'scan owner pass 1' })).status, 200);
  const g = await owner('GET', '/api/workspace');
  const ws = g.body.data;
  ws.clients.push({ id: 'c1', name: 'Jordan Sample', firstName: 'Jordan', lastName: 'Sample', kind: 'personal', email: 'jordan@example.test', status: 'active', onboarding: {} });
  assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws })).status, 200);

  const pdf = await owner('POST', '/api/clients/c1/files', formFile('equifax.pdf', Buffer.from('%PDF-1.4\nreport text'), 'application/octet-stream'));
  assert.strictEqual(pdf.status, 200, JSON.stringify(pdf.body));
  assert.strictEqual(pdf.body.doc.mime, 'application/pdf');

  const xpdf = await owner('POST', '/api/clients/c1/files', formFile('other.pdf', Buffer.from('%PDF-1.4\nmore'), 'application/x-pdf'));
  assert.strictEqual(xpdf.status, 200, JSON.stringify(xpdf.body));
  assert.strictEqual(xpdf.body.doc.mime, 'application/pdf');

  const fake = await owner('POST', '/api/clients/c1/files', formFile('not-a-report.pdf', Buffer.from('hello this is not a pdf'), 'application/octet-stream'));
  assert.strictEqual(fake.status, 400);
  assert.strictEqual(fake.body.error, 'Choose a PDF, image, HTML, CSV or JSON file under 15 MB');

  const exe = await owner('POST', '/api/clients/c1/files', formFile('notes.exe', Buffer.from('MZ'), 'application/octet-stream'));
  assert.strictEqual(exe.status, 400);
  assert.strictEqual(exe.body.error, 'Choose a PDF, image, HTML, CSV or JSON file under 15 MB');

  const big = Buffer.alloc(15 * 1024 * 1024 + 1);
  big.write('%PDF-1.4');
  const over = await owner('POST', '/api/clients/c1/files', formFile('big.pdf', big, 'application/pdf'));
  assert.strictEqual(over.status, 413);
  assert.strictEqual(over.body.error, 'That upload or request is too large.');
});

test('a scan heartbeats before the model returns, blocks a second scan, and keeps the server error', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-not-a-real-key';
  sent.length = 0;
  blockModel = true;
  failModel = null;
  const html = '<table><tr><td>Name</td><td>Jordan Sample</td></tr><tr><td>SSN</td><td>123-45-6789</td></tr><tr><td>Creditor</td><td>Example Bank</td></tr><tr><td>Account</td><td>5500123498765432</td></tr></table>';
  const up = await owner('POST', '/api/clients/c1/files', formFile('report.html', Buffer.from(html), 'text/html'));
  assert.strictEqual(up.status, 200, JSON.stringify(up.body));
  const docId = up.body.doc.id;

  const first = await fetch(base + `/api/clients/c1/files/${docId}/scan`, { method: 'POST', headers: { cookie: owner.cookie() } });
  assert.strictEqual(first.status, 200);
  const reader = first.body.getReader();
  const early = await Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('no bytes before the model returned')), 2000))
  ]);
  assert.ok(early.value && early.value.length, 'heartbeat bytes');
  assert.ok(!Buffer.from(early.value).toString('utf8').includes('{'), 'JSON is not sent before the model returns');

  const second = await owner('POST', `/api/clients/c1/files/${docId}/scan`);
  assert.strictEqual(second.status, 409);
  assert.strictEqual(second.body.error, 'This document is already being scanned.');
  assert.strictEqual(sent.length, 1, 'the second click did not call the model');
  assert.ok(!sent[0].includes('123-45-6789'), 'scan still redacts before the model');

  const png = await owner('POST', '/api/clients/c1/files', formFile('id.png', Buffer.from('\x89PNG\r\n\x1a\nfake'), 'image/png'));
  const blocked = await owner('POST', `/api/clients/c1/files/${png.body.doc.id}/scan`);
  assert.strictEqual(blocked.status, 400);
  assert.match(blocked.body.error, /Nothing was sent to the AI/);
  assert.strictEqual(sent.length, 1, 'an image is refused before the model');

  failModel = 'Upstream model timed out after 90s';
  release();
  release = null;
  let chunks = [early.value];
  for (;;) {
    const n = await reader.read();
    if (n.done) break;
    if (n.value) chunks.push(n.value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.strictEqual(body.error, 'Upstream model timed out after 90s');

  blockModel = false;
  failModel = null;
  const again = await owner('POST', `/api/clients/c1/files/${docId}/scan`);
  assert.strictEqual(again.status, 200, JSON.stringify(again.body));
  assert.strictEqual(again.body.bureaus[0].bureau, 'Equifax');
  assert.ok(!JSON.stringify(again.body).includes('123-45-6789'));
});
