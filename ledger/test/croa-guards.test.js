// Named checks for server-owned signatures, client type, and invoice issuing.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { seedSignedClient } from './seed-croa.js';

function listen(app) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    const jar = {};
    const f = async (method, url, body) => {
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
    };
    f.jar = jar;
    return f;
  };
  return { server, base, client };
}

async function withOwner(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-guard-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'guard-key-not-a-secret-00', selfSignupEnabled: false, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } });
  const live = listen(built.app);
  const owner = live.client();
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@guard.test', password: 'owner password 1' })).status, 200);
    await fn({ built, owner, live });
  } finally {
    live.server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function addClient(owner, client) {
  const g = await owner('GET', '/api/workspace');
  g.body.data.clients.push(client);
  const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  return saved;
}

test('forged signature records are ignored', async () => {
  await withOwner(async ({ owner }) => {
    const g = await owner('GET', '/api/workspace');
    g.body.data.clients.push({ id: 'forge', name: 'Fay Forge', kind: 'personal', email: 'fay@guard.test', status: 'active', onboarding: { disclosureSignedAt: '2020-01-06', contractSignedAt: '2020-01-06', cancellationWindowEndsAtTs: '2020-01-10T04:59:59.999Z' } });
    g.body.data.signatures = [{ id: 'fake-d', clientId: 'forge', doc: 'disclosure', at: '2020-01-06T15:00:00.000Z' }, { id: 'fake-c', clientId: 'forge', doc: 'contract', at: '2020-01-06T16:00:00.000Z' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const saved = await owner('GET', '/api/workspace');
    const row = saved.body.data.clients.find(c => c.id === 'forge');
    assert.strictEqual(row.onboarding.contractSignedAt, null);
    assert.ok(!(saved.body.data.signatures || []).some(s => s.clientId === 'forge'));
    saved.body.data.letters = saved.body.data.letters || [];
    saved.body.data.letters.push({ id: 'forged-letter', clientId: 'forge', text: 'Letter', status: 'draft' });
    saved.body.data.signatures.push({ id: 'fake-c2', clientId: 'forge', doc: 'contract', at: '2020-01-06T16:00:00.000Z' });
    saved.body.data.clients.find(c => c.id === 'forge').onboarding.cancellationWindowEndsAtTs = '2020-01-02T04:59:59.999Z';
    const held = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: saved.body.data });
    assert.strictEqual(held.status, 409);
  });
});

test('deleted signature records are restored', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'keep', name: 'Kay Keep', kind: 'personal', email: 'kay@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'keep');
    const g = await owner('GET', '/api/workspace');
    assert.strictEqual(g.body.data.signatures.filter(s => s.clientId === 'keep').length, 2);
    g.body.data.signatures = g.body.data.signatures.filter(s => s.clientId !== 'keep');
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.signatures.filter(s => s.clientId === 'keep').length, 2);
  });
});

test('the owner is the only role that can change a personal client type, and not after enrollment', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'lead', name: 'Lee Lead', kind: 'personal', email: 'lee@guard.test', status: 'lead', onboarding: {} });
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const asStaff = await owner('GET', '/api/workspace');
    asStaff.body.data.clients.find(c => c.id === 'lead').kind = 'business';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: asStaff.body.version, data: asStaff.body.data })).status, 403);
    const asOwner = await owner('GET', '/api/workspace');
    asOwner.body.data.clients.find(c => c.id === 'lead').kind = 'business';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: asOwner.body.version, data: asOwner.body.data })).status, 200);
    const audit = await owner('GET', '/api/audit');
    assert.ok(audit.body.some(a => a.action === 'client.kind' && /lead/.test(a.detail)));
    await addClient(owner, { id: 'signed', name: 'Sam Signed', kind: 'personal', email: 'sam@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'signed', { onboarding: { cancellationWindowEndsAt: '2026-12-01', cancellationWindowEndsAtTs: '2026-12-02T04:59:59.999Z' } });
    const locked = await owner('GET', '/api/workspace');
    locked.body.data.clients.find(c => c.id === 'signed').kind = 'business';
    const denied = await owner('PUT', '/api/workspace', { baseVersion: locked.body.version, data: locked.body.data });
    assert.strictEqual(denied.status, 409);
    assert.match(denied.body.error, /client type/);
  });
});

