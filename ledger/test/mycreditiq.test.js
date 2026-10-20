// MyCreditIQ report flow: link config, source tagging, and what happens with AI off.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { myCreditIqUrl, reportSource, reportSourcesInfo, MYCREDITIQ_DEFAULT_URL } from '../server/report-sources.js';

test('MyCreditIQ link: default, override, referral code, unsafe values ignored', () => {
  assert.strictEqual(myCreditIqUrl({}), MYCREDITIQ_DEFAULT_URL);
  assert.strictEqual(myCreditIqUrl({ MYCREDITIQ_URL: 'https://www.mycreditiq.com/signup' }), 'https://www.mycreditiq.com/signup');
  assert.strictEqual(myCreditIqUrl({ MYCREDITIQ_REF: 'LEDGER42' }), 'https://www.mycreditiq.com/?ref=LEDGER42');
  assert.strictEqual(myCreditIqUrl({ MYCREDITIQ_URL: 'https://www.mycreditiq.com/join?x=1', MYCREDITIQ_REF: 'abc', MYCREDITIQ_REF_PARAM: 'aff' }), 'https://www.mycreditiq.com/join?x=1&aff=abc');
  assert.strictEqual(myCreditIqUrl({ MYCREDITIQ_URL: 'http://www.mycreditiq.com/' }), MYCREDITIQ_DEFAULT_URL, 'http is refused');
  assert.strictEqual(myCreditIqUrl({ MYCREDITIQ_URL: 'javascript:alert(1)' }), MYCREDITIQ_DEFAULT_URL);
  assert.strictEqual(myCreditIqUrl({ MYCREDITIQ_URL: 'not a url' }), MYCREDITIQ_DEFAULT_URL);
  assert.strictEqual(myCreditIqUrl({ MYCREDITIQ_URL: 'https://user:pw@evil.test/' }), MYCREDITIQ_DEFAULT_URL, 'no credentials in links');
  assert.strictEqual(myCreditIqUrl({ MYCREDITIQ_REF: '<script>' }), MYCREDITIQ_DEFAULT_URL, 'bad ref ignored');
  assert.strictEqual(reportSourcesInfo({}).mycreditiq.autoReturn, false);
  assert.strictEqual(reportSource('mycreditiq'), 'MyCreditIQ');
  assert.strictEqual(reportSource('Something Else'), '');
});

test('MyCreditIQ uploads are tagged, stored, and wait for manual import when AI is off', async () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const { createApp } = await import('../server/app.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-mciq-'));
  const { app } = createApp({ dataDir: dir, encryptionKey: 'test-key' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = () => {
      let cookie = '';
      return async (method, url, body) => {
        const form = body instanceof FormData;
        const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, body && !form ? { 'content-type': 'application/json' } : {}), body: body ? (form ? body : JSON.stringify(body)) : undefined });
        const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
        const ct = r.headers.get('content-type') || '';
        return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
      };
    };
    const owner = session(), portal = session();
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@example.test', password: 'correct horse battery' })).status, 200);
    const g = await owner('GET', '/api/workspace');
    const ws = g.body.data;
    ws.clients.push({ id: 'm1', name: 'Morgan Sample', firstName: 'Morgan', lastName: 'Sample', kind: 'personal', email: 'morgan@example.test', status: 'active', onboarding: {}, monitoring: 'MyCreditIQ' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws })).status, 200);

    const cfg = await owner('GET', '/api/config');
    assert.strictEqual(cfg.body.assistant, false);
    assert.strictEqual(cfg.body.reportSources.mycreditiq.url, myCreditIqUrl(process.env));
    assert.strictEqual(cfg.body.reportSources.mycreditiq.autoReturn, false);

    // Staff upload from the client's Documents tab.
    const fd = new FormData();
    fd.append('type', 'report'); fd.append('source', 'MyCreditIQ');
    fd.append('file', new Blob(['%PDF-1.4 synthetic MyCreditIQ report'], { type: 'application/pdf' }), 'mycreditiq-report.pdf');
    const up = await owner('POST', '/api/clients/m1/files', fd);
    assert.strictEqual(up.status, 200);
    assert.strictEqual(up.body.doc.source, 'MyCreditIQ');
    assert.strictEqual(up.body.doc.type, 'report');
    assert.strictEqual((await owner('POST', `/api/clients/m1/files/${up.body.doc.id}/scan`)).status, 501, 'no AI scan without a key');

    // A source on a non-report document, or an unknown source, is not kept.
    const fd2 = new FormData();
    fd2.append('type', 'id'); fd2.append('source', 'MyCreditIQ');
    fd2.append('file', new Blob(['png'], { type: 'image/png' }), 'id.png');
    assert.strictEqual((await owner('POST', '/api/clients/m1/files', fd2)).body.doc.source, undefined);

    // Client portal: link is shown, HTML report upload accepted and tagged, task created for staff.
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: 'm1' });
    assert.strictEqual((await portal('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'client password 1' })).status, 200);
    const me = await portal('GET', '/api/portal/me');
    assert.strictEqual(me.body.reportSources.mycreditiq.url, myCreditIqUrl(process.env));
    const pfd = new FormData();
    pfd.append('type', 'report'); pfd.append('source', 'MyCreditIQ');
    pfd.append('file', new Blob(['<html><body>synthetic report</body></html>'], { type: 'text/html' }), 'my-report.html');
    assert.strictEqual((await portal('POST', '/api/portal/files', pfd)).status, 200);
    const me2 = await portal('GET', '/api/portal/me');
    assert.ok(me2.body.uploads.some(u => u.name === 'my-report.html' && u.source === 'MyCreditIQ'));
    const w = (await owner('GET', '/api/workspace')).body.data;
    const doc = w.documents.find(d => d.name === 'my-report.html');
    assert.strictEqual(doc.source, 'MyCreditIQ');
    assert.strictEqual(doc.uploadedBy, 'client');
    assert.ok(w.tasks.some(t => t.clientId === 'm1' && /from MyCreditIQ/.test(t.title) && /AI scanning is off/.test(t.title)), 'staff get a task to import it by hand');
    assert.ok(!(w.pendingImports || []).length, 'nothing is auto-imported when AI is off');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
  }
});
