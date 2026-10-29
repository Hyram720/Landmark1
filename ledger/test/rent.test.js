// Client-portal rent reporting: tracked redirects, configurable URLs, staff counts.
// Run: node --test ledger/test/rent.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

const DISCLOSURE = 'These are independent third-party services. Credit Ledger may be compensated for referring you. Prices are set by the provider and may change.';
const DEFAULTS = {
  boom: 'https://www.boompay.app/renters',
  crb: 'https://www.creditrentboost.com/',
  self: 'https://www.self.inc/rent-and-bills-reporting'
};

for (const k of ['LEDGER_RENT_BOOM_URL', 'LEDGER_RENT_CRB_URL', 'LEDGER_RENT_SELF_URL', 'LEDGER_SETUP_CODE']) delete process.env[k];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-rent-'));
const { app, db } = createApp({ dataDir: dir, encryptionKey: 'rent-test-key' });
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
  return { status: r.status, location: r.headers.get('location'), cache: r.headers.get('cache-control') };
}

const owner = client();
const portal = client();

test('rent reporting in the client portal', async (t) => {
  await t.test('a client sees three tracked options and no provider URL', async () => {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@example.test', password: 'correct horse battery' })).status, 200);
    const g = await owner('GET', '/api/workspace');
    const ws = g.body.data;
    ws.clients.push({ id: 'c1', name: 'Jordan Sample', firstName: 'Jordan', lastName: 'Sample', kind: 'personal', email: 'jordan@example.test', status: 'lead', onboarding: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: ws })).status, 200);
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: 'c1' });
    assert.strictEqual((await portal('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'client password 1' })).status, 200);
    const me = await portal('GET', '/api/portal/me');
    assert.strictEqual(me.status, 200);
    const rent = me.body.rentReporting;
    assert.strictEqual(rent.disclosure, DISCLOSURE);
    assert.deepStrictEqual(rent.options.map(o => o.id), ['boom', 'crb', 'self']);
    assert.deepStrictEqual(rent.options.map(o => o.url), ['/go/rent/boom', '/go/rent/crb', '/go/rent/self']);
    assert.ok(rent.options.every(o => !/boompay|creditrentboost|self\.inc/.test(o.url)), 'portal links stay on our redirect');
    assert.match(rent.options.find(o => o.id === 'boom').detail, /\$5/);
    assert.match(rent.options.find(o => o.id === 'crb').detail, /\$6\.95/);
    assert.match(rent.options.find(o => o.id === 'self').detail, /\$6\.95/);
    assert.ok(!/free/i.test(rent.options.map(o => o.detail).join(' ')), 'do not call a paid plan free');
    const js = fs.readFileSync(path.join(import.meta.dirname, '../js/portal.js'), 'utf8');
    assert.ok(js.includes('Rent reporting'));
    assert.ok(js.includes(DISCLOSURE));
    assert.ok(js.includes('/go/rent/'));
  });

  await t.test('a client click is recorded and redirected; strangers are redirected and not recorded', async () => {
    const anon = await redirect('/go/rent/boom');
    assert.strictEqual(anon.status, 302);
    assert.strictEqual(anon.location, DEFAULTS.boom);
    assert.match(anon.cache, /no-store/);
    assert.equal(db.data.rentReporting, undefined, 'an anonymous redirect does not write a click');

    const hit = await redirect('/go/rent/boom', portal.session());
    assert.strictEqual(hit.status, 302);
    assert.strictEqual(hit.location, DEFAULTS.boom);
    const book = db.data.rentReporting;
    assert.strictEqual(book.counts.boom, 1);
    assert.strictEqual(book.counts.crb, 0);
    assert.strictEqual(book.counts.self, 0);
    assert.strictEqual(book.clicks.length, 1);
    assert.strictEqual(book.clicks[0].clientId, 'c1');
    assert.strictEqual(book.clicks[0].provider, 'boom');
    assert.ok(Math.abs(Date.now() - Date.parse(book.clicks[0].at)) < 15000);
    assert.ok(!JSON.stringify(book).includes('boompay.app'), 'the destination URL is not stored');

    const crb = await redirect('/go/rent/crb?clientId=someone-else', portal.session());
    assert.strictEqual(crb.location, DEFAULTS.crb);
    assert.strictEqual(book.counts.crb, 1);
    assert.ok(book.clicks.every(c => c.clientId === 'c1'), 'client id comes from the session');
    assert.strictEqual((await redirect('/go/rent/nope')).status, 404);
    assert.strictEqual((await redirect('/go/rent/boom/extra')).status, 404);
  });

  await t.test('affiliate URLs come from env and unsafe values fall back', async () => {
    const keys = ['LEDGER_RENT_BOOM_URL', 'LEDGER_RENT_CRB_URL', 'LEDGER_RENT_SELF_URL'];
    const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    try {
      process.env.LEDGER_RENT_BOOM_URL = 'https://example.com/boom?ref=abc';
      process.env.LEDGER_RENT_SELF_URL = 'javascript:alert(1)';
      process.env.LEDGER_RENT_CRB_URL = 'http://creditrentboost.com/insecure';
      const boom = await redirect('/go/rent/boom');
      assert.strictEqual(boom.location, 'https://example.com/boom?ref=abc');
      assert.strictEqual((await redirect('/go/rent/self')).location, DEFAULTS.self);
      assert.strictEqual((await redirect('/go/rent/crb')).location, DEFAULTS.crb);
      const me = await portal('GET', '/api/portal/me');
      assert.ok(me.body.rentReporting.options.every(o => o.url.startsWith('/go/rent/')));
      assert.ok(!JSON.stringify(me.body).includes('example.com'));
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });

  await t.test('owner and staff see per-provider counts; clients do not', async () => {
    const counts = await owner('GET', '/api/rent-reporting');
    assert.strictEqual(counts.status, 200);
    const byId = Object.fromEntries(counts.body.providers.map(p => [p.id, p.clicks]));
    assert.deepStrictEqual(byId, { boom: 1, crb: 1, self: 0 });
    assert.strictEqual(counts.body.disclosure, DISCLOSURE);
    assert.ok(!JSON.stringify(counts.body).includes('c1'), 'the staff summary is counts, not client ids');
    assert.strictEqual((await portal('GET', '/api/rent-reporting')).status, 403);
    const staffInv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staffer', email: 'staff@example.test' });
    const staff = client();
    await staff('POST', '/api/invites/accept', { token: staffInv.body.url.split('invite=')[1], password: 'staff password 1' });
    assert.strictEqual((await staff('GET', '/api/rent-reporting')).status, 200);
    const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
    assert.ok(appJs.includes('/api/rent-reporting'));
    assert.ok(appJs.includes('Rent reporting'));
  });
});