test('a workspace save cannot add a letter by moving the cancellation window', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'win', name: 'Wyn Window', kind: 'personal', email: 'wyn@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'win', { onboarding: { cancellationWindowEndsAt: '2026-12-01', cancellationWindowEndsAtTs: '2026-12-02T04:59:59.999Z' } });
    const g = await owner('GET', '/api/workspace');
    const row = g.body.data.clients.find(c => c.id === 'win');
    row.onboarding.cancellationWindowEndsAtTs = '2020-01-02T04:59:59.999Z';
    row.onboarding.cancellationWindowEndsAt = '2020-01-01';
    g.body.data.letters = g.body.data.letters || [];
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.letters.push({ id: 'wl', clientId: 'win', text: 'Letter', status: 'draft' });
    g.body.data.disputes.push({ id: 'wd', clientId: 'win', recipient: 'Equifax', items: [] });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 409);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.clients.find(c => c.id === 'win').onboarding.cancellationWindowEndsAtTs, '2026-12-02T04:59:59.999Z');
    assert.ok(!(saved.body.data.letters || []).some(l => l.id === 'wl'));
  });
});

test('invited auto-scan stays on hold during the window and runs after it', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'scan', name: 'Sue Scan', kind: 'personal', email: 'sue@guard.test', status: 'active', onboarding: {} });
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: 'scan', email: 'sue@guard.test' });
    const sue = live.client();
    assert.strictEqual((await sue('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'sue password 1' })).status, 200);
    seedSignedClient(built.db.data.workspace, 'scan', { onboarding: { cancellationWindowEndsAt: '2026-12-01', cancellationWindowEndsAtTs: '2026-12-02T04:59:59.999Z' } });
    const fd = new FormData();
    fd.append('type', 'report');
    fd.append('file', new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), 'report.pdf');
    const cookie = Object.entries(sue.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    assert.strictEqual((await fetch(live.base + '/api/portal/files', { method: 'POST', body: fd, headers: { cookie } })).status, 200);
    await new Promise(r => setImmediate(r));
    const during = (await owner('GET', '/api/workspace')).body.data;
    assert.ok(during.tasks.some(t => t.clientId === 'scan' && /on hold until the cancellation window/.test(t.title)));
    const row = built.db.data.workspace.clients.find(c => c.id === 'scan');
    row.onboarding.cancellationWindowEndsAt = '2020-01-01';
    row.onboarding.cancellationWindowEndsAtTs = '2020-01-02T04:59:59.999Z';
    const fd2 = new FormData();
    fd2.append('type', 'report');
    fd2.append('file', new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), 'later.pdf');
    assert.strictEqual((await fetch(live.base + '/api/portal/files', { method: 'POST', body: fd2, headers: { cookie } })).status, 200);
    await new Promise(r => setImmediate(r));
    const after = (await owner('GET', '/api/workspace')).body.data;
    const later = after.tasks.filter(t => t.clientId === 'scan' && /later\.pdf/.test(t.title));
    assert.ok(later.length);
    assert.ok(!later.some(t => /on hold/.test(t.title)));
  });
});

test('the owner cannot change price or Schedule A after an invited client signs', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'priced', name: 'Pat Price', kind: 'personal', email: 'pat-price@guard.test', status: 'active', pricePerResult: 20, scheduleA: [{ item: 'Late fee', creditor: 'North Bank', bureau: 'Equifax', last4: '4242' }], onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'priced');
    const g = await owner('GET', '/api/workspace');
    g.body.data.clients.find(c => c.id === 'priced').pricePerResult = 99;
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /already signed/);
  });
});

test('staff cannot clear a cancellation through a workspace save', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'cancel', name: 'Cam Cancel', kind: 'personal', email: 'cam@guard.test', status: 'active', onboarding: {} });
    const row = seedSignedClient(built.db.data.workspace, 'cancel');
    row.onboarding.cancelledAt = '2020-02-01';
    row.onboarding.cancelledAtTs = '2020-02-01T15:00:00.000Z';
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-cancel@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const g = await owner('GET', '/api/workspace');
    const client = g.body.data.clients.find(c => c.id === 'cancel');
    client.onboarding.cancelledAt = null;
    client.onboarding.cancelledAtTs = null;
    client.status = 'active';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.clients.find(c => c.id === 'cancel').onboarding.cancelledAt, '2020-02-01');
  });
});

