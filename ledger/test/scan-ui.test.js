// Headless Chrome: upload and Scan with AI keep a progress dialog up until the result or the
// server's exact error, and a second click does not start a second scan.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from '../server/app.js';
import { setAnthropicFactory } from '../server/assistant.js';

const chromeBin = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-scan-ui-'));
const { app } = createApp({ dataDir: dir, encryptionKey: 'scan-ui-test-key-0000' });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let calls = 0;
let release = null;
let blockModel = true;
let failModel = null;
const accounts = Array.from({ length: 17 }, (_, i) => ({
  creditor: 'Example Bank ' + (i + 1), accountNumber: '****' + String(1000 + i), status: 'Open',
  balance: '100', pastDue: '0', opened: '2020-01-01', dofd: '', remarks: ''
}));
const scanResult = { reportDate: '2026-01-15', source: 'Equifax', notes: '', bureaus: [{ bureau: 'Equifax', score: '640', accounts }] };
const reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(scanResult) }] };

setAnthropicFactory(() => ({
  beta: { messages: {
    stream: () => {
      calls += 1;
      return { finalMessage: () => {
        if (failModel) return Promise.reject(Object.assign(new Error(failModel), { status: 502 }));
        if (!blockModel) return Promise.resolve(reply);
        return new Promise(resolve => { release = () => resolve(reply); });
      } };
    }
  } }
}));

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

function formFile(name, bytes, type) {
  const fd = new FormData();
  fd.append('type', 'report');
  fd.append('file', new Blob([bytes], { type }), name);
  return fd;
}

test.after(() => {
  try { if (release) release(); } catch { /* already settled */ }
  setAnthropicFactory(null);
  delete process.env.ANTHROPIC_API_KEY;
  server.closeAllConnections?.();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function cdp(ws) {
  let next = 1;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else resolve(msg.result || {});
  });
  return {
    send(method, params, sessionId) {
      const id = next++;
      const payload = { id, method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(payload));
      });
    }
  };
}

