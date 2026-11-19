// Named checks for server-owned signatures, client type, and invoice issuing.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createApp } from '../server/app.js';
import { setTransport } from '../server/mailer.js';
import { cancellationWindow } from '../server/croa-window.js';
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

function todayEt() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
}

function futureWindow() {
  const end = new Date(Date.now() + 14 * 864e5);
  return { cancellationWindowEndsAt: end.toISOString().slice(0, 10), cancellationWindowEndsAtTs: end.toISOString() };
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
    seedSignedClient(built.db.data.workspace, 'signed', { onboarding: futureWindow() });
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
    const window = futureWindow();
    seedSignedClient(built.db.data.workspace, 'win', { onboarding: window });
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
    assert.strictEqual(saved.body.data.clients.find(c => c.id === 'win').onboarding.cancellationWindowEndsAtTs, window.cancellationWindowEndsAtTs);
    assert.ok(!(saved.body.data.letters || []).some(l => l.id === 'wl'));
  });
});

test('invited auto-scan stays on hold during the window and runs after it', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'scan', name: 'Sue Scan', kind: 'personal', email: 'sue@guard.test', status: 'active', onboarding: {} });
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: 'scan', email: 'sue@guard.test' });
    const sue = live.client();
    assert.strictEqual((await sue('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'sue password 1' })).status, 200);
    seedSignedClient(built.db.data.workspace, 'scan', { onboarding: futureWindow() });
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
    await addClient(owner, { id: 'bill', name: 'Bea Bill', kind: 'personal', email: 'bea@guard.test', status: 'active', pricePerResult: 20, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'bill', { onboarding: { disclosureSignedAt: '2026-01-06', disclosureAcknowledgedAt: '2026-01-06T15:00:00.000Z', contractSignedAt: '2026-01-06', contractSignedAtTs: '2026-01-06T16:00:00.000Z', cancellationWindowEndsAt: '2026-01-09', cancellationWindowEndsAtTs: '2026-01-10T04:59:59.999Z' } });
    const g = await owner('GET', '/api/workspace');
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.disputes.push({ id: 'bd', clientId: 'bill', items: [{ id: 'bi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2026-06-01' }] });
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
    await addClient(owner, { id: 'dup', name: 'Dee Dup', kind: 'personal', email: 'dee@guard.test', status: 'active', pricePerResult: 20, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'dup');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.disputes.push({ id: 'dd', clientId: 'dup', items: [{ id: 'di', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] });
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

test('a saved letter is held by the server window without changing that window', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'only', name: 'Ollie Only', kind: 'personal', email: 'ollie@guard.test', status: 'active', onboarding: {} });
    const open = futureWindow();
    seedSignedClient(built.db.data.workspace, 'only', { onboarding: open });
    const g = await owner('GET', '/api/workspace');
    g.body.data.letters = g.body.data.letters || [];
    g.body.data.letters.push({ id: 'only-l', clientId: 'only', text: 'Letter', status: 'draft' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 409);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.clients.find(c => c.id === 'only').onboarding.cancellationWindowEndsAtTs, open.cancellationWindowEndsAtTs);
    assert.ok(!(saved.body.data.letters || []).some(l => l.id === 'only-l'));
  });
});

test('flipping a business client to personal drops forged signing dates and holds the work', async () => {
  await withOwner(async ({ owner }) => {
    await addClient(owner, { id: 'flip', name: 'Fay Flip', kind: 'business', email: 'flip@guard.test', status: 'active', onboarding: { disclosureSignedAt: '2020-01-06', contractSignedAt: '2020-01-06', cancellationWindowEndsAt: '2020-01-09', cancellationWindowEndsAtTs: '2020-01-10T04:59:59.999Z' } });
    const g = await owner('GET', '/api/workspace');
    g.body.data.clients.find(c => c.id === 'flip').kind = 'personal';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const saved = await owner('GET', '/api/workspace');
    const row = saved.body.data.clients.find(c => c.id === 'flip');
    assert.strictEqual(row.kind, 'personal');
    assert.strictEqual(row.onboarding.contractSignedAt, null);
    assert.strictEqual(row.onboarding.cancellationWindowEndsAtTs, null);
    saved.body.data.letters = saved.body.data.letters || [];
    saved.body.data.letters.push({ id: 'flip-l', clientId: 'flip', text: 'Letter', status: 'draft' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: saved.body.data })).status, 409);
    assert.strictEqual((await owner('POST', '/api/clients/flip/ai-plan')).status, 409);
  });
});

test('an issued invoice cannot be re-pointed or moved into the window', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'edit', name: 'Eve Edit', kind: 'personal', email: 'eve@guard.test', status: 'active', pricePerResult: 20, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'edit', { onboarding: { disclosureSignedAt: '2026-01-06', disclosureAcknowledgedAt: '2026-01-06T15:00:00.000Z', contractSignedAt: '2026-01-06', contractSignedAtTs: '2026-01-06T16:00:00.000Z', cancellationWindowEndsAt: '2026-01-09', cancellationWindowEndsAtTs: '2026-01-10T04:59:59.999Z' } });
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.disputes.push({ id: 'ed', clientId: 'edit', items: [
      { id: 'good', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2026-06-01' },
      { id: 'bad', creditor: 'South Bank', bureau: 'Experian', result: 'corrected', bureauResultAt: '2026-06-01' }
    ] });
    g.body.data.invoices.push({ id: 'edit-1', clientId: 'edit', disputeId: 'ed', itemId: 'good', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2026-06-01', serviceCompletedAt: '2026-06-01' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const moved = await owner('GET', '/api/workspace');
    const inv = moved.body.data.invoices.find(i => i.id === 'edit-1');
    inv.itemId = 'bad';
    const repoint = await owner('PUT', '/api/workspace', { baseVersion: moved.body.version, data: moved.body.data });
    assert.strictEqual(repoint.status, 409);
    assert.match(repoint.body.error, /locked once it is issued/);
    const dated = await owner('GET', '/api/workspace');
    const still = dated.body.data.invoices.find(i => i.id === 'edit-1');
    still.serviceCompletedAt = '2026-01-08';
    still.issuedAt = '2026-01-08';
    const inside = await owner('PUT', '/api/workspace', { baseVersion: dated.body.version, data: dated.body.data });
    assert.strictEqual(inside.status, 409);
    assert.match(inside.body.error, /locked once it is issued/);
    const second = await owner('GET', '/api/workspace');
    second.body.data.invoices.push({ id: 'edit-2', clientId: 'edit', disputeId: 'ed', itemId: 'good', description: 'Again', amount: 20, status: 'issued', issuedAt: '2026-06-02', serviceCompletedAt: '2026-06-02' });
    const dup = await owner('PUT', '/api/workspace', { baseVersion: second.body.version, data: second.body.data });
    assert.strictEqual(dup.status, 409);
    assert.match(dup.body.error, /one invoice/i);
  });
});

test('an invoice without a dated bureau result is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'nodate', name: 'No Date', kind: 'personal', email: 'nodate@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'nodate');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.disputes.push({ id: 'nd', clientId: 'nodate', items: [{ id: 'ni', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted' }] });
    g.body.data.invoices.push({ id: 'nodate-1', clientId: 'nodate', disputeId: 'nd', itemId: 'ni', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /dated bureau result/);
  });
});

test('a written cancellation is recorded once and then holds the work', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'note', name: 'Ned Note', kind: 'personal', email: 'ned@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'note');
    const open = futureWindow();
    const row = built.db.data.workspace.clients.find(c => c.id === 'note');
    Object.assign(row.onboarding, open);
    const g = await owner('GET', '/api/workspace');
    g.body.data.clients.find(c => c.id === 'note').status = 'cancelled';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const still = await owner('GET', '/api/workspace');
    assert.strictEqual(still.body.data.clients.find(c => c.id === 'note').onboarding.cancelledAt, null);
    still.body.data.letters = still.body.data.letters || [];
    still.body.data.letters.push({ id: 'note-l', clientId: 'note', text: 'Letter', status: 'draft' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: still.body.version, data: still.body.data })).status, 409);
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-note@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const receivedAt = todayEt();
    const recorded = await staff('POST', '/api/clients/note/cancel', { method: 'mail', receivedAt });
    assert.strictEqual(recorded.status, 200);
    assert.strictEqual((await staff('POST', '/api/clients/note/cancel', { method: 'email', receivedAt })).status, 409);
    const audit = await owner('GET', '/api/audit');
    assert.ok(audit.body.some(a => a.action === 'client.cancel' && /mail/.test(a.detail)));
    built.db.data.workspace.clients.find(c => c.id === 'note').onboarding.cancellationWindowEndsAtTs = '2020-01-02T04:59:59.999Z';
    built.db.data.workspace.clients.find(c => c.id === 'note').onboarding.cancellationWindowEndsAt = '2020-01-01';
    const after = await owner('GET', '/api/workspace');
    after.body.data.letters = after.body.data.letters || [];
    after.body.data.letters.push({ id: 'note-l2', clientId: 'note', text: 'Later', status: 'draft' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: after.body.version, data: after.body.data })).status, 409);
    assert.strictEqual((await owner('POST', '/api/clients/note/files/x/scan')).status, 409);
    after.body.data.invoices = after.body.data.invoices || [];
    after.body.data.invoices.push({ id: 'note-inv', clientId: 'note', description: 'After cancel', amount: 20, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    const billed = await owner('GET', '/api/workspace');
    billed.body.data.invoices = billed.body.data.invoices || [];
    billed.body.data.invoices.push({ id: 'note-inv', clientId: 'note', description: 'After cancel', amount: 20, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: billed.body.version, data: billed.body.data })).status, 409);
  });
});

test('a retired enrolled client id cannot come back as a business client', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'gone', name: 'Gina Gone', kind: 'personal', email: 'gina@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'gone');
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-gone@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const asStaff = await owner('GET', '/api/workspace');
    asStaff.body.data.clients = asStaff.body.data.clients.filter(c => c.id !== 'gone');
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: asStaff.body.version, data: asStaff.body.data })).status, 403);
    const asOwner = await owner('GET', '/api/workspace');
    asOwner.body.data.clients = asOwner.body.data.clients.filter(c => c.id !== 'gone');
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: asOwner.body.version, data: asOwner.body.data })).status, 200);
    const again = await owner('GET', '/api/workspace');
    again.body.data.clients.push({ id: 'gone', name: 'Gina Gone', kind: 'business', email: 'gina@guard.test', status: 'active', onboarding: { contractSignedAt: '2020-01-06', cancellationWindowEndsAtTs: '2020-01-10T04:59:59.999Z' } });
    const reborn = await owner('PUT', '/api/workspace', { baseVersion: again.body.version, data: again.body.data });
    assert.strictEqual(reborn.status, 409);
    assert.match(reborn.body.error, /retired/);
  });
});

test('a legacy paid invoice does not block an unrelated save', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'oldpay', name: 'Old Pay', kind: 'personal', email: 'oldpay@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'oldpay');
    built.db.data.workspace.invoices = built.db.data.workspace.invoices || [];
    built.db.data.workspace.invoices.push({ id: 'legacy-paid', clientId: 'oldpay', description: 'Old payment', amount: 40, status: 'paid', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    const g = await owner('GET', '/api/workspace');
    g.body.data.tasks = g.body.data.tasks || [];
    g.body.data.tasks.push({ id: 'task-old', clientId: 'oldpay', title: 'Call the client', due: '2020-07-01', done: false });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
  });
});

test('a new issued invoice with the wrong amount is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'newamt', name: 'New Amount', kind: 'personal', email: 'newamt@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'newamt');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'nd', clientId: 'newamt', items: [{ id: 'ni', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.invoices.push({ id: 'new-999', clientId: 'newamt', disputeId: 'nd', itemId: 'ni', description: 'Deletion', amount: 999, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /price per result/);
  });
});

test('a draft flipped to issued with the wrong amount is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'flipamt', name: 'Flip Amount', kind: 'personal', email: 'flipamt@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'flipamt');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'fd', clientId: 'flipamt', items: [{ id: 'fi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.invoices.push({ id: 'flip-999', clientId: 'flipamt', description: 'Draft', amount: 999, status: 'draft' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const next = await owner('GET', '/api/workspace');
    const inv = next.body.data.invoices.find(i => i.id === 'flip-999');
    inv.status = 'issued';
    inv.disputeId = 'fd';
    inv.itemId = 'fi';
    inv.issuedAt = '2020-06-01';
    inv.serviceCompletedAt = '2020-06-01';
    const saved = await owner('PUT', '/api/workspace', { baseVersion: next.body.version, data: next.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /price per result/);
  });
});

test('an invoice added as paid with the wrong amount is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'paidamt', name: 'Paid Amount', kind: 'personal', email: 'paidamt@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'paidamt');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'pd2', clientId: 'paidamt', items: [{ id: 'pi2', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.invoices.push({ id: 'paid-999', clientId: 'paidamt', disputeId: 'pd2', itemId: 'pi2', description: 'Paid', amount: 999, status: 'paid', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /price per result/);
  });
});

test('changing an issued invoice amount must match the price per result', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'price', name: 'Price Client', kind: 'personal', email: 'price@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'price');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.invoices = g.body.data.invoices || [];
    g.body.data.disputes.push({ id: 'pd', clientId: 'price', items: [{ id: 'pi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] });
    g.body.data.invoices.push({ id: 'price-1', clientId: 'price', disputeId: 'pd', itemId: 'pi', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const next = await owner('GET', '/api/workspace');
    next.body.data.invoices.find(i => i.id === 'price-1').amount = 60;
    const saved = await owner('PUT', '/api/workspace', { baseVersion: next.body.version, data: next.body.data });
    assert.strictEqual(saved.status, 409);
    assert.match(saved.body.error, /locked once it is issued/);
  });
});

test('a cancelled client stays cancelled when a save sets the status back to active', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'stay', name: 'Stay Cancelled', kind: 'personal', email: 'stay@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'stay');
    const receivedAt = todayEt();
    assert.strictEqual((await owner('POST', '/api/clients/stay/cancel', { method: 'email', receivedAt })).status, 200);
    const g = await owner('GET', '/api/workspace');
    g.body.data.clients.find(c => c.id === 'stay').status = 'active';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.clients.find(c => c.id === 'stay').status, 'cancelled');
  });
});

test('a paid invoice locks the dispute item, bureau, result and result date', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'lock', name: 'Lock Item', kind: 'personal', email: 'lock@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'lock');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'ld', clientId: 'lock', items: [{ id: 'li', item: 'Late fee', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'lock-1', clientId: 'lock', disputeId: 'ld', itemId: 'li', description: 'Deletion', amount: 50, status: 'paid', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const next = await owner('GET', '/api/workspace');
    const item = next.body.data.disputes.find(d => d.id === 'ld').items.find(it => it.id === 'li');
    item.result = 'corrected';
    item.bureau = 'Experian';
    item.bureauResultAt = null;
    item.item = 'Something else';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: next.body.version, data: next.body.data })).status, 200);
    const saved = (await owner('GET', '/api/workspace')).body.data.disputes.find(d => d.id === 'ld').items.find(it => it.id === 'li');
    assert.strictEqual(saved.result, 'deleted');
    assert.strictEqual(saved.bureau, 'Equifax');
    assert.strictEqual(saved.bureauResultAt, '2020-06-01');
    assert.strictEqual(saved.item, 'Late fee');
  });
});

test('a new invoice is refused when no price is set or the result date is before signing', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'noprice', name: 'No Price', kind: 'personal', email: 'noprice@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'noprice');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'np', clientId: 'noprice', items: [{ id: 'npi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'noprice-1', clientId: 'noprice', disputeId: 'np', itemId: 'npi', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    const missing = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(missing.status, 409);
    assert.match(missing.body.error, /price per result/);
    built.db.data.workspace.clients.find(c => c.id === 'noprice').pricePerResult = 20;
    const priced = await owner('GET', '/api/workspace');
    priced.body.data.disputes = [{ id: 'np', clientId: 'noprice', items: [{ id: 'npi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2019-12-01' }] }];
    priced.body.data.invoices = [{ id: 'early-result', clientId: 'noprice', disputeId: 'np', itemId: 'npi', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    const early = await owner('PUT', '/api/workspace', { baseVersion: priced.body.version, data: priced.body.data });
    assert.strictEqual(early.status, 409);
    assert.match(early.body.error, /after the cancellation window/);
  });
});

test('a timely written cancellation with an invoice creates a refund task', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'time', name: 'Timely Note', kind: 'personal', email: 'time@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'time');
    const deadline = cancellationWindow('2020-01-06T16:00:00.000Z').deadlineDateEt;
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'td', clientId: 'time', items: [{ id: 'ti', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'time-1', clientId: 'time', disputeId: 'td', itemId: 'ti', description: 'Deletion', amount: 50, status: 'paid', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const future = await owner('POST', '/api/clients/time/cancel', { method: 'mail', receivedAt: todayEt(), postmarkAt: '2099-01-01' });
    assert.strictEqual(future.status, 400);
    const timely = await owner('POST', '/api/clients/time/cancel', { method: 'mail', receivedAt: todayEt(), postmarkAt: deadline });
    assert.strictEqual(timely.status, 200);
    assert.strictEqual(timely.body.timely, true);
    assert.strictEqual(timely.body.refundTask, true);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.clients.find(c => c.id === 'time').onboarding.cancellationTimely, true);
    assert.ok(saved.body.data.tasks.some(t => t.clientId === 'time' && /Refund/.test(t.title)));
  });
});