test('a draft invoice cannot be flipped to issued without a deleted item outside the window', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'bill', name: 'Bea Bill', kind: 'personal', email: 'bea@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'bill', { onboarding: { disclosureSignedAt: '2026-01-06', disclosureAcknowledgedAt: '2026-01-06T15:00:00.000Z', contractSignedAt: '2026-01-06', contractSignedAtTs: '2026-01-06T16:00:00.000Z', cancellationWindowEndsAt: '2026-01-09', cancellationWindowEndsAtTs: '2026-01-10T04:59:59.999Z' } });
    const g = await owner('GET', '/api/workspace');
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.disputes.push({ id: 'bd', clientId: 'bill', items: [{ id: 'bi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted' }] });
    g.body.data.invoices.push({ id: 'draft-1', clientId: 'bill', description: 'Draft', amount: 20, status: 'draft' });
    const draft = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(draft.status, 200, JSON.stringify(draft.body));
    const flipped = await owner('GET', '/api/workspace');
    const inv = flipped.body.data.invoices.find(i => i.id === 'draft-1');
    inv.status = 'issued';
    inv.issuedAt = '2026-01-08';
    inv.serviceCompletedAt = '2026-01-08';
    inv.disputeId = 'bd';
    inv.itemId = 'bi';
    const inside = await owner('PUT', '/api/workspace', { baseVersion: flipped.body.version, data: flipped.body.data });
    assert.strictEqual(inside.status, 409);
    assert.match(inside.body.error, /service date/);
    const current = await owner('GET', '/api/workspace');
    const again = current.body.data.invoices.find(i => i.id === 'draft-1');
    again.status = 'issued';
    again.disputeId = 'bd';
    again.itemId = 'bi';
    again.serviceCompletedAt = '2026-06-01';
    again.issuedAt = '2026-06-01';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: current.body.version, data: current.body.data })).status, 200);
  });
});

test('an invoice added as paid is refused without a deleted item', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'paid', name: 'Pay Later', kind: 'personal', email: 'pay@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'paid');
    const g = await owner('GET', '/api/workspace');
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.invoices.push({ id: 'paid-1', clientId: 'paid', description: 'Paid', amount: 20, status: 'paid', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /deleted item/);
  });
});

test('an invoice for a corrected item is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'fix', name: 'Fay Fix', kind: 'personal', email: 'fix@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'fix');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.disputes.push({ id: 'fd', clientId: 'fix', items: [{ id: 'fi', creditor: 'North Bank', bureau: 'Equifax', result: 'corrected' }] });
    g.body.data.invoices.push({ id: 'fix-1', clientId: 'fix', disputeId: 'fd', itemId: 'fi', description: 'Correction', amount: 20, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /not a correction/);
  });
});

test('a second invoice for the same deleted item and bureau is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'dup', name: 'Dee Dup', kind: 'personal', email: 'dee@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'dup');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.disputes.push({ id: 'dd', clientId: 'dup', items: [{ id: 'di', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted' }] });
    g.body.data.invoices.push({ id: 'dup-1', clientId: 'dup', disputeId: 'dd', itemId: 'di', description: 'First', amount: 20, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const next = await owner('GET', '/api/workspace');
    next.body.data.invoices.push({ id: 'dup-2', clientId: 'dup', disputeId: 'dd', itemId: 'di', description: 'Second', amount: 20, status: 'issued', issuedAt: '2020-06-02', serviceCompletedAt: '2020-06-02' });
    const saved = await owner('PUT', '/api/workspace', { baseVersion: next.body.version, data: next.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /one invoice/i);
  });
});

test('an invoice without an item reference is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'bare', name: 'Bea Bare', kind: 'personal', email: 'bare@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'bare');
    const g = await owner('GET', '/api/workspace');
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.invoices.push({ id: 'bare-1', clientId: 'bare', description: 'No item', amount: 20, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /deleted item/);
  });
});

test('a business invoice is not held for a deleted item', async () => {
  await withOwner(async ({ owner }) => {
    await addClient(owner, { id: 'biz', name: 'Biz Co', kind: 'business', email: 'biz@guard.test', status: 'active', onboarding: {} });
    const g = await owner('GET', '/api/workspace');
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.invoices.push({ id: 'biz-1', clientId: 'biz', description: 'Business work', amount: 40, status: 'issued', issuedAt: '2026-06-01', serviceCompletedAt: '2026-06-01' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
  });
});

test('the offline print fallback does not print a stub contract', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const lawJs = fs.readFileSync(path.join(import.meta.dirname, '../js/law.js'), 'utf8');
  const print = appJs.slice(appJs.indexOf('async function printClientDoc'), appJs.indexOf('function progressReport'));
  assert.match(print, /This browser copy cannot print them/);
  assert.doesNotMatch(print, /Law\.contractTerms/);
  assert.doesNotMatch(lawJs, /The signed PDF, when one is stored/);
  assert.match(lawJs, /This browser copy cannot print them/);
});
