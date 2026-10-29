// Client-portal credit monitoring: tracked redirects, affiliate URLs, staff counts.
// Run: node --test ledger/test/credit.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

const DISCLOSURE = 'These are independent third-party services. We may earn a commission if you sign up. You do not have to use them to work with us. Prices are set by the provider and may change.';
const DEFAULTS = {
  myfreescorenow: 'https://app.myfreescorenow.com/enroll/B04C9729',
  smartcredit: 'https://www.smartcredit.com/?PID=72556'
};

for (const k of ['LEDGER_CREDIT_MFSN_URL', 'LEDGER_CREDIT_SMARTCREDIT_URL', 'LEDGER_SETUP_CODE']) delete process.env[k];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-credit-'));
const { app, db } = createApp({ dataDir: dir, encryptionKey: 'credit-test-key' });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const send = async (method, url, body) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set && set.startsWith('ledger_session=')) cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
  send.session = () => cookie;
  return send;
}
async function redirect(url, cookie) {
  const r = await fetch(base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  return { status: r.status, location: r.headers.get('location'), cache: r.headers.get('cache-control'), referrer: r.headers.get('referrer-policy') };
}

const owner = client();
const portal = client();

test('credit monitoring in the client portal', async (t) => {
  await t.test('a client sees both tracked offers, honest prices, and no provider URL', async () => {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@example.test', password: 'correct horse battery' })).status, 200);
    const g = await owner('GET', '/api/workspace');
    const ws = g.body.data;
    const mfsn = ws.offers.find(o => o.key === 'myfreescorenow');
    const sc = ws.offers.find(o => o.key === 'smartcredit');
    assert.strictEqual(mfsn.url, DEFAULTS.myfreescorenow);
    assert.strictEqual(mfsn.affiliateUrl, DEFAULTS.myfreescorenow);
    assert.strictEqual(sc.url, DEFAULTS.smartcredit);
    assert.strictEqual(sc.affiliateUrl, DEFAULTS.smartcredit);
    ws.clients.push({ id: 'c1', name: 'Jordan Sample', firstName: 'Jordan', lastName: 'Sample', kind: 'personal', email: 'jordan@example.test', status: 'lead', onboarding: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws })).status, 200);
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: 'c1' });
    assert.strictEqual((await portal('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'client password 1' })).status, 200);
    const me = await portal('GET', '/api/portal/me');
    assert.strictEqual(me.status, 200);
    const credit = me.body.creditMonitoring;
    assert.strictEqual(credit.disclosure, DISCLOSURE);
    assert.deepStrictEqual(credit.options.map(o => o.id), ['myfreescorenow', 'smartcredit']);
    assert.deepStrictEqual(credit.options.map(o => o.url), ['/go/credit/myfreescorenow', '/go/credit/smartcredit']);
    assert.ok(credit.options.every(o => !/myfreescorenow\.com|smartcredit\.com/.test(o.url)), 'portal links stay on our redirect');
    assert.match(credit.options.find(o => o.id === 'myfreescorenow').detail, /\$39\.90 per month after a 7-day trial/);
    assert.match(credit.options.find(o => o.id === 'smartcredit').detail, /Pricing is shown at sign-up/);
    const details = credit.options.map(o => o.detail).join(' ');
    assert.ok(!/\bfree\b/i.test(details + ' ' + credit.disclosure), 'do not call a paid plan free');
    const js = fs.readFileSync(path.join(import.meta.dirname, '../js/portal.js'), 'utf8');
    assert.ok(js.includes('Get a credit report'));
    assert.ok(js.includes(DISCLOSURE));
    assert.ok(js.includes('/go/credit/'));
    const flow = fs.readFileSync(path.join(import.meta.dirname, '../js/aiflow.js'), 'utf8');
    assert.ok(flow.includes('CREDIT_GO'));
    assert.ok(flow.includes('creditGo[o.key]'));
    assert.match(flow, /\$39\.90\/month after a 7-day trial/);
    assert.match(flow, /SmartCredit pricing is shown at sign-up/);
    assert.match(flow, /We may earn a commission/);
    const partners = fs.readFileSync(path.join(import.meta.dirname, '../js/partners.js'), 'utf8');
    assert.ok(partners.includes(DEFAULTS.myfreescorenow));
    assert.ok(partners.includes(DEFAULTS.smartcredit));
    assert.ok(!/url: 'https:\/\/www\.myfreescorenow\.com\//.test(partners));
    assert.ok(!/url: 'https:\/\/www\.smartcredit\.com\/'/.test(partners));
  });

  await t.test('a client click is recorded and redirected; strangers are redirected and not recorded', async () => {
    const anon = await redirect('/go/credit/myfreescorenow');
    assert.strictEqual(anon.status, 302);
    assert.strictEqual(anon.location, DEFAULTS.myfreescorenow);
    assert.match(anon.cache, /no-store/);
    assert.strictEqual(anon.referrer, 'no-referrer');
    assert.equal(db.data.creditMonitoring, undefined, 'an anonymous redirect does not write a click');

    const hit = await redirect('/go/credit/myfreescorenow', portal.session());
    assert.strictEqual(hit.status, 302);
    assert.strictEqual(hit.location, DEFAULTS.myfreescorenow);
    const book = db.data.creditMonitoring;
    assert.strictEqual(book.counts.myfreescorenow, 1);
    assert.strictEqual(book.counts.smartcredit, 0);
    assert.strictEqual(book.clicks.length, 1);
    assert.strictEqual(book.clicks[0].clientId, 'c1');
    assert.strictEqual(book.clicks[0].provider, 'myfreescorenow');
    assert.ok(Math.abs(Date.now() - Date.parse(book.clicks[0].at)) < 15000);
    assert.ok(!JSON.stringify(book).includes('myfreescorenow.com'), 'the destination URL is not stored');

    const sc = await redirect('/go/credit/smartcredit?clientId=someone-else', portal.session());
    assert.strictEqual(sc.location, DEFAULTS.smartcredit);
    assert.strictEqual(book.counts.smartcredit, 1);
    assert.ok(book.clicks.every(c => c.clientId === 'c1'), 'client id comes from the session');
    assert.strictEqual((await redirect('/go/credit/nope')).status, 404);
    assert.strictEqual((await redirect('/go/credit/smartcredit/extra')).status, 404);
  });

  await t.test('affiliate URLs come from env and unsafe values fall back', async () => {
    const keys = ['LEDGER_CREDIT_MFSN_URL', 'LEDGER_CREDIT_SMARTCREDIT_URL'];
    const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    try {
      process.env.LEDGER_CREDIT_MFSN_URL = 'https://example.com/mfsn?ref=abc';
      process.env.LEDGER_CREDIT_SMARTCREDIT_URL = 'javascript:alert(1)';
      const mfsn = await redirect('/go/credit/myfreescorenow');
      assert.strictEqual(mfsn.location, 'https://example.com/mfsn?ref=abc');
      assert.strictEqual((await redirect('/go/credit/smartcredit')).location, DEFAULTS.smartcredit);
      process.env.LEDGER_CREDIT_MFSN_URL = 'http://app.myfreescorenow.com/enroll/B04C9729';
      process.env.LEDGER_CREDIT_SMARTCREDIT_URL = 'https://user:pass@www.smartcredit.com/?PID=72556';
      assert.strictEqual((await redirect('/go/credit/myfreescorenow')).location, DEFAULTS.myfreescorenow);
      assert.strictEqual((await redirect('/go/credit/smartcredit')).location, DEFAULTS.smartcredit);
      const me = await portal('GET', '/api/portal/me');
      assert.ok(me.body.creditMonitoring.options.every(o => o.url.startsWith('/go/credit/')));
      assert.ok(!JSON.stringify(me.body.creditMonitoring).includes('example.com'));
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });

  await t.test('owner and staff see per-provider counts; clients do not', async () => {
    const counts = await owner('GET', '/api/credit-monitoring');
    assert.strictEqual(counts.status, 200);
    const byId = Object.fromEntries(counts.body.providers.map(p => [p.id, p.clicks]));
    assert.deepStrictEqual(byId, { myfreescorenow: 1, smartcredit: 1 });
    assert.strictEqual(counts.body.disclosure, DISCLOSURE);
    assert.ok(!JSON.stringify(counts.body).includes('c1'), 'the staff summary is counts, not client ids');
    assert.ok(!JSON.stringify(counts.body).includes('PID=72556'), 'the staff summary does not include the affiliate URL');
    assert.strictEqual((await portal('GET', '/api/credit-monitoring')).status, 403);
    const staffInv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staffer', email: 'staff@example.test' });
    const staff = client();
    await staff('POST', '/api/invites/accept', { token: staffInv.body.url.split('invite=')[1], password: 'staff password 1' });
    assert.strictEqual((await staff('GET', '/api/credit-monitoring')).status, 200);
    const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
    assert.ok(appJs.includes('/api/credit-monitoring'));
    assert.ok(appJs.includes('Credit monitoring'));
    const views = fs.readFileSync(path.join(import.meta.dirname, '../js/views.js'), 'utf8');
    assert.ok(views.includes('credit-clicks'));
    assert.ok(views.includes('CREDIT_GO'));
  });
});