test('a cancellation received before the contract was signed is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'earlynote', name: 'Early Note', kind: 'personal', email: 'earlynote@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'earlynote');
    const early = await owner('POST', '/api/clients/earlynote/cancel', { method: 'email', receivedAt: '2019-12-01' });
    assert.strictEqual(early.status, 400);
    assert.match(early.body.error, /before the contract was signed/);
  });
});

test('emailing an invoice is refused while the client is cancelled', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'nomail', name: 'No Mail', kind: 'personal', email: 'nomail@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'nomail');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'md', clientId: 'nomail', items: [{ id: 'mi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'nomail-1', clientId: 'nomail', disputeId: 'md', itemId: 'mi', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/clients/nomail/cancel', { method: 'other', receivedAt: todayEt() })).status, 200);
    const sent = await owner('POST', '/api/invoices/nomail-1/email', {});
    assert.strictEqual(sent.status, 409);
    assert.match(sent.body.error, /cancelled or on hold/);
  });
});

test('the client record can record a written cancellation', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const views = fs.readFileSync(path.join(import.meta.dirname, '../js/views.js'), 'utf8');
  assert.match(appJs, /record-cancel/);
  assert.match(appJs, /\/api\/clients\/' \+ encodeURIComponent\(id\) \+ '\/cancel'/);
  assert.match(appJs, /postmarkAt/);
  assert.match(views, /data-act="record-cancel"/);
});

test('a matching email or name requires the owner to create a business client', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'ada', name: 'Ada Person', kind: 'personal', email: 'Ada.Person@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'ada');
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-ada@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const asStaff = await owner('GET', '/api/workspace');
    asStaff.body.data.clients.push({ id: 'ada-biz', name: 'Other Business', kind: 'business', email: 'ada.person@guard.test', status: 'lead', onboarding: {} });
    const denied = await staff('PUT', '/api/workspace', { baseVersion: asStaff.body.version, data: asStaff.body.data });
    assert.strictEqual(denied.status, 409);
    assert.match(denied.body.error, /Only the owner can add a business client/);
    const byName = await owner('GET', '/api/workspace');
    byName.body.data.clients.push({ id: 'ada-name', name: 'ada person', kind: 'business', email: 'different@guard.test', status: 'lead', onboarding: {} });
    const named = await staff('PUT', '/api/workspace', { baseVersion: byName.body.version, data: byName.body.data });
    assert.strictEqual(named.status, 409);
    const asOwner = await owner('GET', '/api/workspace');
    asOwner.body.data.clients.push({ id: 'ada-owner', name: 'Fresh Business', kind: 'business', email: 'ADA.PERSON@guard.test', status: 'lead', onboarding: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: asOwner.body.version, data: asOwner.body.data })).status, 200);
    const audit = await owner('GET', '/api/audit');
    assert.ok(audit.body.some(a => a.action === 'client.business_match'));
    const drop = await owner('GET', '/api/workspace');
    drop.body.data.clients = drop.body.data.clients.filter(c => c.id !== 'ada');
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: drop.body.version, data: drop.body.data })).status, 200);
    const after = await owner('GET', '/api/workspace');
    after.body.data.clients.push({ id: 'ada-again', name: 'New Name', kind: 'business', email: 'ada.person@guard.test', status: 'lead', onboarding: {} });
    const again = await staff('PUT', '/api/workspace', { baseVersion: after.body.version, data: after.body.data });
    assert.strictEqual(again.status, 409);
  });
});

test('a postmark after the received date is refused and timeliness uses the earlier date', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'mark', name: 'Mark Date', kind: 'personal', email: 'mark@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'mark');
    const latePost = await owner('POST', '/api/clients/mark/cancel', { method: 'mail', receivedAt: '2020-11-28', postmarkAt: '2020-12-02' });
    assert.strictEqual(latePost.status, 400);
    assert.match(latePost.body.error, /cannot be after the date the notice was received/);
    const deadline = cancellationWindow('2020-01-06T16:00:00.000Z').deadlineDateEt;
    const timely = await owner('POST', '/api/clients/mark/cancel', { method: 'mail', receivedAt: '2020-12-02', postmarkAt: deadline });
    assert.strictEqual(timely.status, 200);
    assert.strictEqual(timely.body.timely, true);
  });
});

test('the cancelled-on field is not an editable date', () => {
  const views = fs.readFileSync(path.join(import.meta.dirname, '../js/views.js'), 'utf8');
  const compliance = views.slice(views.indexOf('function clientCompliance'), views.indexOf('function clientDocuments'));
  assert.match(compliance, /data-cancelled-on/);
  assert.match(compliance, /Record a written cancellation/);
  assert.doesNotMatch(compliance, /UI\.field\('Cancelled on'/);
});

test('an issued or paid invoice cannot be deleted, and voiding is owner-only with the item locked', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'voidme', name: 'Void Me', kind: 'personal', email: 'voidme@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'voidme');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'vd', clientId: 'voidme', items: [{ id: 'vi', item: 'Late fee', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'void-1', clientId: 'voidme', disputeId: 'vd', itemId: 'vi', description: 'Deletion', amount: 50, status: 'paid', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-void@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const dropped = await owner('GET', '/api/workspace');
    dropped.body.data.invoices = [];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: dropped.body.version, data: dropped.body.data })).status, 409);
    const asStaff = await owner('GET', '/api/workspace');
    asStaff.body.data.invoices.find(i => i.id === 'void-1').status = 'void';
    asStaff.body.data.invoices.find(i => i.id === 'void-1').voidReason = 'duplicate';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: asStaff.body.version, data: asStaff.body.data })).status, 403);
    const noReason = await owner('GET', '/api/workspace');
    noReason.body.data.invoices.find(i => i.id === 'void-1').status = 'void';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: noReason.body.version, data: noReason.body.data })).status, 400);
    const ok = await owner('GET', '/api/workspace');
    const invoice = ok.body.data.invoices.find(i => i.id === 'void-1');
    invoice.status = 'void';
    invoice.voidReason = 'billed the wrong client';
    ok.body.data.disputes.find(d => d.id === 'vd').items.find(it => it.id === 'vi').result = 'corrected';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: ok.body.version, data: ok.body.data })).status, 200);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.invoices.find(i => i.id === 'void-1').status, 'void');
    assert.strictEqual(saved.body.data.disputes.find(d => d.id === 'vd').items.find(it => it.id === 'vi').result, 'deleted');
    const audit = await owner('GET', '/api/audit');
    assert.ok(audit.body.some(a => a.action === 'invoice.void' && /billed the wrong client/.test(a.detail)));
  });
});

test('a bureau result date in the future or inside the cancellation window is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'resultday', name: 'Result Day', kind: 'personal', email: 'resultday@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'resultday');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'rd', clientId: 'resultday', items: [{ id: 'ri', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2099-01-01' }] }];
    g.body.data.invoices = [{ id: 'result-future', clientId: 'resultday', disputeId: 'rd', itemId: 'ri', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    const future = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(future.status, 409);
    assert.match(future.body.error, /after today/);
    const next = await owner('GET', '/api/workspace');
    next.body.data.disputes = [{ id: 'rd', clientId: 'resultday', items: [{ id: 'ri', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-01-06' }] }];
    next.body.data.invoices = [{ id: 'result-window', clientId: 'resultday', disputeId: 'rd', itemId: 'ri', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    const inside = await owner('PUT', '/api/workspace', { baseVersion: next.body.version, data: next.body.data });
    assert.strictEqual(inside.status, 409);
    assert.match(inside.body.error, /after the cancellation window/);
  });
});

test('normalized names and emails still require the owner for a business client', async () => {
  await withOwner(async ({ owner, live }) => {
    await addClient(owner, { id: 'norm', name: 'Ada Person', kind: 'personal', email: 'adaperson@gmail.com', status: 'active', onboarding: {} });
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-norm@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const asStaff = await owner('GET', '/api/workspace');
    asStaff.body.data.clients.push({ id: 'norm-biz', name: 'Ada  Q.  Person LLC', kind: 'business', email: 'a.da.person+tag@gmail.com', status: 'lead', onboarding: {} });
    const denied = await staff('PUT', '/api/workspace', { baseVersion: asStaff.body.version, data: asStaff.body.data });
    assert.strictEqual(denied.status, 409);
    const edit = await owner('GET', '/api/workspace');
    edit.body.data.clients.push({ id: 'plain-biz', name: 'Plain Books', kind: 'business', email: 'plain@guard.test', status: 'lead', onboarding: {} });
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: edit.body.version, data: edit.body.data })).status, 200);
    const renamed = await owner('GET', '/api/workspace');
    renamed.body.data.clients.find(c => c.id === 'plain-biz').name = 'Ada Person Inc';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: renamed.body.version, data: renamed.body.data })).status, 409);
    const asOwner = await owner('GET', '/api/workspace');
    asOwner.body.data.clients.find(c => c.id === 'plain-biz').name = 'Ada Person Corp';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: asOwner.body.version, data: asOwner.body.data })).status, 200);
    const audit = await owner('GET', '/api/audit');
    assert.ok(audit.body.some(a => a.action === 'client.business_match' && a.detail.includes('plain-biz')));
    const comma = await owner('GET', '/api/workspace');
    comma.body.data.clients.push({ id: 'jane', name: 'Jane Doe', kind: 'personal', email: 'jane@guard.test', status: 'active', onboarding: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: comma.body.version, data: comma.body.data })).status, 200);
    const reversed = await owner('GET', '/api/workspace');
    reversed.body.data.clients.push({ id: 'jane-biz', name: 'Doe, Jane', kind: 'business', email: 'doejane@guard.test', status: 'lead', onboarding: {} });
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: reversed.body.version, data: reversed.body.data })).status, 409);
    const van = await owner('GET', '/api/workspace');
    van.body.data.clients.push({ id: 'jane-van', name: 'Jane Van Doe', kind: 'personal', email: 'janevan@guard.test', status: 'active', onboarding: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: van.body.version, data: van.body.data })).status, 200);
    const vanBiz = await owner('GET', '/api/workspace');
    vanBiz.body.data.clients.push({ id: 'van-biz', name: 'Van Doe, Jane', kind: 'business', email: 'vandoe@guard.test', status: 'lead', onboarding: {} });
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: vanBiz.body.version, data: vanBiz.body.data })).status, 409);
  });
});

test('a timely cancellation voids unpaid invoices and refunds only paid ones', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'mix', name: 'Mix Bill', kind: 'personal', email: 'mix@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'mix');
    const deadline = cancellationWindow('2020-01-06T16:00:00.000Z').deadlineDateEt;
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'md', clientId: 'mix', items: [
      { id: 'unpaid', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' },
      { id: 'paiditem', creditor: 'South Bank', bureau: 'Experian', result: 'deleted', bureauResultAt: '2020-06-02' }
    ] }];
    g.body.data.invoices = [
      { id: 'mix-issued', clientId: 'mix', disputeId: 'md', itemId: 'unpaid', description: 'Open', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' },
      { id: 'mix-paid', clientId: 'mix', disputeId: 'md', itemId: 'paiditem', description: 'Paid', amount: 50, status: 'paid', issuedAt: '2020-06-02', serviceCompletedAt: '2020-06-02' }
    ];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const done = await owner('POST', '/api/clients/mix/cancel', { method: 'mail', receivedAt: '2020-12-02', postmarkAt: deadline });
    assert.strictEqual(done.status, 200);
    assert.strictEqual(done.body.timely, true);
    assert.strictEqual(done.body.refundTask, true);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.invoices.find(i => i.id === 'mix-issued').status, 'void');
    assert.strictEqual(saved.body.data.invoices.find(i => i.id === 'mix-issued').voidReason, 'timely CROA cancellation');
    assert.strictEqual(saved.body.data.invoices.find(i => i.id === 'mix-paid').status, 'paid');
    const task = saved.body.data.tasks.find(t => t.clientId === 'mix' && /Refund/.test(t.title));
    assert.ok(task);
    assert.match(task.title, /paid/);
    const audit = await owner('GET', '/api/audit');
    assert.ok(audit.body.some(a => a.action === 'invoice.void' && /timely CROA cancellation/.test(a.detail)));
  });
});

test('an approved business match does not block later staff saves or repeat owner audits', async () => {
  await withOwner(async ({ owner, live }) => {
    await addClient(owner, { id: 'john', name: 'John Smith', kind: 'personal', email: 'john@guard.test', status: 'active', onboarding: {} });
    await addClient(owner, { id: 'pat', name: 'Pat Other', kind: 'personal', email: 'pat@guard.test', status: 'lead', onboarding: {} });
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-john@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const first = await owner('GET', '/api/workspace');
    first.body.data.clients.push({ id: 'john-inc', name: 'John Smith, Inc.', kind: 'business', email: 'john.inc@guard.test', status: 'lead', onboarding: {}, businessMatchApproval: { user: 'owner@guard.test', at: '2020-01-01T00:00:00.000Z', matchedIds: ['john'], name: 'john smith', email: 'john.inc@guard.test' } });
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: first.body.version, data: first.body.data })).status, 409);
    const approved = await owner('GET', '/api/workspace');
    approved.body.data.clients.push({ id: 'john-inc', name: 'John Smith, Inc.', kind: 'business', email: 'john.inc@guard.test', status: 'lead', onboarding: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: approved.body.version, data: approved.body.data })).status, 200);
    const auditsAfter = (await owner('GET', '/api/audit')).body.filter(a => a.action === 'client.business_match').length;
    const tasks = await owner('GET', '/api/workspace');
    tasks.body.data.tasks = tasks.body.data.tasks || [];
    tasks.body.data.tasks.push({ id: 'task-john', clientId: 'pat', title: 'Call Pat', due: '2020-07-01', done: false });
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: tasks.body.version, data: tasks.body.data })).status, 200);
    const personal = await owner('GET', '/api/workspace');
    personal.body.data.clients.find(c => c.id === 'pat').notes = 'Updated by staff';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: personal.body.version, data: personal.body.data })).status, 200);
    const extra = await owner('GET', '/api/workspace');
    extra.body.data.clients.push({ id: 'other-biz', name: 'Other Books LLC', kind: 'business', email: 'otherbooks@guard.test', status: 'lead', onboarding: {} });
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: extra.body.version, data: extra.body.data })).status, 200);
    const again = await owner('GET', '/api/workspace');
    again.body.data.clients.find(c => c.id === 'john-inc').notes = 'Owner note';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: again.body.version, data: again.body.data })).status, 200);
    const auditsNow = (await owner('GET', '/api/audit')).body.filter(a => a.action === 'client.business_match').length;
    assert.strictEqual(auditsNow, auditsAfter);
    const renamed = await owner('GET', '/api/workspace');
    renamed.body.data.clients.find(c => c.id === 'john-inc').email = 'john@guard.test';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: renamed.body.version, data: renamed.body.data })).status, 409);
    const toPersonal = await owner('GET', '/api/workspace');
    toPersonal.body.data.clients.find(c => c.id === 'john-inc').kind = 'personal';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: toPersonal.body.version, data: toPersonal.body.data })).status, 200);
    const back = await owner('GET', '/api/workspace');
    back.body.data.clients.find(c => c.id === 'john-inc').kind = 'business';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: back.body.version, data: back.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/audit')).body.filter(a => a.action === 'client.business_match').length, auditsNow + 1);
  });
});

test('moving an issued invoice off issued or paid is a void and the amount stays locked', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'stuck', name: 'Stuck Bill', kind: 'personal', email: 'stuck@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'stuck');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'sd', clientId: 'stuck', items: [{ id: 'si', item: 'Late fee', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'stuck-1', clientId: 'stuck', disputeId: 'sd', itemId: 'si', description: 'Deletion', amount: 50, status: 'paid', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const staff = live.client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-stuck@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const drafted = await owner('GET', '/api/workspace');
    const draftInv = drafted.body.data.invoices.find(i => i.id === 'stuck-1');
    draftInv.status = 'draft';
    drafted.body.data.disputes.find(d => d.id === 'sd').items.find(it => it.id === 'si').result = 'corrected';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: drafted.body.version, data: drafted.body.data })).status, 403);
    const invented = await owner('GET', '/api/workspace');
    const bad = invented.body.data.invoices.find(i => i.id === 'stuck-1');
    bad.status = 'refunded';
    bad.amount = 0;
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: invented.body.version, data: invented.body.data })).status, 403);
    const amount = await owner('GET', '/api/workspace');
    amount.body.data.invoices.find(i => i.id === 'stuck-1').amount = 0;
    const locked = await owner('PUT', '/api/workspace', { baseVersion: amount.body.version, data: amount.body.data });
    assert.strictEqual(locked.status, 409);
    assert.match(locked.body.error, /locked once it is paid/);
    const kept = await owner('GET', '/api/workspace');
    assert.strictEqual(kept.body.data.invoices.find(i => i.id === 'stuck-1').status, 'paid');
    assert.strictEqual(kept.body.data.invoices.find(i => i.id === 'stuck-1').amount, 50);
    assert.strictEqual(kept.body.data.disputes.find(d => d.id === 'sd').items.find(it => it.id === 'si').result, 'deleted');
    const noReason = await owner('GET', '/api/workspace');
    noReason.body.data.invoices.find(i => i.id === 'stuck-1').status = 'draft';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: noReason.body.version, data: noReason.body.data })).status, 400);
    const toDraft = await owner('GET', '/api/workspace');
    const moving = toDraft.body.data.invoices.find(i => i.id === 'stuck-1');
    moving.status = 'draft';
    moving.voidReason = 'billed the wrong client';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: toDraft.body.version, data: toDraft.body.data })).status, 200);
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.invoices.find(i => i.id === 'stuck-1').status, 'void');
    assert.strictEqual(after.body.data.invoices.find(i => i.id === 'stuck-1').amount, 50);
    assert.ok((await owner('GET', '/api/audit')).body.some(a => a.action === 'invoice.void'));
  });
});