async function waitJson(url) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 10000) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      last = String(r.status);
    } catch (e) { last = e.message; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Chrome did not open a debugging port: ' + last);
}

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(chromeBin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--remote-allow-origins=*', '--no-first-run', '--disable-extensions', 'about:blank'
  ], { detached: true, stdio: 'ignore' });
  const stop = () => {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
    fs.rmSync(profile, { recursive: true, force: true });
  };
  try {
    const ver = await waitJson(`http://127.0.0.1:${port}/json/version`);
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('Chrome websocket failed')));
    });
    const browser = cdp(ws);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const session = { send: (method, params) => browser.send(method, params, sessionId) };
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Network.enable');
    await session.send('DOM.enable');
    return {
      session, stop: () => { try { ws.close(); } catch { /* closed */ } stop(); },
      async evaluate(expression) {
        const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) {
          const d = result.exceptionDetails;
          throw new Error((d.exception && d.exception.description) || d.text || 'page error');
        }
        return result.result ? result.result.value : undefined;
      }
    };
  } catch (e) {
    stop();
    throw e;
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

test('upload and Scan with AI stay visible until the result or the exact error', { timeout: 90000, skip: chromeBin ? false : 'Chrome is not installed' }, async () => {
  process.env.ANTHROPIC_API_KEY = 'test-not-a-real-key';
  const owner = client();
  assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@scanui.test', password: 'scan ui pass 01' })).status, 200);
  const g = await owner('GET', '/api/workspace');
  const ws = g.body.data;
  ws.clients.push({ id: 'cscan', name: 'Casey Report', firstName: 'Casey', lastName: 'Report', kind: 'personal', email: 'casey@example.test', status: 'active', onboarding: {} });
  assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws })).status, 200);
  const html = '<table><tr><td>Creditor</td><td>Example Bank</td></tr><tr><td>Balance</td><td>$100</td></tr></table>';
  const report = await owner('POST', '/api/clients/cscan/files', formFile('bureau.html', Buffer.from(html), 'text/html'));
  const png = await owner('POST', '/api/clients/cscan/files', formFile('scan.png', Buffer.from('\x89PNG\r\n\x1a\nfake'), 'image/png'));
  const bad = await owner('POST', '/api/clients/cscan/files', formFile('bad.html', Buffer.from(html), 'text/html'));
  assert.strictEqual(report.status, 200, JSON.stringify(report.body));
  assert.strictEqual(png.status, 200, JSON.stringify(png.body));
  assert.strictEqual(bad.status, 200, JSON.stringify(bad.body));

  const page = await launchChrome();
  try {
    const raw = owner.cookie();
    const eq = raw.indexOf('=');
    await page.session.send('Network.setCookie', {
      name: raw.slice(0, eq), value: decodeURIComponent(raw.slice(eq + 1)), url: base, httpOnly: true, sameSite: 'Lax'
    });
    await page.session.send('Page.navigate', { url: `${base}/#/clients/cscan/documents` });
    const waitFor = async (expr, ms = 15000) => {
      const start = Date.now();
      let last = '';
      while (Date.now() - start < ms) {
        last = await page.evaluate(`(() => { try { return (${expr}); } catch (e) { return ''; } })()`);
        if (last) return last;
        await delay(100);
      }
      const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 600) : ''`).catch(() => '');
      throw new Error('timed out waiting for ' + expr + '\n' + body);
    };
    await waitFor(`document.querySelector('[data-act="ai-scan"][data-id="${report.body.doc.id}"]') ? 'yes' : ''`);

    const arm = () => page.evaluate(`(() => {
      window.__log = [];
      if (!window.__obs) {
        window.__obs = new MutationObserver(() => {
          const b = document.querySelector('[data-busy]');
          if (b) window.__log.push(b.getAttribute('data-busy') + '|' + b.innerText.replace(/\\s+/g, ' ').slice(0, 300));
        });
        window.__obs.observe(document.body, { subtree: true, childList: true, characterData: true });
      }
      return true;
    })()`);
    const closeBusy = async () => {
      await page.evaluate(`(() => { const b = document.querySelector('[data-busy-close]'); if (b) b.click(); return true; })()`);
      await delay(50);
    };

    // A fast server error stays on screen with the server's exact wording, not a 2.6s toast.
    await arm();
    await page.evaluate(`document.querySelector('[data-act="ai-scan"][data-id="${png.body.doc.id}"]').click()`);
    const imageErr = await waitFor(`(document.querySelector('[data-busy="error"]') && document.querySelector('[data-busy="error"]').innerText.includes('Nothing was sent to the AI')) ? 'yes' : ''`);
    assert.strictEqual(imageErr, 'yes');
    await delay(2800);
    const imageStill = await page.evaluate(`document.querySelector('[data-busy="error"]') ? document.querySelector('[data-busy="error"]').innerText : ''`);
    assert.match(imageStill, /Images can’t be redacted before AI scanning/);
    assert.match(imageStill, /Nothing was sent to the AI/);
    assert.equal(calls, 0, 'an image is not sent to the model');
    await closeBusy();

    // Scan with AI: the dialog stays through the old toast window, ignores Escape and a second click.
    blockModel = true;
    failModel = null;
    const before = calls;
    await arm();
    await page.evaluate(`(() => {
      const b = document.querySelector('[data-act="ai-scan"][data-id="${report.body.doc.id}"]');
      b.click(); b.click();
      return true;
    })()`);
    await waitFor(`(document.querySelector('[data-busy="1"]') && document.querySelector('[data-busy="1"]').innerText.includes('AI is reading your report')) ? 'yes' : ''`);
    const started = Date.now();
    while (calls < before + 1 && Date.now() - started < 8000) await delay(50);
    assert.equal(calls, before + 1, 'double-click starts one scan');
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await page.evaluate(`(() => { const o = document.querySelector('.overlay[data-busy]'); if (o) o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true; })()`);
    await delay(2800);
    assert.equal(calls, before + 1, 'the scan is still the only one after the toast would have vanished');
    const mid = await page.evaluate(`document.querySelector('[data-busy="1"]') ? document.querySelector('[data-busy="1"]').innerText : ''`);
    assert.match(mid, /AI is reading your report… \(can take 1–3 minutes\)/);
    assert.equal(await page.evaluate(`document.body.innerText.includes('17 tradelines') ? 'yes' : ''`), '', 'the result modal does not appear before the scan finishes');
    assert.equal(typeof release, 'function');
    release(); release = null;
    await waitFor(`document.body.innerText.includes('Equifax') && document.body.innerText.includes('17 tradelines') ? 'yes' : ''`);
    assert.equal(await page.evaluate(`document.querySelector('[data-busy]') ? 'yes' : ''`), '', 'progress closes when the review opens');
    assert.match(await page.evaluate(`document.body.innerText`), /AI scan — bureau\.html/);
    await page.evaluate(`document.querySelector('[data-close]').click()`);
    await waitFor(`document.querySelector('[data-act="upload-report"]') && !document.querySelector('.overlay') ? 'yes' : ''`);

    // Model failure after the request has started: exact message, still there after 2.6s.
    failModel = 'Upstream model timed out after 90s';
    await arm();
    await page.evaluate(`document.querySelector('[data-act="ai-scan"][data-id="${bad.body.doc.id}"]').click()`);
    await waitFor(`(document.querySelector('[data-busy="error"]') && document.querySelector('[data-busy="error"]').innerText.includes('Upstream model timed out after 90s')) ? 'yes' : ''`);
    await delay(2800);
    const modelErr = await page.evaluate(`document.querySelector('[data-busy="error"]') ? document.querySelector('[data-busy="error"]').innerText : ''`);
    assert.match(modelErr, /Upstream model timed out after 90s/);
    await closeBusy();

    // File input path: copy the file before the upload dialog closes, show Uploading, then the scan.
    failModel = null;
    blockModel = true;
    await arm();
    const filePath = path.join(dir, 'dropped-report.html');
    fs.writeFileSync(filePath, html);
    await page.evaluate(`document.querySelector('[data-act="upload-report"]').click()`);
    await waitFor(`document.querySelector('#up-files') ? 'yes' : ''`);
    const docRoot = await page.session.send('DOM.getDocument', { depth: 1 });
    const found = await page.session.send('DOM.querySelector', { nodeId: docRoot.root.nodeId, selector: '#up-files' });
    assert.ok(found.nodeId, 'file input is in the upload dialog');
    await page.session.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [filePath] });
    await page.evaluate(`(() => { const i = document.querySelector('#up-files'); if (i && i.files && i.files.length) i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(`(document.querySelector('[data-busy="1"]') && /Uploading|AI is reading your report/.test(document.querySelector('[data-busy="1"]').innerText)) ? 'yes' : ''`);
    await waitFor(`document.querySelector('#up-files') ? '' : 'closed'`);
    const seen = await waitFor(`(window.__log || []).some(l => l.includes('Uploading')) && (window.__log || []).some(l => l.includes('AI is reading your report')) ? 'yes' : ''`);
    assert.strictEqual(seen, 'yes');
    await delay(2800);
    const during = await page.evaluate(`document.querySelector('[data-busy="1"]') ? document.querySelector('[data-busy="1"]').innerText : ''`);
    assert.match(during, /AI is reading your report… \(can take 1–3 minutes\)/);
    const saved = await owner('GET', '/api/workspace');
    assert.ok(saved.body.data.documents.some(d => d.name === 'dropped-report.html' && d.mime === 'text/html'), 'the file uploaded while the dialog was up');
    assert.equal(typeof release, 'function');
    release(); release = null;
    await waitFor(`document.body.innerText.includes('dropped-report.html') && document.body.innerText.includes('17 tradelines') ? 'yes' : ''`);

    // Documents tab Upload (no AI): the dialog stays on “Uploading…” until the file is stored.
    await page.evaluate(`document.querySelector('[data-close]') && document.querySelector('[data-close]').click()`);
    await waitFor(`!document.querySelector('.overlay') ? 'yes' : ''`);
    const proofPath = path.join(dir, 'proof.txt');
    fs.writeFileSync(proofPath, 'proof of address');
    await arm();
    await page.evaluate(`document.querySelector('[data-act="upload-doc"]').click()`);
    await waitFor(`document.querySelector('input[name="file"]') ? 'yes' : ''`);
    const docForm = await page.session.send('DOM.getDocument', { depth: 1 });
    const fileNode = await page.session.send('DOM.querySelector', { nodeId: docForm.root.nodeId, selector: 'input[name="file"]' });
    assert.ok(fileNode.nodeId);
    await page.session.send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [proofPath] });
    await page.evaluate(`(() => {
      const btn = document.querySelector('.overlay form button.btn.primary');
      if (!btn) throw new Error('no Upload button');
      btn.click();
      return true;
    })()`);
    await waitFor(`(window.__log || []).some(l => l.includes('Uploading')) ? 'yes' : ''`);
    await waitFor(`document.querySelector('[data-busy]') ? '' : 'done'`);
    const stored = await owner('GET', '/api/workspace');
    assert.ok(stored.body.data.documents.some(d => d.name === 'proof.txt'), 'the documents Upload button stored the file');

    // Oversized files never hit the server; the limit is shown and left up.
    calls = 0;
    await page.evaluate(`document.querySelector('[data-close]') && document.querySelector('[data-close]').click()`);
    const over = await page.evaluate(`(async () => {
      await window.AIFlow.scanFiles('cscan', [{ name: 'huge.pdf', size: ${16 * 1024 * 1024}, type: 'application/pdf' }]);
      const el = document.querySelector('[data-busy="error"]');
      return el ? el.innerText : '';
    })()`);
    assert.match(over, /huge\.pdf is over 15 MB/);
    assert.equal(calls, 0, 'an oversized file is not uploaded or scanned');
    await delay(2800);
    assert.match(await page.evaluate(`document.querySelector('[data-busy="error"]') ? document.querySelector('[data-busy="error"]').innerText : ''`), /huge\.pdf is over 15 MB/);
  } finally {
    page.stop();
  }
});