test('a voided invoice cannot be set back to paid', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'terminal', name: 'Terminal Bill', kind: 'personal', email: 'terminal@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'terminal');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'td', clientId: 'terminal', items: [{ id: 'ti', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'terminal-1', clientId: 'terminal', disputeId: 'td', itemId: 'ti', description: 'Deletion', amount: 50, status: 'paid', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const voiding = await owner('GET', '/api/workspace');
    const invoice = voiding.body.data.invoices.find(i => i.id === 'terminal-1');
    invoice.status = 'void';
    invoice.voidReason = 'entered twice';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: voiding.body.version, data: voiding.body.data })).status, 200);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-terminal@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = (await owner('GET', '/api/audit')).body.filter(a => a.action === 'invoice.void').length;
    const reopened = await owner('GET', '/api/workspace');
    reopened.body.data.invoices.find(i => i.id === 'terminal-1').status = 'paid';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: reopened.body.version, data: reopened.body.data });
    assert.strictEqual(denied.status, 409);
    assert.match(denied.body.error, /cannot be reopened/);
    const ownerTry = await owner('GET', '/api/workspace');
    ownerTry.body.data.invoices.find(i => i.id === 'terminal-1').status = 'paid';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: ownerTry.body.version, data: ownerTry.body.data })).status, 409);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.invoices.find(i => i.id === 'terminal-1').status, 'void');
    assert.strictEqual((await owner('GET', '/api/audit')).body.filter(a => a.action === 'invoice.void').length, before);
  });
});

test('a cancellation date after today or an impossible date is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'when', name: 'When Cancel', kind: 'personal', email: 'when@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'when');
    assert.strictEqual((await owner('POST', '/api/clients/when/cancel', { method: 'mail', receivedAt: '2099-01-01' })).status, 400);
    assert.strictEqual((await owner('POST', '/api/clients/when/cancel', { method: 'mail', receivedAt: '2026-02-31' })).status, 400);
    const receivedAt = todayEt();
    assert.strictEqual((await owner('POST', '/api/clients/when/cancel', { method: 'other', receivedAt })).status, 200);
  });
});

function usePayLink(workspace) {
  workspace.settings = workspace.settings || {};
  workspace.settings.billing = Object.assign({}, workspace.settings.billing, { provider: 'link', payLink: 'https://pay.example/checkout' });
}

test('a draft invoice cannot be paid or emailed, and an issued invoice pays only when the client is clear', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'payer', name: 'Pay Client', kind: 'personal', email: 'payer@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'payer');
    usePayLink(built.db.data.workspace);
    const draft = await owner('GET', '/api/workspace');
    draft.body.data.invoices = [{ id: 'draft-bill', clientId: 'payer', description: 'Not sent', amount: 500, status: 'draft', payToken: 'draft-token-save', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: draft.body.version, data: draft.body.data })).status, 200);
    const savedDraft = (await owner('GET', '/api/workspace')).body.data.invoices.find(i => i.id === 'draft-bill');
    assert.strictEqual(savedDraft.payToken, undefined);
    assert.strictEqual((await owner('GET', '/pay/draft-token-save')).status, 404);
    built.db.data.workspace.invoices.find(i => i.id === 'draft-bill').payToken = 'draft-token-live';
    const refused = await owner('GET', '/pay/draft-token-live');
    assert.strictEqual(refused.status, 409);
    assert.match(refused.body, /draft/i);
    assert.notStrictEqual(refused.headers.get('location'), 'https://pay.example/checkout');
    const mailed = await owner('POST', '/api/invoices/draft-bill/email', {});
    assert.strictEqual(mailed.status, 409);
    assert.match(mailed.body.error, /draft/);
    assert.ok(!JSON.stringify(mailed.body).includes('pay.example'));
    built.db.data.workspace.invoices.push({ id: 'window-bill', clientId: 'payer', description: 'Too soon', amount: 50, status: 'issued', payToken: 'window-token', serviceCompletedAt: '2020-06-01', issuedAt: '2020-06-01' });
    seedSignedClient(built.db.data.workspace, 'payer', { onboarding: futureWindow() });
    const held = await owner('GET', '/pay/window-token');
    assert.strictEqual(held.status, 409);
    assert.match(held.body, /can’t be paid online yet/);
    seedSignedClient(built.db.data.workspace, 'payer');
    assert.strictEqual((await owner('POST', '/api/clients/payer/cancel', { method: 'email', receivedAt: todayEt() })).status, 200);
    built.db.data.workspace.invoices.push({ id: 'cancel-bill', clientId: 'payer', description: 'After cancel', amount: 50, status: 'issued', payToken: 'cancel-token', serviceCompletedAt: '2020-06-01', issuedAt: '2020-06-01' });
    const cancelled = await owner('GET', '/pay/cancel-token');
    assert.strictEqual(cancelled.status, 409);
    assert.match(cancelled.body, /can’t be paid online yet/);
    await addClient(owner, { id: 'ready', name: 'Ready Client', kind: 'personal', email: 'ready@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'ready');
    built.db.data.workspace.invoices.push({ id: 'ready-bill', clientId: 'ready', description: 'Deletion', amount: 50, status: 'issued', payToken: 'ready-token', serviceCompletedAt: '2020-06-01', issuedAt: '2020-06-01' });
    const open = await owner('GET', '/pay/ready-token');
    assert.strictEqual(open.status, 302);
    assert.strictEqual(open.headers.get('location'), 'https://pay.example/checkout');
    assert.strictEqual((await owner('POST', '/api/invoices/ready-bill/email', {})).status, 501);
  });
});

test('a paper-signed client without server signatures keeps the previous pay-page gate', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'paper', name: 'Paper Client', kind: 'personal', email: 'paper@guard.test', status: 'active', onboarding: {} });
    const paper = built.db.data.workspace.clients.find(c => c.id === 'paper');
    paper.onboarding = { disclosureSignedAt: '2020-01-06', contractSignedAt: '2020-01-06', contractSignedAtTs: '2020-01-06T16:00:00.000Z', cancellationWindowEndsAt: '2020-01-09', cancellationWindowEndsAtTs: '2020-01-10T04:59:59.999Z' };
    usePayLink(built.db.data.workspace);
    built.db.data.workspace.invoices = [{ id: 'paper-bill', clientId: 'paper', description: 'Old invoice', amount: 40, status: 'issued', payToken: 'paper-token', serviceCompletedAt: '2020-06-01', issuedAt: '2020-06-01' }];
    const paid = await owner('GET', '/pay/paper-token');
    assert.strictEqual(paid.status, 302);
    assert.strictEqual(paid.headers.get('location'), 'https://pay.example/checkout');
    paper.onboarding.cancellationWindowEndsAtTs = new Date(Date.now() + 5 * 864e5).toISOString();
    const inside = await owner('GET', '/pay/paper-token');
    assert.strictEqual(inside.status, 409);
  });
});

test('a paid invoice can only be voided and the paid date stays', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'paidlock', name: 'Paid Lock', kind: 'personal', email: 'paidlock@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'paidlock');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'pld', clientId: 'paidlock', items: [{ id: 'pli', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'paid-lock', clientId: 'paidlock', disputeId: 'pld', itemId: 'pli', description: 'Deletion', amount: 50, status: 'paid', paidAt: '2020-06-02', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const stamped = (await owner('GET', '/api/workspace')).body.data.invoices.find(i => i.id === 'paid-lock').paidAt;
    assert.notStrictEqual(stamped, '2020-06-02');
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-paidlock@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const asStaff = await owner('GET', '/api/workspace');
    const staffInv = asStaff.body.data.invoices.find(i => i.id === 'paid-lock');
    staffInv.status = 'issued';
    staffInv.paidAt = '';
    const staffMove = await staff('PUT', '/api/workspace', { baseVersion: asStaff.body.version, data: asStaff.body.data });
    assert.strictEqual(staffMove.status, 409);
    assert.match(staffMove.body.error, /only be voided/);
    const asOwner = await owner('GET', '/api/workspace');
    const ownerInv = asOwner.body.data.invoices.find(i => i.id === 'paid-lock');
    ownerInv.status = 'issued';
    ownerInv.paidAt = null;
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: asOwner.body.version, data: asOwner.body.data })).status, 409);
    const kept = await owner('GET', '/api/workspace');
    assert.strictEqual(kept.body.data.invoices.find(i => i.id === 'paid-lock').status, 'paid');
    assert.strictEqual(kept.body.data.invoices.find(i => i.id === 'paid-lock').paidAt, stamped);
    const deadline = cancellationWindow('2020-01-06T16:00:00.000Z').deadlineDateEt;
    const done = await owner('POST', '/api/clients/paidlock/cancel', { method: 'mail', receivedAt: '2020-12-02', postmarkAt: deadline });
    assert.strictEqual(done.status, 200);
    assert.strictEqual(done.body.refundTask, true);
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.invoices.find(i => i.id === 'paid-lock').status, 'paid');
    assert.strictEqual(after.body.data.invoices.find(i => i.id === 'paid-lock').paidAt, stamped);
  });
});

test('an issued invoice cannot be re-pointed, renamed, or given a new paid date', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'relock', name: 'Re Lock', kind: 'personal', email: 'relock@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    await addClient(owner, { id: 'other', name: 'Other Client', kind: 'personal', email: 'otherlock@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'relock');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'rld', clientId: 'relock', items: [{ id: 'rli', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }, { id: 'rlj', creditor: 'South Bank', bureau: 'Experian', result: 'deleted', bureauResultAt: '2020-06-02' }] }];
    g.body.data.invoices = [{ id: 're-lock', clientId: 'relock', disputeId: 'rld', itemId: 'rli', description: 'Deletion', amount: 50, status: 'paid', paidAt: '2020-06-03', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-relock@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const moved = await owner('GET', '/api/workspace');
    const inv = moved.body.data.invoices.find(i => i.id === 're-lock');
    const stampedPaid = inv.paidAt;
    inv.clientId = 'other';
    inv.disputeId = 'missing';
    inv.itemId = 'rlj';
    inv.description = 'Renamed';
    inv.issuedAt = '2020-07-01';
    inv.paidAt = '2020-07-02';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: moved.body.version, data: moved.body.data });
    assert.strictEqual(denied.status, 409);
    assert.match(denied.body.error, /locked once it is paid|paid date is set by the server/);
    const kept = await owner('GET', '/api/workspace');
    const still = kept.body.data.invoices.find(i => i.id === 're-lock');
    assert.strictEqual(still.clientId, 'relock');
    assert.strictEqual(still.description, 'Deletion');
    assert.strictEqual(still.paidAt, stampedPaid);
  });
});

test('a voided invoice cannot be deleted or rewritten', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'voidlock', name: 'Void Lock', kind: 'personal', email: 'voidlock@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'voidlock');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'vld', clientId: 'voidlock', items: [{ id: 'vli', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'void-lock', clientId: 'voidlock', disputeId: 'vld', itemId: 'vli', description: 'Deletion', amount: 50, status: 'paid', paidAt: '2020-06-02', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const voiding = await owner('GET', '/api/workspace');
    const invoice = voiding.body.data.invoices.find(i => i.id === 'void-lock');
    invoice.status = 'void';
    invoice.voidReason = 'entered twice';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: voiding.body.version, data: voiding.body.data })).status, 200);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-voidlock@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const dropped = await owner('GET', '/api/workspace');
    dropped.body.data.invoices = dropped.body.data.invoices.filter(i => i.id !== 'void-lock');
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: dropped.body.version, data: dropped.body.data })).status, 409);
    const ownerDrop = await owner('GET', '/api/workspace');
    ownerDrop.body.data.invoices = ownerDrop.body.data.invoices.filter(i => i.id !== 'void-lock');
    const ownerDenied = await owner('PUT', '/api/workspace', { baseVersion: ownerDrop.body.version, data: ownerDrop.body.data });
    assert.strictEqual(ownerDenied.status, 409);
    assert.match(ownerDenied.body.error, /cannot be deleted/);
    const reason = await owner('GET', '/api/workspace');
    reason.body.data.invoices.find(i => i.id === 'void-lock').voidReason = 'changed later';
    const reasonDenied = await owner('PUT', '/api/workspace', { baseVersion: reason.body.version, data: reason.body.data });
    assert.strictEqual(reasonDenied.status, 409);
    assert.match(reasonDenied.body.error, /void reason/);
    const amount = await owner('GET', '/api/workspace');
    amount.body.data.invoices.find(i => i.id === 'void-lock').amount = 0;
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: amount.body.version, data: amount.body.data })).status, 409);
    const saved = await owner('GET', '/api/workspace');
    const still = saved.body.data.invoices.find(i => i.id === 'void-lock');
    assert.strictEqual(still.status, 'void');
    assert.strictEqual(still.voidReason, 'entered twice');
    assert.strictEqual(still.amount, 50);
    assert.strictEqual(saved.body.data.disputes.find(d => d.id === 'vld').items.find(it => it.id === 'vli').result, 'deleted');
  });
});

test('a rejected save does not record an invoice void', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'noaudit', name: 'No Audit', kind: 'personal', email: 'noaudit@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'noaudit');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'nad', clientId: 'noaudit', items: [{ id: 'nai', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'no-audit', clientId: 'noaudit', disputeId: 'nad', itemId: 'nai', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const before = (await owner('GET', '/api/audit')).body.filter(a => a.action === 'invoice.void').length;
    const next = await owner('GET', '/api/workspace');
    const inv = next.body.data.invoices.find(i => i.id === 'no-audit');
    inv.status = 'void';
    inv.voidReason = 'wrong client';
    next.body.data.clients.find(c => c.id === 'noaudit').pricePerResult = 80;
    const denied = await owner('PUT', '/api/workspace', { baseVersion: next.body.version, data: next.body.data });
    assert.strictEqual(denied.status, 409);
    assert.strictEqual((await owner('GET', '/api/audit')).body.filter(a => a.action === 'invoice.void').length, before);
    const saved = await owner('GET', '/api/workspace');
    assert.strictEqual(saved.body.data.invoices.find(i => i.id === 'no-audit').status, 'issued');
  });
});

test('a postmark before signing is refused and an early postmark needs the owner', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'earlymark', name: 'Early Mark', kind: 'personal', email: 'earlymark@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'earlymark');
    const beforeSign = await owner('POST', '/api/clients/earlymark/cancel', { method: 'mail', receivedAt: '2020-01-08', postmarkAt: '2020-01-05' });
    assert.strictEqual(beforeSign.status, 400);
    assert.match(beforeSign.body.error, /before the contract was signed/);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-earlymark@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const staffEarly = await staff('POST', '/api/clients/earlymark/cancel', { method: 'mail', receivedAt: '2020-01-20', postmarkAt: '2020-01-09' });
    assert.strictEqual(staffEarly.status, 200);
    assert.strictEqual(staffEarly.body.postmarkReview, 'postmark_needs_owner_review');
    assert.strictEqual(staffEarly.body.timely, null);
    const dropped = await staff('POST', '/api/clients/earlymark/cancel', { method: 'mail', receivedAt: '2020-01-20' });
    assert.strictEqual(dropped.status, 409);
    await addClient(owner, { id: 'closemark', name: 'Close Mark', kind: 'personal', email: 'closemark@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'closemark');
    const close = await staff('POST', '/api/clients/closemark/cancel', { method: 'mail', receivedAt: '2020-01-16', postmarkAt: '2020-01-06' });
    assert.strictEqual(close.status, 200);
    assert.ok(!(await owner('GET', '/api/audit')).body.some(a => a.action === 'client.cancel.postmark' && a.detail.includes('earlymark')));
    await addClient(owner, { id: 'ownermark', name: 'Owner Mark', kind: 'personal', email: 'ownermark@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'ownermark');
    const ownerEarly = await owner('POST', '/api/clients/ownermark/cancel', { method: 'mail', receivedAt: '2020-01-20', postmarkAt: '2020-01-09' });
    assert.strictEqual(ownerEarly.status, 200);
    assert.ok((await owner('GET', '/api/audit')).body.some(a => a.action === 'client.cancel.postmark' && a.detail.includes('ownermark')));
  });
});

test('the invoice status count reads the file and does not write it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-count-'));
  const file = path.join(dir, 'ledger-db.json');
  const body = JSON.stringify({ workspace: { invoices: [
    { id: 'a', status: 'draft' }, { id: 'b', status: 'issued' }, { id: 'c', status: 'paid' }, { id: 'd', status: 'void' },
    { id: 'e', status: 'open' }, { id: 'f' }, { id: 'g', status: 'refunded' },
    { id: 'h', status: 'issued', payToken: 'same-token' }, { id: 'i', status: 'issued', payToken: 'same-token' }
  ] } });
  fs.writeFileSync(file, body);
  const script = path.join(import.meta.dirname, '../server/count-invoice-statuses.js');
  const ran = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  assert.strictEqual(ran.status, 0, ran.stderr);
  const out = JSON.parse(ran.stdout);
  assert.strictEqual(out.outside, 3);
  assert.strictEqual(out.counts.open, 1);
  assert.strictEqual(out.counts['(missing)'], 1);
  assert.strictEqual(out.counts.refunded, 1);
  assert.strictEqual(out.duplicatePayTokens.sharedTokens, 1);
  assert.strictEqual(out.duplicatePayTokens.invoices, 2);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a workspace save cannot set or change the self-signup flag', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'paper', name: 'Paper Held', kind: 'personal', email: 'paperheld@guard.test', status: 'active', signupSource: 'self', onboarding: {} });
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.clients.find(c => c.id === 'paper').signupSource, false);
    const paper = built.db.data.workspace.clients.find(c => c.id === 'paper');
    paper.onboarding = { disclosureSignedAt: '2020-01-06', disclosureAcknowledgedAt: '2020-01-06T15:00:00.000Z', contractSignedAt: '2020-01-06', contractSignedAtTs: '2020-01-06T16:00:00.000Z', cancellationWindowEndsAt: '2020-01-09', cancellationWindowEndsAtTs: '2020-01-10T04:59:59.999Z' };
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-paperheld@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await owner('GET', '/api/workspace');
    before.body.data.clients.find(c => c.id === 'paper').signupSource = 'self';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: before.body.data })).status, 200);
    const ownerFlip = await owner('GET', '/api/workspace');
    ownerFlip.body.data.clients.find(c => c.id === 'paper').signupSource = 'self';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: ownerFlip.body.version, data: ownerFlip.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.clients.find(c => c.id === 'paper').signupSource, false);
    const scan = await staff('POST', '/api/clients/paper/scan-text', { text: 'A credit report' });
    assert.strictEqual(scan.status, 409);
    assert.match(scan.body.error, /On hold/);
    const attack = await owner('GET', '/api/workspace');
    attack.body.data.clients.find(c => c.id === 'paper').signupSource = 'self';
    attack.body.data.disputes = [{ id: 'pd', clientId: 'paper', items: [{ id: 'pi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    attack.body.data.invoices = [{ id: 'paper-new', clientId: 'paper', disputeId: 'pd', itemId: 'pi', description: 'Deletion', amount: 50, status: 'issued', payToken: 'paper-attack-token', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    usePayLink(attack.body.data);
    const denied = await staff('PUT', '/api/workspace', { baseVersion: attack.body.version, data: attack.body.data });
    assert.strictEqual(denied.status, 409);
    assert.strictEqual((await owner('GET', '/pay/paper-attack-token')).status, 404);
    const real = built.db.data.workspace.clients.find(c => c.id === 'paper');
    real.signupSource = 'self';
    const unmark = await owner('GET', '/api/workspace');
    delete unmark.body.data.clients.find(c => c.id === 'paper').signupSource;
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: unmark.body.version, data: unmark.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.clients.find(c => c.id === 'paper').signupSource, 'self');
  });
});

test('a staff postmark more than 10 days early is recorded for owner review', async () => {
  await withOwner(async ({ built, owner, live }) => {
    const deadline = cancellationWindow('2020-01-06T16:00:00.000Z').deadlineDateEt;
    await addClient(owner, { id: 'review', name: 'Review Bill', kind: 'personal', email: 'review@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'review');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'rd', clientId: 'review', items: [{ id: 'ri', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }, { id: 'rp', creditor: 'South Bank', bureau: 'Experian', result: 'deleted', bureauResultAt: '2020-06-02' }] }];
    g.body.data.invoices = [
      { id: 'review-issued', clientId: 'review', disputeId: 'rd', itemId: 'ri', description: 'Open', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01', payToken: 'review-pay' },
      { id: 'review-paid', clientId: 'review', disputeId: 'rd', itemId: 'rp', description: 'Paid', amount: 50, status: 'paid', paidAt: '2020-06-03', issuedAt: '2020-06-02', serviceCompletedAt: '2020-06-02' }
    ];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const issuedToken = (await owner('GET', '/api/workspace')).body.data.invoices.find(i => i.id === 'review-issued').payToken;
    assert.notStrictEqual(issuedToken, 'review-pay');
    usePayLink(built.db.data.workspace);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-review@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const filed = await staff('POST', '/api/clients/review/cancel', { method: 'mail', receivedAt: '2020-12-02', postmarkAt: deadline });
    assert.strictEqual(filed.status, 200);
    assert.strictEqual(filed.body.timely, null);
    assert.strictEqual(filed.body.refundTask, false);
    assert.strictEqual(filed.body.postmarkReview, 'postmark_needs_owner_review');
    const held = await owner('GET', '/api/workspace');
    const client = held.body.data.clients.find(c => c.id === 'review');
    assert.strictEqual(client.status, 'cancelled');
    assert.strictEqual(client.onboarding.cancellationPostmarkAt, deadline);
    assert.strictEqual(client.onboarding.cancellationTimely, null);
    assert.strictEqual(held.body.data.invoices.find(i => i.id === 'review-issued').status, 'issued');
    assert.ok(!held.body.data.tasks.some(t => t.clientId === 'review' && /Refund/.test(t.title || '')));
    const reviewTask = held.body.data.tasks.find(t => t.clientId === 'review' && t.kind === 'postmark_needs_owner_review');
    assert.ok(reviewTask);
    assert.strictEqual(reviewTask.done, false);
    const extra = await owner('GET', '/api/workspace');
    extra.body.data.invoices.push({ id: 'review-new', clientId: 'review', disputeId: 'rd', itemId: 'ri', description: 'Again', amount: 50, status: 'issued', issuedAt: '2020-06-04', serviceCompletedAt: '2020-06-04' });
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: extra.body.version, data: extra.body.data })).status, 409);
    const pay = await owner('GET', '/pay/' + issuedToken);
    assert.strictEqual(pay.status, 409);
    assert.match(pay.body, /can’t be paid online yet/);
    const staffReview = await staff('POST', '/api/clients/review/cancel/postmark-review', { decision: 'confirm' });
    assert.strictEqual(staffReview.status, 403);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.clients.find(c => c.id === 'review').onboarding.postmarkReview, 'postmark_needs_owner_review');
    const rejected = await owner('POST', '/api/clients/review/cancel/postmark-review', { decision: 'reject' });
    assert.strictEqual(rejected.status, 200);
    assert.strictEqual(rejected.body.timely, false);
    assert.strictEqual(rejected.body.refundTask, false);
    const afterReject = await owner('GET', '/api/workspace');
    assert.strictEqual(afterReject.body.data.tasks.find(t => t.clientId === 'review' && t.kind === 'postmark_needs_owner_review').done, true);
    assert.strictEqual(afterReject.body.data.invoices.find(i => i.id === 'review-issued').status, 'issued');
    assert.ok((await owner('GET', '/api/audit')).body.some(a => a.action === 'client.cancel.postmark_review' && a.detail.includes('reject')));
    const noReason = await owner('POST', '/api/clients/review/cancel/timeliness', {});
    assert.strictEqual(noReason.status, 400);
    const staffFix = await staff('POST', '/api/clients/review/cancel/timeliness', { reason: 'The postmark was in the window.' });
    assert.strictEqual(staffFix.status, 403);
    const corrected = await owner('POST', '/api/clients/review/cancel/timeliness', { reason: 'The postmark was in the window.' });
    assert.strictEqual(corrected.status, 200);
    assert.strictEqual(corrected.body.timely, true);
    assert.strictEqual(corrected.body.refundTask, true);
    const settled = await owner('GET', '/api/workspace');
    assert.strictEqual(settled.body.data.invoices.find(i => i.id === 'review-issued').status, 'void');
    assert.strictEqual(settled.body.data.invoices.find(i => i.id === 'review-paid').status, 'paid');
    assert.ok(settled.body.data.tasks.some(t => t.clientId === 'review' && /Refund/.test(t.title) && /paid/.test(t.title)));
    assert.ok((await owner('GET', '/api/audit')).body.some(a => a.action === 'client.cancel.timeliness' && /postmark was in the window/.test(a.detail)));
    await addClient(owner, { id: 'confirm', name: 'Confirm Bill', kind: 'personal', email: 'confirm@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'confirm');
    const cg = await owner('GET', '/api/workspace');
    cg.body.data.disputes.push({ id: 'cd', clientId: 'confirm', items: [{ id: 'ci', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] });
    cg.body.data.invoices.push({ id: 'confirm-issued', clientId: 'confirm', disputeId: 'cd', itemId: 'ci', description: 'Open', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: cg.body.version, data: cg.body.data })).status, 200);
    const pending = await staff('POST', '/api/clients/confirm/cancel', { method: 'mail', receivedAt: '2020-12-02', postmarkAt: deadline });
    assert.strictEqual(pending.status, 200);
    assert.strictEqual(pending.body.postmarkReview, 'postmark_needs_owner_review');
    const confirmed = await owner('POST', '/api/clients/confirm/cancel/postmark-review', { decision: 'confirm' });
    assert.strictEqual(confirmed.status, 200);
    assert.strictEqual(confirmed.body.timely, true);
    const confirmedWs = await owner('GET', '/api/workspace');
    assert.strictEqual(confirmedWs.body.data.invoices.find(i => i.id === 'confirm-issued').status, 'void');
    assert.strictEqual(confirmedWs.body.data.invoices.find(i => i.id === 'confirm-issued').voidReason, 'timely CROA cancellation');
    assert.ok((await owner('GET', '/api/audit')).body.some(a => a.action === 'client.cancel.postmark_review' && a.detail.includes('confirm')));
  });
});

test('a paid invoice locks the service date, due date and notes', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'paidnote', name: 'Paid Note', kind: 'personal', email: 'paidnote@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'paidnote');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'pnd', clientId: 'paidnote', items: [{ id: 'pni', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'paid-note', clientId: 'paidnote', disputeId: 'pnd', itemId: 'pni', description: 'Deletion', amount: 50, status: 'paid', paidAt: '2020-06-03', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01', dueAt: '2020-06-08', notes: 'Original note' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-paidnote@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const edited = await owner('GET', '/api/workspace');
    const inv = edited.body.data.invoices.find(i => i.id === 'paid-note');
    inv.serviceCompletedAt = '2020-06-15';
    inv.dueAt = '2020-07-01';
    inv.notes = 'Rewritten';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: edited.body.version, data: edited.body.data });
    assert.strictEqual(denied.status, 409);
    assert.match(denied.body.error, /locked once it is paid/);
    const ownerEdit = await owner('GET', '/api/workspace');
    ownerEdit.body.data.invoices.find(i => i.id === 'paid-note').notes = 'Owner rewrite';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: ownerEdit.body.version, data: ownerEdit.body.data })).status, 409);
    const saved = await owner('GET', '/api/workspace');
    const still = saved.body.data.invoices.find(i => i.id === 'paid-note');
    assert.strictEqual(still.serviceCompletedAt, '2020-06-01');
    assert.strictEqual(still.dueAt, '2020-06-08');
    assert.strictEqual(still.notes, 'Original note');
  });
});

test('an issued invoice locks every field except paying or an owner void', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'fieldlock', name: 'Field Lock', kind: 'personal', email: 'fieldlock@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'fieldlock');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'fld', clientId: 'fieldlock', items: [{ id: 'fli', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'field-1', clientId: 'fieldlock', disputeId: 'fld', itemId: 'fli', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01', payToken: 'client-token', number: '1001' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const saved = await owner('GET', '/api/workspace');
    const stored = saved.body.data.invoices.find(i => i.id === 'field-1');
    assert.notStrictEqual(stored.payToken, 'client-token');
    assert.ok(stored.payToken.length >= 43);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-fieldlock@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const edited = await owner('GET', '/api/workspace');
    const inv = edited.body.data.invoices.find(i => i.id === 'field-1');
    inv.serviceCompletedAt = '2020-06-15';
    inv.payToken = 'replaced-token';
    inv.number = '1002';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: edited.body.version, data: edited.body.data });
    assert.strictEqual(denied.status, 409);
    assert.match(denied.body.error, /locked once it is issued/);
    const dated = await owner('GET', '/api/workspace');
    dated.body.data.invoices.find(i => i.id === 'field-1').paidAt = '2020-06-20';
    const filled = await owner('PUT', '/api/workspace', { baseVersion: dated.body.version, data: dated.body.data });
    assert.strictEqual(filled.status, 200);
    assert.ok(!filled.body.data.invoices.find(i => i.id === 'field-1').paidAt);
    const paying = await owner('GET', '/api/workspace');
    const mark = paying.body.data.invoices.find(i => i.id === 'field-1');
    mark.status = 'paid';
    mark.paidAt = '1999-01-01';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: paying.body.version, data: paying.body.data })).status, 200);
    const paid = (await owner('GET', '/api/workspace')).body.data.invoices.find(i => i.id === 'field-1');
    assert.strictEqual(paid.status, 'paid');
    assert.notStrictEqual(paid.paidAt, '1999-01-01');
    assert.strictEqual(paid.payToken, stored.payToken);
    const legacy = await owner('GET', '/api/workspace');
    const keptPaid = legacy.body.data.invoices.find(i => i.id === 'field-1').paidAt;
    legacy.body.data.invoices.find(i => i.id === 'field-1').paidAt = '';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: legacy.body.version, data: legacy.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.invoices.find(i => i.id === 'field-1').paidAt, keptPaid);
  });
});

test('a voided invoice cannot be deleted and its notes and reason stay', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'voidnote', name: 'Void Note', kind: 'personal', email: 'voidnote@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'voidnote');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'vnd', clientId: 'voidnote', items: [{ id: 'vni', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'void-note', clientId: 'voidnote', disputeId: 'vnd', itemId: 'vni', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01', notes: 'Keep this note', dueAt: '2020-06-08', number: '2002' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const voiding = await owner('GET', '/api/workspace');
    const invoice = voiding.body.data.invoices.find(i => i.id === 'void-note');
    const token = invoice.payToken;
    invoice.status = 'void';
    invoice.voidReason = 'entered twice';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: voiding.body.version, data: voiding.body.data })).status, 200);
    const notes = await owner('GET', '/api/workspace');
    notes.body.data.invoices.find(i => i.id === 'void-note').notes = 'Changed';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: notes.body.version, data: notes.body.data })).status, 409);
    const removed = await owner('GET', '/api/workspace');
    delete removed.body.data.invoices.find(i => i.id === 'void-note').notes;
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: removed.body.version, data: removed.body.data })).status, 409);
    const other = await owner('GET', '/api/workspace');
    const row = other.body.data.invoices.find(i => i.id === 'void-note');
    row.payToken = 'other-token';
    row.number = '9';
    row.dueAt = '2020-07-01';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: other.body.version, data: other.body.data })).status, 409);
    const dropped = await owner('GET', '/api/workspace');
    dropped.body.data.invoices = dropped.body.data.invoices.filter(i => i.id !== 'void-note');
    const deleted = await owner('PUT', '/api/workspace', { baseVersion: dropped.body.version, data: dropped.body.data });
    assert.strictEqual(deleted.status, 409);
    assert.match(deleted.body.error, /cannot be deleted/);
    const reason = await owner('GET', '/api/workspace');
    reason.body.data.invoices.find(i => i.id === 'void-note').voidReason = 'a different reason';
    const reasonDenied = await owner('PUT', '/api/workspace', { baseVersion: reason.body.version, data: reason.body.data });
    assert.strictEqual(reasonDenied.status, 409);
    assert.match(reasonDenied.body.error, /void reason cannot be changed/);
    const saved = (await owner('GET', '/api/workspace')).body.data.invoices.find(i => i.id === 'void-note');
    assert.strictEqual(saved.notes, 'Keep this note');
    assert.strictEqual(saved.voidReason, 'entered twice');
    assert.strictEqual(saved.payToken, token);
    assert.strictEqual(saved.number, '2002');
    assert.strictEqual(saved.dueAt, '2020-06-08');
  });
});

test('a shared pay token cannot open or pay either invoice', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'x1', name: 'Client One', kind: 'personal', email: 'x1@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    await addClient(owner, { id: 'x2', name: 'Client Two', kind: 'personal', email: 'x2@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'x1');
    seedSignedClient(built.db.data.workspace, 'x2');
    usePayLink(built.db.data.workspace);
    built.db.data.workspace.invoices = [
      { id: 'x1-bill', clientId: 'x1', description: 'One', amount: 50, status: 'issued', payToken: 'shared-token', serviceCompletedAt: '2020-06-01', issuedAt: '2020-06-01' },
      { id: 'x2-bill', clientId: 'x2', description: 'Two', amount: 50, status: 'issued', payToken: 'shared-token', serviceCompletedAt: '2020-06-01', issuedAt: '2020-06-01' }
    ];
    const page = await owner('GET', '/pay/shared-token');
    assert.strictEqual(page.status, 409);
    assert.match(page.body, /cannot be used/);
    assert.notStrictEqual(page.headers.get('location'), 'https://pay.example/checkout');
    const done = await owner('GET', '/pay/shared-token/done');
    assert.strictEqual(done.status, 404);
    const rows = built.db.data.workspace.invoices;
    assert.strictEqual(rows.find(i => i.id === 'x1-bill').status, 'issued');
    assert.strictEqual(rows.find(i => i.id === 'x2-bill').status, 'issued');
  });
});

test('one electronic signature keeps a personal client on the server hold', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'onesig', name: 'One Sig', kind: 'personal', email: 'onesig@guard.test', status: 'active', onboarding: {} });
    const client = built.db.data.workspace.clients.find(c => c.id === 'onesig');
    client.onboarding = { disclosureSignedAt: '2020-01-06', contractSignedAt: '2020-01-06', contractSignedAtTs: '2020-01-06T16:00:00.000Z', cancellationWindowEndsAt: '2020-01-09', cancellationWindowEndsAtTs: '2020-01-10T04:59:59.999Z' };
    built.db.data.workspace.signatures = [{ id: 'onesig-d', clientId: 'onesig', doc: 'disclosure', at: '2020-01-06T15:00:00.000Z' }];
    usePayLink(built.db.data.workspace);
    built.db.data.workspace.invoices = [{ id: 'onesig-bill', clientId: 'onesig', description: 'Old invoice', amount: 40, status: 'issued', payToken: 'onesig-token', serviceCompletedAt: '2020-06-01', issuedAt: '2020-06-01' }];
    const pay = await owner('GET', '/pay/onesig-token');
    assert.strictEqual(pay.status, 409);
    assert.match(pay.body, /can’t be paid online yet/);
    const scan = await owner('POST', '/api/clients/onesig/scan-text', { text: 'A credit report' });
    assert.strictEqual(scan.status, 409);
  });
});

test('a self-signup that matches an existing client is flagged and not merged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-dup-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'dup-key-not-a-secret-0000', selfSignupEnabled: true, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } });
  const live = listen(built.app);
  const owner = live.client();
  const anon = live.client();
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner-dup@guard.test', password: 'owner password 1' })).status, 200);
    await addClient(owner, { id: 'existing', name: 'Existing Client', kind: 'personal', email: 'Dup@Guard.test', status: 'active', onboarding: {} });
    const signup = await anon('POST', '/api/signup', { firstName: 'New', lastName: 'Person', email: 'dup@guard.test', password: 'signup password 1', acceptAccountTerms: true, state: 'NJ', njResident: true });
    assert.strictEqual(signup.status, 200);
    assert.deepStrictEqual(signup.body, { ok: true, message: 'Check your email for the next step. If this address can be used, a message is on its way.' });
    assert.ok(!JSON.stringify(signup.body).includes('existing'));
    const ws = await owner('GET', '/api/workspace');
    const matches = ws.body.data.clients.filter(c => String(c.email || '').toLowerCase() === 'dup@guard.test');
    assert.strictEqual(matches.length, 2);
    const created = matches.find(c => c.id !== 'existing');
    assert.strictEqual(created.possible_duplicate, 'existing');
    assert.strictEqual(created.signupSource, 'self');
    assert.strictEqual(ws.body.data.clients.find(c => c.id === 'existing').name, 'Existing Client');
    const task = ws.body.data.tasks.find(t => t.kind === 'possible_duplicate' && t.clientId === created.id);
    assert.ok(task);
    assert.strictEqual(task.matchedClientId, 'existing');
    assert.strictEqual(task.done, false);
    const scan = await owner('POST', '/api/clients/' + created.id + '/scan-text', { text: 'A credit report' });
    assert.strictEqual(scan.status, 409);
    built.db.data.users.push({ id: 'mixed-user', name: 'Mixed', email: 'Mixed@Guard.test', role: 'client', clientId: 'existing', password: 'x', sessionEpoch: 1, createdAt: new Date().toISOString(), disabled: false });
    const same = await anon('POST', '/api/signup', { firstName: 'Other', lastName: 'Person', email: 'mixed@guard.test', password: 'signup password 1', acceptAccountTerms: true, state: 'NJ', njResident: true });
    assert.deepStrictEqual(same.body, signup.body);
    const afterUser = (await owner('GET', '/api/workspace')).body.data.clients.filter(c => String(c.email || '').toLowerCase() === 'mixed@guard.test');
    assert.strictEqual(afterUser.length, 0);
  } finally {
    live.server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a new or draft invoice cannot keep a client paid date or a fake payment', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'paywhen', name: 'Pay When', kind: 'personal', email: 'paywhen@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'paywhen');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'pwd', clientId: 'paywhen', items: [
      { id: 'pwi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' },
      { id: 'pwj', creditor: 'South Bank', bureau: 'Experian', result: 'deleted', bureauResultAt: '2020-06-02' }
    ] }];
    g.body.data.invoices = [{ id: 'paid-new', clientId: 'paywhen', disputeId: 'pwd', itemId: 'pwi', description: 'Deletion', amount: 50, status: 'paid', paidAt: '2020-01-01', serviceCompletedAt: '2020-06-01', issuedAt: '2020-06-01', transId: 'fake', paidVia: 'Authorize.net' }];
    const created = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const row = created.body.data.invoices.find(i => i.id === 'paid-new');
    assert.notStrictEqual(row.paidAt, '2020-01-01');
    assert.match(row.paidAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!row.transId);
    assert.ok(!row.paidVia);
    const draft = await owner('GET', '/api/workspace');
    draft.body.data.invoices.push({ id: 'draft-pay', clientId: 'paywhen', description: 'Later', amount: 50, status: 'draft', paidAt: '2020-01-01', transId: 'fake', paidVia: 'Authorize.net' });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: draft.body.version, data: draft.body.data })).status, 200);
    const issued = await owner('GET', '/api/workspace');
    const draftRow = issued.body.data.invoices.find(i => i.id === 'draft-pay');
    draftRow.status = 'issued';
    draftRow.paidAt = '2020-01-01';
    draftRow.transId = 'fake';
    draftRow.paidVia = 'Authorize.net';
    draftRow.disputeId = 'pwd';
    draftRow.itemId = 'pwj';
    draftRow.serviceCompletedAt = '2020-06-02';
    draftRow.issuedAt = '2020-06-02';
    const flipped = await owner('PUT', '/api/workspace', { baseVersion: issued.body.version, data: issued.body.data });
    assert.strictEqual(flipped.status, 200, JSON.stringify(flipped.body));
    const issuedRow = flipped.body.data.invoices.find(i => i.id === 'draft-pay');
    assert.ok(!issuedRow.paidAt);
    assert.ok(!issuedRow.transId);
    assert.ok(!issuedRow.paidVia);
    const future = await owner('GET', '/api/workspace');
    future.body.data.invoices.push({ id: 'future-paid', clientId: 'paywhen', disputeId: 'pwd', itemId: 'pwi', description: 'Too soon', amount: 50, status: 'paid', paidAt: '2020-01-01', serviceCompletedAt: '2999-01-01', issuedAt: '2999-01-01', transId: 'fake', paidVia: 'Authorize.net' });
    const refused = await owner('PUT', '/api/workspace', { baseVersion: future.body.version, data: future.body.data });
    assert.strictEqual(refused.status, 409);
    assert.match(refused.body.error, /before the service was completed/);
  });
});

test('a payment at 8:44 PM ET records that Eastern date', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-et-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'et-key-not-a-secret-00000', selfSignupEnabled: false, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' }, now: () => new Date('2026-11-19T01:44:00.000Z') });
  const live = listen(built.app);
  const owner = live.client();
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner-et@guard.test', password: 'owner password 1' })).status, 200);
    await addClient(owner, { id: 'etpay', name: 'ET Pay', kind: 'personal', email: 'etpay@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'etpay');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'etd', clientId: 'etpay', items: [{ id: 'eti', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'et-1', clientId: 'etpay', disputeId: 'etd', itemId: 'eti', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const next = await owner('GET', '/api/workspace');
    const inv = next.body.data.invoices.find(i => i.id === 'et-1');
    inv.status = 'paid';
    inv.paidAt = '2020-01-01';
    const paid = await owner('PUT', '/api/workspace', { baseVersion: next.body.version, data: next.body.data });
    assert.strictEqual(paid.status, 200, JSON.stringify(paid.body));
    assert.strictEqual(paid.body.data.invoices.find(i => i.id === 'et-1').paidAt, '2026-11-18');
  } finally {
    live.server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the save response returns the server pay token and a later save can use it', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'tokenback', name: 'Token Back', kind: 'personal', email: 'tokenback@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'tokenback');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'tbd', clientId: 'tokenback', items: [{ id: 'tbi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [{ id: 'tok-1', clientId: 'tokenback', disputeId: 'tbd', itemId: 'tbi', description: 'Deletion', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01', payToken: 'browser-token' }];
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(saved.status, 200);
    const token = saved.body.data.invoices.find(i => i.id === 'tok-1').payToken;
    assert.notStrictEqual(token, 'browser-token');
    assert.ok(token.length >= 43);
    const again = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: saved.body.data });
    assert.strictEqual(again.status, 200, JSON.stringify(again.body));
    assert.strictEqual(again.body.data.invoices.find(i => i.id === 'tok-1').payToken, token);
    g.body.data.invoices[0].payToken = 'browser-token';
    const stale = await owner('PUT', '/api/workspace', { baseVersion: again.body.version, data: g.body.data });
    assert.strictEqual(stale.status, 409);
    assert.match(stale.body.error, /locked once it is issued/);
    assert.ok(!stale.body.data);
  });
});

test('the browser adopts the saved workspace and does not mint pay tokens', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const views = fs.readFileSync(path.join(import.meta.dirname, '../js/views.js'), 'utf8');
  const flush = appJs.slice(appJs.indexOf('async flush()'), appJs.indexOf('async poll()'));
  assert.match(flush, /Store\.applyServerSave\(r\.data, sent/);
  assert.match(flush, /finishApplied\(applied, false\)/);
  assert.match(flush, /e\.body && e\.body\.data/);
  assert.match(flush, /await this\.reload\(\)/);
  assert.doesNotMatch(appJs, /Billing\.payToken\(\)/);
  const voidAct = appJs.slice(appJs.indexOf("'invoice-void'"), appJs.indexOf("'invoice-print'"));
  assert.match(voidAct, /find\(x => x && x\.id === id\)/);
  assert.match(voidAct, /logVoidIfSaved/);
  assert.doesNotMatch(voidAct, /Voided invoice/);
  assert.match(flush, /status === 400 \|\| e\.status === 403/);
  assert.match(flush, /!e\.status \|\| e\.status >= 500/);
  assert.match(appJs, /redrawDeferred/);
  assert.match(appJs, /pointerDown/);
  assert.match(appJs, /dataset\.item/);
  assert.match(views, /data-item=/);
  const note = appJs.slice(appJs.indexOf("'aq-note'"), appJs.indexOf("'aq-print'"));
  assert.match(note, /deals \|\| \[\]\)\.find\(row => row\.id === dealId\)/);
  const payout = appJs.slice(appJs.indexOf("'ref-payout'"), appJs.indexOf("'seq-stop'"));
  assert.match(payout, /no longer in the workspace/);
  assert.match(appJs, /Store\.get\.dispute\(disputeId\)/);
  assert.match(appJs, /vendorAccounts\.find\(x => x\.id === vid\)/);
  assert.match(views, /ledgerUser && root\.ledgerUser\.role === 'owner'/);
});

test('staff cannot close or delete a server review task', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'tasklock', name: 'Task Lock', kind: 'personal', email: 'tasklock@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'tasklock');
    const deadline = cancellationWindow('2020-01-06T16:00:00.000Z').deadlineDateEt;
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-tasklock@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    assert.strictEqual((await staff('POST', '/api/clients/tasklock/cancel', { method: 'mail', receivedAt: '2020-12-02', postmarkAt: deadline })).status, 200);
    built.db.data.workspace.tasks.push({ id: 'dup-task', clientId: 'tasklock', title: 'Review a possible duplicate signup', due: '2020-06-01', done: false, createdAt: '2020-06-01T00:00:00.000Z', kind: 'possible_duplicate', matchedClientId: 'other' });
    const marked = await owner('GET', '/api/workspace');
    const postmark = marked.body.data.tasks.find(t => t.kind === 'postmark_needs_owner_review');
    postmark.done = true;
    postmark.title = 'Closed by staff';
    const dup = marked.body.data.tasks.find(t => t.id === 'dup-task');
    dup.done = true;
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: marked.body.version, data: marked.body.data })).status, 200);
    const kept = await owner('GET', '/api/workspace');
    assert.strictEqual(kept.body.data.tasks.find(t => t.kind === 'postmark_needs_owner_review').done, false);
    assert.match(kept.body.data.tasks.find(t => t.kind === 'postmark_needs_owner_review').title, /Review the postmark/);
    assert.strictEqual(kept.body.data.tasks.find(t => t.id === 'dup-task').done, false);
    const dropped = await owner('GET', '/api/workspace');
    dropped.body.data.tasks = dropped.body.data.tasks.filter(t => t.kind !== 'postmark_needs_owner_review' && t.id !== 'dup-task');
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: dropped.body.version, data: dropped.body.data })).status, 200);
    const still = await owner('GET', '/api/workspace');
    assert.ok(still.body.data.tasks.some(t => t.kind === 'postmark_needs_owner_review' && t.done === false));
    assert.ok(still.body.data.tasks.some(t => t.id === 'dup-task' && t.done === false));
    assert.strictEqual((await staff('POST', '/api/tasks/dup-task/close', {})).status, 403);
    assert.strictEqual((await owner('POST', '/api/tasks/dup-task/close', {})).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.tasks.find(t => t.id === 'dup-task').done, true);
    const review = await owner('POST', '/api/clients/tasklock/cancel/postmark-review', { decision: 'reject' });
    assert.strictEqual(review.status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.tasks.find(t => t.kind === 'postmark_needs_owner_review').done, true);
  });
});

test('the invoice migration preview reads and does not write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-preview-'));
  const file = path.join(dir, 'ledger-db.json');
  const body = JSON.stringify({ workspace: { invoices: [
    { id: 'open-1', clientId: 'c', status: 'open', serviceCompletedAt: '2020-06-01' },
    { id: 'blank-1', clientId: 'c' },
    { id: 'dup-a', status: 'issued', payToken: 'shared' },
    { id: 'dup-b', status: 'issued', payToken: 'shared' }
  ] } });
  fs.writeFileSync(file, body);
  const script = path.join(import.meta.dirname, '../server/preview-invoice-migration.js');
  const ran = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  assert.strictEqual(ran.status, 0, ran.stderr);
  const out = JSON.parse(ran.stdout);
  assert.strictEqual(out.writes, false);
  assert.strictEqual(out.outside, 2);
  assert.strictEqual(out.duplicatePayTokens, 1);
  assert.strictEqual(out.statusPlan.find(row => row.id === 'open-1').suggested, 'issued');
  assert.strictEqual(out.statusPlan.find(row => row.id === 'blank-1').suggested, 'draft');
  assert.ok(!ran.stdout.includes('shared'));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  fs.rmSync(dir, { recursive: true, force: true });
});

function loadStore() {
  const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Set, Map, Error, URLSearchParams, crypto, navigator: {} };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.top = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  const root = path.join(import.meta.dirname, '../js');
  for (const f of ['law.js', 'store.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  ctx.Store.load();
  return ctx.Store;
}

test('an edit made while a save is in flight is kept and the server pay token is merged', () => {
  const Store = loadStore();
  const state = Store.state;
  state.clients = [{ id: 'c', name: 'Ada', zip: '' }];
  state.invoices = [{ id: 'i', clientId: 'c', description: 'Deletion', status: 'issued', payToken: 'browser-token' }];
  const sent = JSON.parse(JSON.stringify(state));
  state.clients[0].zip = '08002';
  const server = JSON.parse(JSON.stringify(sent));
  server.invoices[0].payToken = 'server-token';
  server.invoices[0].paidAt = '2026-11-18';
  server.clients[0].zip = '';
  const applied = Store.applyServerSave(server, sent);
  assert.strictEqual(applied.requeue, true);
  assert.strictEqual(applied.conflict, false);
  assert.strictEqual(state.clients[0].zip, '08002');
  assert.strictEqual(state.invoices[0].payToken, 'server-token');
  assert.strictEqual(state.invoices[0].paidAt, '2026-11-18');
  assert.strictEqual(state.invoices[0].status, 'issued');
});

test('a void dialog looks up the live invoice and logs the void only after it is saved', () => {
  const Store = loadStore();
  const state = Store.state;
  state.clients = [{ id: 'c', name: 'Ada' }];
  state.invoices = [{ id: 'i', clientId: 'c', description: 'Deletion', status: 'issued' }];
  const stale = { id: 'i', clientId: 'c', description: 'Deletion', status: 'issued' };
  stale.status = 'void';
  stale.voidReason = 'typed into a detached invoice';
  assert.strictEqual(state.invoices[0].status, 'issued');
  assert.strictEqual(Store.logVoidIfSaved('i', 'Deletion', 'c'), false);
  assert.strictEqual((state.activity || []).filter(row => /Voided invoice/.test(row.text)).length, 0);
  const live = state.invoices.find(row => row.id === 'i');
  live.status = 'void';
  live.voidReason = 'duplicate charge';
  assert.strictEqual(Store.logVoidIfSaved('i', 'Deletion', 'c'), true);
  assert.strictEqual(state.activity[0].text, 'Voided invoice: Deletion');
  assert.strictEqual(Store.logVoidIfSaved('i', 'Deletion', 'c'), false);
});

test('a save does not redraw while a dialog is open or an input is focused', () => {
  const Store = loadStore();
  assert.strictEqual(Store.shouldRedrawAfterSave({ overlay: false, activeTag: 'DIV' }), true);
  assert.strictEqual(Store.shouldRedrawAfterSave({ overlay: true, activeTag: 'DIV' }), false);
  assert.strictEqual(Store.shouldRedrawAfterSave({ overlay: false, activeTag: 'INPUT' }), false);
  assert.strictEqual(Store.shouldRedrawAfterSave({ overlay: false, activeTag: 'TEXTAREA' }), false);
});

test('a duplicate signup at 8:55 PM ET on Nov 18 is due that Eastern date', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-et-days-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'et-days-key-not-a-secret', selfSignupEnabled: true, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' }, now: () => new Date('2026-11-19T01:55:00.000Z') });
  const live = listen(built.app);
  const owner = live.client();
  const anon = live.client();
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner-etdays@guard.test', password: 'owner password 1' })).status, 200);
    await addClient(owner, { id: 'existing-et', name: 'Existing ET', kind: 'personal', email: 'dup-et@guard.test', status: 'active', onboarding: {} });
    const signup = await anon('POST', '/api/signup', { firstName: 'New', lastName: 'Person', email: 'dup-et@guard.test', password: 'signup password 1', acceptAccountTerms: true, state: 'NJ', njResident: true });
    assert.strictEqual(signup.status, 200);
    const task = (await owner('GET', '/api/workspace')).body.data.tasks.find(row => row.kind === 'possible_duplicate');
    assert.strictEqual(task.due, '2026-11-18');
    await addClient(owner, { id: 'biz-et', name: 'ET Biz', kind: 'business', email: 'biz-et@guard.test', status: 'active', business: { legalName: 'ET Biz LLC' } });
    assert.strictEqual((await owner('POST', '/api/coach/biz-et/start', {})).status, 200);
    const plan = (await owner('GET', '/api/workspace')).body.data.clients.find(row => row.id === 'biz-et').creditPlan;
    assert.strictEqual(plan.startedAt, '2026-11-18');
    const ws = await owner('GET', '/api/workspace');
    ws.body.data.disputes = [{ id: 'd-et', clientId: 'biz-et', type: 'cra_611', round: 1, recipient: 'Experian', status: 'sent', sentAt: '2026-11-01', dueAt: '2026-11-18', outcome: null, items: [] }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: ws.body.version, data: ws.body.data })).status, 200);
    const chat = await owner('POST', '/api/assistant/staff', { clientId: 'biz-et', history: [{ role: 'user', content: 'What is due?' }] });
    assert.strictEqual(chat.status, 200, JSON.stringify(chat.body));
    const due = (chat.body.deadlines || []).find(row => row.dueAt === '2026-11-18');
    assert.ok(due);
    assert.strictEqual(due.daysLeft, 0);
    assert.strictEqual(due.overdue, false);
  } finally {
    live.server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a staff save cannot clone a server review task by changing its kind', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'kindlock', name: 'Kind Lock', kind: 'personal', email: 'kindlock@guard.test', status: 'active', onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'kindlock');
    const deadline = cancellationWindow('2020-01-06T16:00:00.000Z').deadlineDateEt;
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-kindlock@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    assert.strictEqual((await staff('POST', '/api/clients/kindlock/cancel', { method: 'mail', receivedAt: '2020-12-02', postmarkAt: deadline })).status, 200);
    built.db.data.workspace.tasks.push({ id: 'dup-kind', clientId: 'kindlock', title: 'Review a possible duplicate signup', due: '2020-06-01', done: false, createdAt: '2020-06-01T00:00:00.000Z', kind: 'possible_duplicate', matchedClientId: 'other' });
    const marked = await owner('GET', '/api/workspace');
    const postmark = marked.body.data.tasks.find(t => t.kind === 'postmark_needs_owner_review');
    const postmarkId = postmark.id;
    postmark.kind = 'task';
    postmark.done = true;
    postmark.title = 'Closed by staff';
    const dup = marked.body.data.tasks.find(t => t.id === 'dup-kind');
    dup.kind = 'task';
    dup.done = true;
    dup.title = 'Merged already';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: marked.body.version, data: marked.body.data })).status, 200);
    const kept = await owner('GET', '/api/workspace');
    const postmarks = kept.body.data.tasks.filter(t => t.id === postmarkId);
    assert.strictEqual(postmarks.length, 1);
    assert.strictEqual(postmarks[0].kind, 'postmark_needs_owner_review');
    assert.strictEqual(postmarks[0].done, false);
    assert.match(postmarks[0].title, /Review the postmark/);
    const dups = kept.body.data.tasks.filter(t => t.id === 'dup-kind');
    assert.strictEqual(dups.length, 1);
    assert.strictEqual(dups[0].kind, 'possible_duplicate');
    assert.strictEqual(dups[0].done, false);
    assert.match(dups[0].title, /possible duplicate/);
  });
});

test('a coach reminder at 8:55 PM ET uses that Eastern date', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-et-remind-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'et-remind-key-not-a-secret', selfSignupEnabled: false, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' }, now: () => new Date('2026-11-19T01:55:00.000Z') });
  const live = listen(built.app);
  const owner = live.client();
  const out = [];
  setTransport(async message => { out.push(message); });
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner-remind@guard.test', password: 'owner password 1' })).status, 200);
    await addClient(owner, { id: 'biz-remind', name: 'Remind Biz', kind: 'business', email: 'remind@guard.test', status: 'active', business: { legalName: 'Remind Biz LLC' } });
    const client = built.db.data.workspace.clients.find(row => row.id === 'biz-remind');
    client.creditPlan = { startedAt: '2026-11-18', done: {} };
    built.db.data.users.push({ id: 'remind-user', name: 'Remind Biz', email: 'remind@guard.test', role: 'client', clientId: 'biz-remind', password: 'x', sessionEpoch: 1, createdAt: '2026-11-18T00:00:00.000Z', disabled: false });
    await built.auth.deadlineSweep();
    await new Promise(resolve => setTimeout(resolve, 50));
    const mail = out.find(message => message.to === 'remind@guard.test');
    assert.ok(mail, JSON.stringify(out.map(message => message.to)));
    assert.match(mail.text, /due 2026-11-18/);
  } finally {
    setTransport(null);
    live.server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a same-record conflict keeps the server copy and replays the other edit', () => {
  const Store = loadStore();
  const state = Store.state;
  state.clients = [{ id: 'c', name: 'Ada', city: '' }];
  state.tasks = [];
  const sent = JSON.parse(JSON.stringify(state));
  state.clients[0].city = 'Staff City';
  state.tasks.push({ id: 'staff-task', title: 'Staff follow-up', done: false });
  const server = JSON.parse(JSON.stringify(sent));
  server.clients[0].city = 'Cherry Hill';
  const applied = Store.applyServerSave(server, sent);
  assert.strictEqual(applied.conflict, true);
  assert.strictEqual(applied.requeue, true);
  assert.ok(applied.dropped.some(label => /Ada/.test(label)));
  assert.strictEqual(state.clients[0].city, 'Cherry Hill');
  assert.ok(state.tasks.some(task => task.id === 'staff-task'));
});

test('another user\'s city and dispute recipient survive a staff re-save after 409', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada-race@guard.test', status: 'lead', city: '' });
    built.db.data.workspace.disputes = built.db.data.workspace.disputes || [];
    built.db.data.workspace.disputes.push({ id: 'race-dispute', clientId: 'ada', type: 'cra_611', round: 1, recipient: 'Experian', status: 'draft', items: [] });
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-race@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    const ownerCopy = await owner('GET', '/api/workspace');
    ownerCopy.body.data.clients.find(row => row.id === 'ada').city = 'Cherry Hill';
    ownerCopy.body.data.disputes.find(row => row.id === 'race-dispute').recipient = 'Equifax';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: ownerCopy.body.version, data: ownerCopy.body.data })).status, 200);
    const conflict = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(conflict.status, 409);
    assert.ok(conflict.body.data);
    const Store = loadStore();
    Store.adopt(sent);
    const quiet = Store.applyServerSave(conflict.body.data, sent);
    assert.strictEqual(quiet.requeue, false);
    assert.strictEqual(Store.state.clients.find(row => row.id === 'ada').city, 'Cherry Hill');
    assert.strictEqual(Store.state.disputes.find(row => row.id === 'race-dispute').recipient, 'Equifax');
    Store.adopt(sent);
    Store.state.tasks = Store.state.tasks || [];
    Store.state.tasks.push({ id: 'staff-task', title: 'Staff follow-up', done: false, clientId: 'ada' });
    const replay = Store.applyServerSave(conflict.body.data, sent);
    assert.strictEqual(replay.requeue, true);
    assert.strictEqual(replay.conflict, false);
    const saved = await staff('PUT', '/api/workspace', { baseVersion: conflict.body.version, data: Store.state });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.clients.find(row => row.id === 'ada').city, 'Cherry Hill');
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'race-dispute').recipient, 'Equifax');
    assert.ok(after.body.data.tasks.some(row => row.id === 'staff-task'));
  });
});

test('a refused edit from the failed save is replayed from the last server copy', () => {
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', city: '' }], tasks: [] });
  const state = Store.state;
  state.clients.find(row => row.id === 'c').city = 'Newark';
  const sent = JSON.parse(JSON.stringify(state));
  const server = JSON.parse(JSON.stringify(state));
  server.clients.find(row => row.id === 'c').city = '';
  server.tasks.push({ id: 'owner-task', title: 'Owner task', done: false });
  const applied = Store.applyServerSave(server, sent);
  assert.strictEqual(applied.requeue, true);
  assert.strictEqual(applied.dropped.length, 0);
  assert.strictEqual(state.clients.find(row => row.id === 'c').city, 'Newark');
  assert.ok(state.tasks.some(row => row.id === 'owner-task'));
});

test('mid-save edits to automations, violations and imports are replayed', () => {
  const Store = loadStore();
  const state = Store.state;
  state.automations = [{ id: 'rule-1', on: true }];
  state.automationLog = { 'rule-1': { at: '2026-11-18', via: 'email' } };
  state.violations = { k1: { status: 'new' } };
  state.pendingImports = [{ id: 'imp-1', clientId: 'c', docName: 'a.pdf' }];
  state.addressBook = [{ id: 'addr-1', name: 'North Bank', address: '1 Main' }];
  const sent = JSON.parse(JSON.stringify(state));
  state.automations[0].on = false;
  state.automationLog['rule-1'].via = 'queued';
  state.violations.k1.status = 'closed';
  state.pendingImports.push({ id: 'imp-2', clientId: 'c', docName: 'b.pdf' });
  state.addressBook[0].address = '2 Main';
  const server = JSON.parse(JSON.stringify(sent));
  server.clients = [{ id: 'other', name: 'Other', city: 'Cherry Hill' }];
  const applied = Store.applyServerSave(server, sent);
  assert.strictEqual(applied.requeue, true);
  assert.strictEqual(state.automations.find(row => row.id === 'rule-1').on, false);
  assert.strictEqual(state.automationLog['rule-1'].via, 'queued');
  assert.strictEqual(state.violations.k1.status, 'closed');
  assert.ok(state.pendingImports.some(row => row.id === 'imp-2'));
  assert.strictEqual(state.addressBook.find(row => row.id === 'addr-1').address, '2 Main');
  assert.strictEqual(state.clients.find(row => row.id === 'other').city, 'Cherry Hill');
});

test('client notes from a refused save survive, including typing during that save', () => {
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', notes: '' }] });
  const server = JSON.parse(JSON.stringify(Store.state));
  Store.state.clients.find(row => row.id === 'c').notes = 'Called the client';
  const sent = JSON.parse(JSON.stringify(Store.state));
  Store.state.clients.find(row => row.id === 'c').notes = 'Called the client. Left a message.';
  const applied = Store.applyServerSave(server, sent);
  assert.strictEqual(applied.dropped.length, 0);
  assert.strictEqual(applied.requeue, true);
  assert.strictEqual(Store.state.clients.find(row => row.id === 'c').notes, 'Called the client. Left a message.');
});

test('a server pay token is not a conflict and a void typed during create is kept', () => {
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada' }], invoices: [] });
  Store.state.invoices.push({ id: 'inv', clientId: 'c', description: 'Deletion', amount: 50, status: 'issued' });
  const sent = JSON.parse(JSON.stringify(Store.state));
  Store.state.invoices[0].status = 'void';
  Store.state.invoices[0].voidReason = 'duplicate';
  const server = JSON.parse(JSON.stringify(sent));
  server.invoices[0].payToken = 'server-token';
  server.invoices[0].paidAt = '2026-11-18';
  server.invoices[0].transId = 'txn';
  server.invoices[0].paidVia = 'Authorize.net';
  const applied = Store.applyServerSave(server, sent);
  assert.strictEqual(applied.conflict, false);
  assert.strictEqual(applied.dropped.length, 0);
  const inv = Store.state.invoices.find(row => row.id === 'inv');
  assert.strictEqual(inv.status, 'void');
  assert.strictEqual(inv.voidReason, 'duplicate');
  assert.strictEqual(inv.payToken, 'server-token');
  assert.strictEqual(inv.paidAt, '2026-11-18');
});

test('a refused invoice is named and the other notes in the batch are kept', () => {
  const Store = loadStore();
  const clients = [];
  for (let n = 0; n < 8; n++) clients.push({ id: 'c' + n, name: 'Client ' + n, notes: '' });
  Store.adopt({ version: 2, clients, invoices: [{ id: 'bad', clientId: 'c0', description: 'Fee', amount: 50, status: 'issued' }] });
  const server = JSON.parse(JSON.stringify(Store.state));
  Store.state.clients.forEach(row => { row.notes = 'Note for ' + row.name; });
  Store.state.invoices[0].description = 'Changed fee';
  const sent = JSON.parse(JSON.stringify(Store.state));
  const applied = Store.applyServerSave(server, sent, { refused: ['invoices/bad'] });
  assert.strictEqual(applied.requeue, true);
  assert.strictEqual(applied.dropped.length, 0);
  assert.ok(applied.refused.some(label => /bad|Fee/.test(label)));
  for (let n = 0; n < 8; n++) assert.strictEqual(Store.state.clients.find(row => row.id === 'c' + n).notes, 'Note for Client ' + n);
  assert.strictEqual(Store.state.invoices.find(row => row.id === 'bad').description, 'Fee');
});

test('deleting an enrolled client names that client and does not retry the delete', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'enrolled', name: 'Enrolled Client', kind: 'personal', email: 'enrolled@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'enrolled');
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-del@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.clients = sent.clients.filter(row => row.id !== 'enrolled');
    sent.activity = sent.activity || [];
    sent.activity.unshift({ id: 'act-del', at: '2026-11-18T12:00:00.000Z', text: 'Deleted client Enrolled Client', clientId: 'enrolled' });
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 403);
    assert.ok(Array.isArray(denied.body.refused));
    assert.ok(denied.body.refused.some(row => row.key === 'clients' && row.id === 'enrolled' && row.reason && row.field === ''));
    const Store = loadStore();
    Store.adopt(before.body.data);
    Store.state.clients = Store.state.clients.filter(row => row.id !== 'enrolled');
    Store.state.activity = Store.state.activity || [];
    Store.state.activity.unshift({ id: 'act-del', at: '2026-11-18T12:00:00.000Z', text: 'Deleted client Enrolled Client', clientId: 'enrolled' });
    const applied = Store.applyServerSave(before.body.data, sent, { rejected: true, refused: denied.body.refused });
    assert.ok(Store.state.clients.some(row => row.id === 'enrolled'));
    assert.ok(applied.refused.some(label => /enrollment|enrolled|owner/i.test(label)));
    assert.strictEqual(applied.dropped.length, 0);
    assert.ok(Store.state.activity.some(row => row.id === 'act-del'));
    const fallback = loadStore();
    fallback.adopt(before.body.data);
    fallback.state.clients = fallback.state.clients.filter(row => row.id !== 'enrolled');
    fallback.state.activity = fallback.state.activity || [];
    fallback.state.activity.unshift({ id: 'act-del', at: '2026-11-18T12:00:00.000Z', text: 'Deleted client Enrolled Client', clientId: 'enrolled' });
    const droppedAll = fallback.applyServerSave(before.body.data, sent, { rejected: true });
    assert.ok(fallback.state.clients.some(row => row.id === 'enrolled'));
    assert.ok(!fallback.state.activity.some(row => row.id === 'act-del'));
    assert.strictEqual(droppedAll.requeue, false);
  });
});

test('a saved field the server puts back is cleared and named', () => {
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', notes: '', onboarding: { disclosureSignedAt: null } }] });
  const server = JSON.parse(JSON.stringify(Store.state));
  Store.state.clients.find(row => row.id === 'c').onboarding.disclosureSignedAt = '2026-11-01';
  const sent = JSON.parse(JSON.stringify(Store.state));
  const applied = Store.applyServerSave(server, sent, { accepted: true });
  assert.strictEqual(applied.requeue, false);
  assert.strictEqual(Store.unsaved, false);
  assert.ok(applied.reverted.some(label => /Ada/.test(label)));
  assert.strictEqual(Store.state.clients.find(row => row.id === 'c').onboarding.disclosureSignedAt, null);
});

test('logout waits for the save and leaving warns while changes are unsaved', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const storeJs = fs.readFileSync(path.join(import.meta.dirname, '../js/store.js'), 'utf8');
  const logout = appJs.slice(appJs.indexOf("'logout'"), appJs.indexOf("'invite-staff'"));
  assert.match(logout, /await Remote\.flushNow\(\)/);
  assert.match(logout, /Store\.unsaved/);
  assert.match(appJs, /beforeunload/);
  assert.match(appJs, /noteRefusals/);
  assert.match(appJs, /refusalCounts/);
  assert.match(appJs, /Not allowed: /);
  assert.match(appJs, /Not saved: /);
  assert.match(appJs, /Someone else updated /);
  assert.doesNotMatch(storeJs, /msg\.indexOf|error\.indexOf|indexOf\(id\)/);
  assert.doesNotMatch(appJs, /indexOf\(id\)/);
});

test('a client type change is named once and the dispute edit still saves', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada-type@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'ada');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.disputes.push({ id: 'd1', clientId: 'ada', recipient: 'Equifax', status: 'draft', items: [] });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-type@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.clients.find(row => row.id === 'ada').kind = 'business';
    sent.disputes.find(row => row.id === 'd1').recipient = 'Experian';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 403);
    const hit = denied.body.refused.find(row => row.id === 'ada');
    assert.strictEqual(hit.key, 'clients');
    assert.strictEqual(hit.field, 'kind');
    assert.match(hit.reason, /client type/);
    const Store = loadStore();
    Store.adopt(before.body.data);
    Store.state.clients.find(row => row.id === 'ada').kind = 'business';
    Store.state.disputes.find(row => row.id === 'd1').recipient = 'Experian';
    const applied = Store.applyServerSave(before.body.data, sent, { rejected: true, refused: denied.body.refused });
    assert.strictEqual(Store.state.clients.find(row => row.id === 'ada').kind, 'personal');
    assert.strictEqual(Store.state.disputes.find(row => row.id === 'd1').recipient, 'Experian');
    assert.strictEqual(applied.dropped.length, 0);
    assert.strictEqual(applied.refused.length, 1);
    assert.match(applied.refused[0], /Not allowed|client type/);
    assert.strictEqual(applied.requeue, true);
    const replay = JSON.parse(JSON.stringify(before.body.data));
    replay.disputes.find(row => row.id === 'd1').recipient = 'Experian';
    const saved = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: replay });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const settled = Store.applyServerSave(saved.body.data, JSON.parse(JSON.stringify(Store.state)), { accepted: true });
    assert.strictEqual(settled.requeue, false);
    assert.strictEqual(Store.unsaved, false);
    assert.strictEqual(Store.state.clients.filter(row => row.id === 'ada').length, 1);
    assert.strictEqual(saved.body.data.clients.find(row => row.id === 'ada').kind, 'personal');
    assert.strictEqual(saved.body.data.disputes.find(row => row.id === 'd1').recipient, 'Experian');
  });
});

test('an enrolled-client delete drops only that client and a duplicate business client is named once', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'ada', name: 'Ada Person', kind: 'personal', email: 'ada-dup@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'ada');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = g.body.data.disputes || [];
    g.body.data.disputes.push({ id: 'd-keep', clientId: 'ada', recipient: 'Equifax', status: 'draft', items: [] });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-dup@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.clients = sent.clients.filter(row => row.id !== 'ada');
    sent.disputes.find(row => row.id === 'd-keep').recipient = 'Experian';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 403);
    assert.ok(denied.body.refused.some(row => row.key === 'clients' && row.id === 'ada' && /enrollment/.test(row.reason)));
    const Store = loadStore();
    Store.adopt(before.body.data);
    Store.state.clients = Store.state.clients.filter(row => row.id !== 'ada');
    Store.state.disputes.find(row => row.id === 'd-keep').recipient = 'Experian';
    const applied = Store.applyServerSave(before.body.data, sent, { rejected: true, refused: denied.body.refused });
    assert.ok(Store.state.clients.some(row => row.id === 'ada'));
    assert.strictEqual(Store.state.disputes.find(row => row.id === 'd-keep').recipient, 'Experian');
    assert.strictEqual(applied.refused.length, 1);
    assert.strictEqual(applied.dropped.length, 0);
    const replay = JSON.parse(JSON.stringify(before.body.data));
    replay.disputes.find(row => row.id === 'd-keep').recipient = 'Experian';
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: replay })).status, 200);
    const dup = JSON.parse(JSON.stringify(replay));
    dup.clients.push({ id: 'biz-ada', name: 'Ada Person', kind: 'business', email: 'biz-ada@guard.test', status: 'active' });
    dup.disputes.find(row => row.id === 'd-keep').notes = 'kept';
    const blocked = await staff('PUT', '/api/workspace', { baseVersion: (await staff('GET', '/api/workspace')).body.version, data: dup });
    assert.strictEqual(blocked.status, 409);
    const named = blocked.body.refused.find(row => row.id === 'biz-ada');
    assert.strictEqual(named.key, 'clients');
    assert.strictEqual(named.field, 'name');
    assert.match(named.reason, /already exists/);
    const latest = await staff('GET', '/api/workspace');
    const again = loadStore();
    again.adopt(latest.body.data);
    again.state.clients.push({ id: 'biz-ada', name: 'Ada Person', kind: 'business', email: 'biz-ada@guard.test', status: 'active' });
    again.state.disputes.find(row => row.id === 'd-keep').notes = 'kept';
    const second = again.applyServerSave(latest.body.data, dup, { rejected: true, refused: blocked.body.refused });
    assert.ok(!again.state.clients.some(row => row.id === 'biz-ada'));
    assert.strictEqual(again.state.disputes.find(row => row.id === 'd-keep').notes, 'kept');
    assert.strictEqual(second.refused.length, 1);
    assert.strictEqual(second.dropped.length, 0);
    const without = JSON.parse(JSON.stringify(latest.body.data));
    without.disputes.find(row => row.id === 'd-keep').notes = 'kept';
    const settled = await staff('PUT', '/api/workspace', { baseVersion: latest.body.version, data: without });
    assert.strictEqual(settled.status, 200, JSON.stringify(settled.body));
    assert.ok(!settled.body.data.clients.some(row => row.id === 'biz-ada'));
    assert.strictEqual(settled.body.data.disputes.find(row => row.id === 'd-keep').notes, 'kept');
  });
});

test('the first address book entry stays a list and a wrong shape is refused', async () => {
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada' }] });
  const sent = JSON.parse(JSON.stringify(Store.state));
  Store.state.addressBook = [{ name: 'North Bank', address: '1 Main', category: 'bureau' }];
  const server = JSON.parse(JSON.stringify(sent));
  delete server.addressBook;
  const applied = Store.applyServerSave(server, sent);
  assert.ok(Array.isArray(Store.state.addressBook));
  assert.strictEqual(Store.state.addressBook.length, 1);
  assert.strictEqual(Store.state.addressBook[0].name, 'North Bank');
  assert.strictEqual(applied.requeue, true);
  await withOwner(async ({ owner }) => {
    const g = await owner('GET', '/api/workspace');
    g.body.data.addressBook = { bad: { name: 'North Bank' } };
    const denied = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(denied.status, 400);
    const hit = denied.body.refused.find(row => row.key === 'addressBook');
    assert.ok(hit);
    assert.match(hit.reason, /list/);
    g.body.data.addressBook = [{ name: 'North Bank', address: '1 Main' }];
    const ok = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(Array.isArray(ok.body.data.addressBook));
  });
});

test('a lock refusal drops only that invoice and the other invoice edits still save', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'pay', name: 'Pay Client', kind: 'personal', email: 'pay-lock@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'pay');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [
      { id: 'pd1', clientId: 'pay', items: [{ id: 'pi1', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] },
      { id: 'pd2', clientId: 'pay', items: [{ id: 'pi2', creditor: 'South Bank', bureau: 'Experian', result: 'deleted', bureauResultAt: '2020-06-01' }] }
    ];
    g.body.data.invoices = [
      { id: 'locked', clientId: 'pay', disputeId: 'pd1', itemId: 'pi1', description: 'Fee', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' },
      { id: 'draft', clientId: 'pay', description: 'Draft', amount: 50, status: 'draft', notes: '' },
      { id: 'payme', clientId: 'pay', disputeId: 'pd2', itemId: 'pi2', description: 'Second', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }
    ];
    const seeded = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(seeded.status, 200, JSON.stringify(seeded.body));
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-lock@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.invoices.find(row => row.id === 'locked').description = 'Changed fee';
    sent.invoices.find(row => row.id === 'draft').notes = 'draft note';
    sent.invoices.find(row => row.id === 'payme').status = 'paid';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409);
    assert.strictEqual(denied.body.refused.length, 1);
    assert.strictEqual(denied.body.refused[0].key, 'invoices');
    assert.strictEqual(denied.body.refused[0].id, 'locked');
    assert.strictEqual(denied.body.refused[0].field, 'description');
    const Store = loadStore();
    Store.adopt(before.body.data);
    Store.state.invoices.find(row => row.id === 'locked').description = 'Changed fee';
    Store.state.invoices.find(row => row.id === 'draft').notes = 'draft note';
    Store.state.invoices.find(row => row.id === 'payme').status = 'paid';
    const applied = Store.applyServerSave(before.body.data, sent, { rejected: true, refused: denied.body.refused });
    assert.strictEqual(Store.state.invoices.find(row => row.id === 'locked').description, 'Fee');
    assert.strictEqual(Store.state.invoices.find(row => row.id === 'draft').notes, 'draft note');
    assert.strictEqual(Store.state.invoices.find(row => row.id === 'payme').status, 'paid');
    assert.strictEqual(applied.dropped.length, 0);
    assert.match(applied.refused[0], /locked once it is issued/);
    const replay = JSON.parse(JSON.stringify(before.body.data));
    replay.invoices.find(row => row.id === 'draft').notes = 'draft note';
    replay.invoices.find(row => row.id === 'payme').status = 'paid';
    const saved = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: replay });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.data.invoices.find(row => row.id === 'locked').description, 'Fee');
    assert.strictEqual(saved.body.data.invoices.find(row => row.id === 'draft').notes, 'draft note');
    assert.strictEqual(saved.body.data.invoices.find(row => row.id === 'payme').status, 'paid');
  });
});

test('server-filled onboarding on a new client is not someone else updated', () => {
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [] });
  Store.state.clients.push({ id: 'new', name: 'Ada', email: 'ada@new.test', notes: 'typed during create' });
  const sent = JSON.parse(JSON.stringify(Store.state));
  const server = JSON.parse(JSON.stringify(sent));
  server.clients[0].onboarding = { disclosureSignedAt: null, contractSignedAt: null, cancellationWindowEndsAt: null };
  const applied = Store.applyServerSave(server, sent, { accepted: true });
  assert.strictEqual(applied.requeue, false);
  assert.strictEqual(applied.conflict, false);
  assert.strictEqual(applied.dropped.length, 0);
  assert.strictEqual(applied.reverted.length, 0);
  assert.strictEqual(Store.unsaved, false);
  assert.strictEqual(Store.state.clients.length, 1);
  assert.strictEqual(Store.state.clients[0].notes, 'typed during create');
  assert.strictEqual(Store.state.clients[0].onboarding.disclosureSignedAt, null);
  Store.state.clients[0].notes = 'typed after';
  const later = JSON.parse(JSON.stringify(Store.state));
  const filled = JSON.parse(JSON.stringify(server));
  const kept = Store.applyServerSave(filled, sent, { accepted: true });
  assert.strictEqual(Store.state.clients.length, 1);
  assert.strictEqual(Store.state.clients[0].notes, 'typed after');
  assert.strictEqual(kept.dropped.length, 0);
  assert.strictEqual(kept.requeue, true);
  void later;
});

test('a reload keeps dirty records and polling resumes', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const reload = appJs.slice(appJs.indexOf('async reload()'), appJs.indexOf('push()'));
  const poll = appJs.slice(appJs.indexOf('async poll()'), appJs.indexOf('async function offerSavedPassword'));
  assert.match(reload, /flushNow/);
  assert.match(reload, /applyServerSave/);
  assert.match(reload, /ensurePoll/);
  assert.match(poll, /applyServerSave/);
  assert.match(appJs, /sessionStorage/);
  assert.match(appJs, /ledger-dirty/);
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', notes: '', city: '' }] });
  Store.state.clients[0].notes = 'still typing';
  const local = JSON.parse(JSON.stringify(Store.state));
  const server = JSON.parse(JSON.stringify(Store.state));
  server.clients[0].notes = '';
  server.clients[0].city = 'Cherry Hill';
  Store.applyServerSave(server, local);
  assert.strictEqual(Store.state.clients[0].notes, 'still typing');
  assert.strictEqual(Store.state.clients[0].city, 'Cherry Hill');
  assert.strictEqual(Store.unsaved, true);
});

test('different fields of the same record merge and the same field conflicts', () => {
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', city: '', notes: '' }] });
  const sent = JSON.parse(JSON.stringify(Store.state));
  Store.state.clients[0].notes = 'staff note';
  const server = JSON.parse(JSON.stringify(sent));
  server.clients[0].city = 'Cherry Hill';
  const applied = Store.applyServerSave(server, sent);
  assert.strictEqual(applied.conflict, false);
  assert.strictEqual(applied.dropped.length, 0);
  assert.strictEqual(Store.state.clients[0].city, 'Cherry Hill');
  assert.strictEqual(Store.state.clients[0].notes, 'staff note');
  assert.strictEqual(applied.requeue, true);
  const clash = loadStore();
  clash.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', city: '', notes: '' }] });
  const clashSent = JSON.parse(JSON.stringify(clash.state));
  clash.state.clients[0].city = 'Staff City';
  const other = JSON.parse(JSON.stringify(clashSent));
  other.clients[0].city = 'Cherry Hill';
  const hit = clash.applyServerSave(other, clashSent);
  assert.strictEqual(hit.conflict, true);
  assert.ok(hit.dropped.some(label => /city/.test(label)));
  assert.strictEqual(clash.state.clients[0].city, 'Cherry Hill');
});

test('a delete during a save removes the record and never writes one without an id', async () => {
  const Store = loadStore();
  const lead = { id: 'lead', name: 'Lead Client', kind: 'personal', email: 'lead@guard.test', status: 'lead' };
  Store.adopt({ version: 2, clients: [lead], tasks: [] });
  const sent = JSON.parse(JSON.stringify(Store.state));
  Store.state.clients = Store.state.clients.filter(row => row.id !== 'lead');
  const server = JSON.parse(JSON.stringify(sent));
  server.clients[0].onboarding = { disclosureSignedAt: null };
  server.clients[0].signupSource = false;
  const accepted = Store.applyServerSave(server, sent, { accepted: true });
  assert.ok(!Store.state.clients.some(row => row.id === 'lead'));
  assert.ok(Store.state.clients.every(row => row && row.id));
  assert.ok(!Store.state.clients.some(row => row && !row.name));
  assert.strictEqual(accepted.requeue, true);
  const conflicted = loadStore();
  conflicted.adopt({ version: 2, clients: [lead], tasks: [] });
  const sentConflict = JSON.parse(JSON.stringify(conflicted.state));
  conflicted.state.clients = [];
  const owner = JSON.parse(JSON.stringify(sentConflict));
  owner.clients[0].city = 'Cherry Hill';
  owner.clients[0].onboarding = { disclosureSignedAt: null };
  const kept = conflicted.applyServerSave(owner, sentConflict);
  assert.strictEqual(conflicted.state.clients.length, 1);
  assert.strictEqual(conflicted.state.clients[0].id, 'lead');
  assert.strictEqual(conflicted.state.clients[0].name, 'Lead Client');
  assert.strictEqual(conflicted.state.clients[0].city, 'Cherry Hill');
  assert.ok(kept.dropped.some(label => /Lead|lead/.test(label)));
  assert.strictEqual(kept.requeue, false);
  const quiet = loadStore();
  quiet.adopt({ version: 2, clients: [lead], tasks: [] });
  const sentQuiet = JSON.parse(JSON.stringify(quiet.state));
  quiet.state.clients = [];
  const same = JSON.parse(JSON.stringify(sentQuiet));
  same.tasks = [{ id: 'owner-task', title: 'Owner task', done: false }];
  const removed = quiet.applyServerSave(same, sentQuiet);
  assert.ok(!quiet.state.clients.some(row => row.id === 'lead'));
  assert.ok(quiet.state.clients.every(row => !row || row.id));
  assert.ok(quiet.state.tasks.some(row => row.id === 'owner-task'));
  assert.strictEqual(removed.dropped.length, 0);
  assert.strictEqual(removed.requeue, true);
  const edited = loadStore();
  edited.adopt({ version: 2, clients: [lead], tasks: [] });
  const sentEdit = JSON.parse(JSON.stringify(edited.state));
  edited.state.clients[0].notes = 'still editing';
  const gone = JSON.parse(JSON.stringify(sentEdit));
  gone.clients = [];
  const lost = edited.applyServerSave(gone, sentEdit);
  assert.ok(!edited.state.clients.some(row => row.id === 'lead'));
  assert.ok(lost.dropped.some(label => /Lead|lead/.test(label)));
  assert.strictEqual(lost.requeue, false);
  await withOwner(async ({ owner }) => {
    const g = await owner('GET', '/api/workspace');
    g.body.data.clients.push({ name: 'No Id', kind: 'personal', email: 'noid@guard.test', status: 'lead' });
    const denied = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(denied.status, 422);
    const hit = denied.body.refused.find(row => row.key === 'clients' && row.field === 'id');
    assert.ok(hit);
    assert.match(hit.reason, /missing an id/);
    const after = await owner('GET', '/api/workspace');
    assert.ok(!after.body.data.clients.some(row => row && !row.id));
  });
});

test('a refused invoice field the user did not change reverts the whole invoice and the other edit still saves', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'pay', name: 'Pay Client', kind: 'personal', email: 'pay-item@guard.test', status: 'active', pricePerResult: 50, onboarding: {} });
    seedSignedClient(built.db.data.workspace, 'pay');
    const g = await owner('GET', '/api/workspace');
    g.body.data.invoices = [{ id: 'bare', clientId: 'pay', description: 'Draft', amount: 50, status: 'draft' }];
    const seeded = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(seeded.status, 200, JSON.stringify(seeded.body));
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-item@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.invoices.find(row => row.id === 'bare').status = 'paid';
    sent.tasks = sent.tasks || [];
    sent.tasks.push({ id: 'good-task', title: 'Follow up', done: false, clientId: 'pay' });
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409);
    const fields = denied.body.refused.filter(row => row.key === 'invoices' && row.id === 'bare').map(row => row.field);
    assert.ok(fields.includes('itemId'));
    assert.ok(fields.includes('status'));
    const Store = loadStore();
    Store.adopt(before.body.data);
    Store.state.invoices.find(row => row.id === 'bare').status = 'paid';
    Store.state.tasks = Store.state.tasks || [];
    Store.state.tasks.push({ id: 'good-task', title: 'Follow up', done: false, clientId: 'pay' });
    const applied = Store.applyServerSave(before.body.data, sent, { rejected: true, refused: denied.body.refused });
    assert.strictEqual(Store.state.invoices.find(row => row.id === 'bare').status, 'draft');
    assert.ok(Store.state.tasks.some(row => row.id === 'good-task'));
    assert.match(applied.refused.join(' '), /item|deleted item|bureau/i);
    assert.ok(!applied.dropped.some(label => /Someone else/.test(label)));
    Store.revertTokens(applied.refusedTokens);
    assert.strictEqual(Store.state.invoices.find(row => row.id === 'bare').status, 'draft');
    assert.ok(Store.state.tasks.some(row => row.id === 'good-task'));
    const replay = JSON.parse(JSON.stringify(before.body.data));
    replay.tasks = replay.tasks || [];
    replay.tasks.push({ id: 'good-task', title: 'Follow up', done: false, clientId: 'pay' });
    const saved = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: replay });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.data.invoices.find(row => row.id === 'bare').status, 'draft');
    assert.ok(saved.body.data.tasks.some(row => row.id === 'good-task'));
    const issued = await owner('GET', '/api/workspace');
    const locked = issued.body.data.invoices.find(row => row.id === 'bare');
    locked.status = 'issued';
    locked.description = 'Fee';
    locked.notes = '';
    issued.body.data.disputes = [{ id: 'pd', clientId: 'pay', items: [{ id: 'pi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    locked.disputeId = 'pd';
    locked.itemId = 'pi';
    locked.amount = 50;
    locked.serviceCompletedAt = '2020-06-01';
    locked.issuedAt = '2020-06-01';
    const issuedSave = await owner('PUT', '/api/workspace', { baseVersion: issued.body.version, data: issued.body.data });
    assert.strictEqual(issuedSave.status, 200, JSON.stringify(issuedSave.body));
    const next = await staff('GET', '/api/workspace');
    const both = JSON.parse(JSON.stringify(next.body.data));
    const row = both.invoices.find(item => item.id === 'bare');
    row.description = 'Changed fee';
    row.notes = 'staff note';
    const multi = await staff('PUT', '/api/workspace', { baseVersion: next.body.version, data: both });
    assert.strictEqual(multi.status, 409);
    const named = multi.body.refused.filter(item => item.id === 'bare').map(item => item.field);
    assert.ok(named.includes('description'));
    assert.ok(named.includes('notes'));
  });
});

test('the dirty session copy stores only that user\'s dirty records', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const remember = appJs.slice(appJs.indexOf('dirtyStorageKey() {'), appJs.indexOf('restoreDirty() {'));
  const restore = appJs.slice(appJs.indexOf('restoreDirty() {'), appJs.indexOf('async flushNow'));
  const logout = appJs.slice(appJs.indexOf("'logout'"), appJs.indexOf("'invite-staff'"));
  assert.match(remember, /dirtySnapshot/);
  assert.match(remember, /ledger-dirty:/);
  assert.doesNotMatch(remember, /JSON\.stringify\(Store\.state\)/);
  assert.match(restore, /userId !== userId/);
  assert.match(restore, /applyDirtySnapshot/);
  assert.match(logout, /clearDirtyStores/);
  assert.match(appJs, /revertTokens/);
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', email: 'ada@guard.test', notes: '' }, { id: 'd', name: 'Bea', email: 'bea@guard.test', notes: '' }] });
  Store.state.clients.find(row => row.id === 'c').notes = 'only this';
  const snap = Store.dirtySnapshot();
  assert.strictEqual(snap.length, 1);
  assert.strictEqual(snap[0].key, 'clients');
  assert.strictEqual(snap[0].id, 'c');
  assert.ok(!JSON.stringify(snap).includes('bea@guard.test'));
  const fresh = loadStore();
  fresh.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', email: 'ada@guard.test', notes: '' }, { id: 'd', name: 'Bea', email: 'bea@guard.test', notes: '' }] });
  fresh.applyDirtySnapshot(snap);
  assert.strictEqual(fresh.state.clients.find(row => row.id === 'c').notes, 'only this');
  assert.strictEqual(fresh.state.clients.find(row => row.id === 'd').email, 'bea@guard.test');
  fresh.applyDirtySnapshot([{ key: 'clients', id: 'ghost', row: { name: 'No Id' } }]);
  assert.ok(fresh.state.clients.every(row => row.id));
});

test('moving a dispute or letter onto a held client is refused', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-move@guard.test', status: 'active' });
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-move@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'clear');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'move-d', clientId: 'clear', recipient: 'Equifax', status: 'draft', items: [] }];
    g.body.data.letters = [{ id: 'move-l', clientId: 'clear', text: 'Letter', status: 'draft' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-move@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.disputes.find(row => row.id === 'move-d').clientId = 'held';
    sent.letters.find(row => row.id === 'move-l').clientId = 'held';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409);
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.id === 'move-d' && row.field === 'clientId'));
    assert.ok(denied.body.refused.some(row => row.key === 'letters' && row.id === 'move-l' && row.field === 'clientId'));
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'move-d').clientId, 'clear');
    assert.strictEqual(after.body.data.letters.find(row => row.id === 'move-l').clientId, 'clear');
  });
});

test('id-less disputes and violations are refused and a deleted dispute is not restored as a fragment', async () => {
  await withOwner(async ({ owner }) => {
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{}];
    g.body.data.violations = { '': { status: 'new' } };
    const denied = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(denied.status, 422);
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.field === 'id'));
    const again = await owner('GET', '/api/workspace');
    again.body.data.disputes = [];
    again.body.data.violations = { '': { status: 'new' } };
    const violations = await owner('PUT', '/api/workspace', { baseVersion: again.body.version, data: again.body.data });
    assert.strictEqual(violations.status, 422);
    assert.ok(violations.body.refused.some(row => row.key === 'violations' && row.field === 'id'));
    const stored = await owner('GET', '/api/workspace');
    assert.ok(!(stored.body.data.disputes || []).some(row => row && !row.id));
    assert.ok(!stored.body.data.violations || !Object.prototype.hasOwnProperty.call(stored.body.data.violations, ''));
  });
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada' }], disputes: [{ id: 'd', clientId: 'c', recipient: 'Equifax', items: [{ id: 'item', creditor: 'Bank' }] }] });
  const sent = JSON.parse(JSON.stringify(Store.state));
  Store.state.disputes[0].recipient = 'Experian';
  const server = JSON.parse(JSON.stringify(sent));
  server.disputes = [];
  const applied = Store.applyServerSave(server, sent);
  assert.strictEqual(Store.state.disputes.length, 0);
  assert.ok(applied.dropped.some(label => /Equifax|d/.test(label)));
  assert.strictEqual(applied.requeue, false);
});

test('deleting a draft during a save keeps the invoice created at the same time', () => {
  const Store = loadStore();
  Store.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada' }], invoices: [{ id: 'draft', clientId: 'c', description: 'Old', amount: 50, status: 'draft' }] });
  const sent = JSON.parse(JSON.stringify(Store.state));
  Store.state.invoices = [{ id: 'fresh', clientId: 'c', description: 'New', amount: 40, status: 'draft' }];
  const server = JSON.parse(JSON.stringify(sent));
  const applied = Store.applyServerSave(server, sent, { accepted: true });
  assert.ok(!Store.state.invoices.some(row => row.id === 'draft'));
  assert.ok(Store.state.invoices.some(row => row.id === 'fresh' && row.description === 'New'));
  assert.ok(Store.state.invoices.every(row => row.id));
  assert.strictEqual(applied.requeue, true);
  assert.strictEqual(applied.reverted.length, 0);
});

test('a refused invoice is restored whole, and a wrong server shape does not stay dirty', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-inv@guard.test', status: 'active' });
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-inv@guard.test', status: 'active', pricePerResult: 50 });
    seedSignedClient(built.db.data.workspace, 'clear');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'cd', clientId: 'clear', items: [{ id: 'ci', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    g.body.data.invoices = [
      { id: 'held-inv', clientId: 'held', description: 'Draft', amount: 50, status: 'draft' },
      { id: 'locked', clientId: 'clear', disputeId: 'cd', itemId: 'ci', description: 'Fee', notes: '', amount: 50, status: 'issued', issuedAt: '2020-06-01', serviceCompletedAt: '2020-06-01' }
    ];
    const seeded = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(seeded.status, 200, JSON.stringify(seeded.body));
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-heldinv@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const issued = JSON.parse(JSON.stringify(before.body.data));
    issued.invoices.find(row => row.id === 'held-inv').status = 'issued';
    issued.tasks = issued.tasks || [];
    issued.tasks.push({ id: 'keep-task', title: 'Still save this', done: false, clientId: 'clear' });
    const held = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: issued });
    assert.strictEqual(held.status, 409);
    assert.ok(held.body.refused.some(row => row.key === 'invoices' && row.id === 'held-inv'));
    const Store = loadStore();
    Store.adopt(before.body.data);
    Store.state.invoices.find(row => row.id === 'held-inv').status = 'issued';
    Store.state.tasks = Store.state.tasks || [];
    Store.state.tasks.push({ id: 'keep-task', title: 'Still save this', done: false, clientId: 'clear' });
    const applied = Store.applyServerSave(before.body.data, issued, { rejected: true, refused: held.body.refused });
    assert.strictEqual(Store.state.invoices.find(row => row.id === 'held-inv').status, 'draft');
    assert.ok(Store.state.tasks.some(row => row.id === 'keep-task'));
    assert.ok(applied.refused.length);
    const voided = JSON.parse(JSON.stringify(before.body.data));
    const locked = voided.invoices.find(row => row.id === 'locked');
    locked.status = 'void';
    locked.voidReason = 'staff tried';
    const voidDeny = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: voided });
    assert.strictEqual(voidDeny.status, 403);
    const voidStore = loadStore();
    voidStore.adopt(before.body.data);
    const liveLocked = voidStore.state.invoices.find(row => row.id === 'locked');
    liveLocked.status = 'void';
    liveLocked.voidReason = 'staff tried';
    const voidApplied = voidStore.applyServerSave(before.body.data, voided, { rejected: true, refused: voidDeny.body.refused });
    assert.strictEqual(voidStore.state.invoices.find(row => row.id === 'locked').status, 'issued');
    assert.strictEqual(voidApplied.requeue, false);
    const both = JSON.parse(JSON.stringify(before.body.data));
    const row = both.invoices.find(item => item.id === 'locked');
    row.amount = 80;
    row.description = 'Changed fee';
    const multi = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: both });
    assert.strictEqual(multi.status, 409);
    const fields = multi.body.refused.filter(item => item.id === 'locked').map(item => item.field);
    assert.ok(fields.includes('amount'));
    assert.ok(fields.includes('description'));
    const multiStore = loadStore();
    multiStore.adopt(before.body.data);
    const edited = multiStore.state.invoices.find(item => item.id === 'locked');
    edited.amount = 80;
    edited.description = 'Changed fee';
    const multiApplied = multiStore.applyServerSave(before.body.data, both, { rejected: true, refused: multi.body.refused });
    assert.strictEqual(multiStore.state.invoices.find(item => item.id === 'locked').amount, 50);
    assert.strictEqual(multiStore.state.invoices.find(item => item.id === 'locked').description, 'Fee');
    assert.strictEqual(multiApplied.requeue, false);
  });
  const Store = loadStore();
  const server = { version: 2, clients: [{ id: 'c', name: 'Ada', notes: '' }], addressBook: { bad: { name: 'North' } } };
  Store.adopt(server);
  assert.strictEqual(Store.unsaved, false);
  Store.state.addressBook = [{ name: 'North', address: '1 Main' }];
  const applied = Store.applyServerSave(server, JSON.parse(JSON.stringify(Store.state)), { rejected: true, refused: [{ key: 'addressBook', id: '', field: '', reason: 'addressBook must be a list.' }] });
  assert.ok(!Array.isArray(Store.state.addressBook));
  assert.strictEqual(Store.unsaved, false);
  assert.ok(applied.refused.length);
  const filled = loadStore();
  filled.adopt({ version: 2, clients: [{ id: 'c', name: 'Ada', onboarding: { disclosureSignedAt: '2026-11-01' } }] });
  const sent = JSON.parse(JSON.stringify(filled.state));
  const remote = JSON.parse(JSON.stringify(sent));
  remote.clients[0].onboarding = { disclosureSignedAt: '2026-11-01', contractSignedAt: null };
  const quiet = filled.applyServerSave(remote, sent, { accepted: true });
  assert.strictEqual(quiet.reverted.length, 0);
  assert.strictEqual(filled.unsaved, false);
});

test('a refusal is counted per record, and the deploy gate reports a bad shape', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const note = appJs.slice(appJs.indexOf('noteRefusals(tokens)'), appJs.indexOf('afterSave'));
  const flush = appJs.slice(appJs.indexOf('async flush()'), appJs.indexOf('async poll()'));
  assert.match(note, /refusalCounts\.get\(token\)/);
  assert.match(note, /n >= 2/);
  assert.match(flush, /this\.refusalCounts = new Map\(\)/);
  assert.doesNotMatch(flush, /badSaves/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-shape-'));
  const file = path.join(dir, 'ledger-db.json');
  const body = JSON.stringify({ workspace: { invoices: [{ id: 'ok', status: 'draft' }], disputes: [{}], violations: { '': { status: 'new' } }, addressBook: { bad: { name: 'North' } } } });
  fs.writeFileSync(file, body);
  const ran = spawnSync(process.execPath, [path.join(import.meta.dirname, '../server/count-invoice-statuses.js'), file], { encoding: 'utf8' });
  assert.strictEqual(ran.status, 0, ran.stderr);
  const out = JSON.parse(ran.stdout);
  assert.ok(out.shapeErrors.some(row => row.key === 'disputes' && row.id === ''));
  assert.ok(out.shapeErrors.some(row => row.key === 'violations'));
  assert.ok(out.shapeErrors.some(row => row.key === 'addressBook'));
  assert.strictEqual(out.deployGate.ready, false);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  fs.rmSync(dir, { recursive: true, force: true });
});



