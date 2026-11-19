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
import { hashPassword } from '../server/auth.js';
import { cancellationWindow } from '../server/croa-window.js';
import { seedSignedClient } from './seed-croa.js';
import { renderHeldMessage, statutoryDisclosure } from '../server/held-messages.js';

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
    g.body.data.disputes.push({ id: 'bd', clientId: 'bill', sentAt: '2026-06-01', items: [{ id: 'bi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2026-01-08' }] });
    g.body.data.invoices.push({ id: 'draft-1', clientId: 'bill', description: 'Draft', amount: 20, status: 'draft' });
    const draft = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(draft.status, 200, JSON.stringify(draft.body));
    const flipped = await owner('GET', '/api/workspace');
    const inv = flipped.body.data.invoices.find(i => i.id === 'draft-1');
    inv.status = 'issued';
    inv.issuedAt = '2026-06-01';
    inv.serviceCompletedAt = '2026-06-01';
    inv.bureauResultAt = '2026-06-01';
    inv.disputeId = 'bd';
    inv.itemId = 'bi';
    flipped.body.data.disputes.find(d => d.id === 'bd').items[0].bureauResultAt = '2026-06-01';
    const inside = await owner('PUT', '/api/workspace', { baseVersion: flipped.body.version, data: flipped.body.data });
    assert.strictEqual(inside.status, 409, JSON.stringify(inside.body));
    assert.match(inside.body.error, /after the cancellation window/);
    const stamped = draft.body.data.disputes.find(d => d.id === 'bd').items.find(it => it.id === 'bi');
    assert.strictEqual(stamped.serverResultAt, '2026-01-08');
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
    g.body.data.disputes.push({ id: 'dd', clientId: 'dup', sentAt: '2020-06-01', items: [{ id: 'di', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] });
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
    g.body.data.disputes.push({ id: 'ed', clientId: 'edit', sentAt: '2026-06-01', items: [
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
    g.body.data.disputes = [{ id: 'nd', clientId: 'newamt', sentAt: '2020-06-01', items: [{ id: 'ni', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'fd', clientId: 'flipamt', sentAt: '2020-06-01', items: [{ id: 'fi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'pd2', clientId: 'paidamt', sentAt: '2020-06-01', items: [{ id: 'pi2', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes.push({ id: 'pd', clientId: 'price', sentAt: '2020-06-01', items: [{ id: 'pi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] });
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
    g.body.data.disputes = [{ id: 'ld', clientId: 'lock', sentAt: '2020-06-01', items: [{ id: 'li', item: 'Late fee', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'np', clientId: 'noprice', sentAt: '2020-06-01', items: [{ id: 'npi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'td', clientId: 'time', sentAt: '2020-06-01', items: [{ id: 'ti', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'md', clientId: 'nomail', sentAt: '2020-06-01', items: [{ id: 'mi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'vd', clientId: 'voidme', sentAt: '2020-06-01', items: [{ id: 'vi', item: 'Late fee', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'rd', clientId: 'resultday', sentAt: '2099-01-01', items: [{ id: 'ri', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2099-01-01' }] }];
    const future = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(future.status, 200, JSON.stringify(future.body));
    const stamped = future.body.data.disputes.find(d => d.id === 'rd');
    assert.strictEqual(stamped.serverSentAt, todayEt());
    assert.strictEqual(stamped.items[0].serverResultAt, todayEt());
    assert.notStrictEqual(stamped.items[0].serverResultAt, '2099-01-01');
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
    g.body.data.disputes = [{ id: 'md', clientId: 'mix', sentAt: '2020-06-01', items: [
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
    g.body.data.disputes = [{ id: 'sd', clientId: 'stuck', sentAt: '2020-06-01', items: [{ id: 'si', item: 'Late fee', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'td', clientId: 'terminal', sentAt: '2020-06-01', items: [{ id: 'ti', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'pld', clientId: 'paidlock', sentAt: '2020-06-01', items: [{ id: 'pli', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'rld', clientId: 'relock', sentAt: '2020-06-01', items: [{ id: 'rli', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }, { id: 'rlj', creditor: 'South Bank', bureau: 'Experian', result: 'deleted', bureauResultAt: '2020-06-02' }] }];
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
    g.body.data.disputes = [{ id: 'vld', clientId: 'voidlock', sentAt: '2020-06-01', items: [{ id: 'vli', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'nad', clientId: 'noaudit', sentAt: '2020-06-01', items: [{ id: 'nai', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    attack.body.data.disputes = [{ id: 'pd', clientId: 'paper', sentAt: '2020-06-01', items: [{ id: 'pi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'rd', clientId: 'review', sentAt: '2020-06-01', items: [{ id: 'ri', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }, { id: 'rp', creditor: 'South Bank', bureau: 'Experian', result: 'deleted', bureauResultAt: '2020-06-02' }] }];
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
    cg.body.data.disputes.push({ id: 'cd', clientId: 'confirm', sentAt: '2020-06-01', items: [{ id: 'ci', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] });
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
    g.body.data.disputes = [{ id: 'pnd', clientId: 'paidnote', sentAt: '2020-06-01', items: [{ id: 'pni', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'fld', clientId: 'fieldlock', sentAt: '2020-06-01', items: [{ id: 'fli', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'vnd', clientId: 'voidnote', sentAt: '2020-06-01', items: [{ id: 'vni', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'pwd', clientId: 'paywhen', sentAt: '2020-06-01', items: [
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
    g.body.data.disputes = [{ id: 'etd', clientId: 'etpay', sentAt: '2020-06-01', items: [{ id: 'eti', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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
    g.body.data.disputes = [{ id: 'tbd', clientId: 'tokenback', sentAt: '2020-06-01', items: [{ id: 'tbi', creditor: 'North Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
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

test('moving a dispute or letter onto a held client is refused', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-move@guard.test', status: 'active' });
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-move@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'clear');
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{ id: 'move-d', clientId: 'clear', recipient: 'Equifax', status: 'draft', items: [] }];
    g.body.data.letters = [{ id: 'move-l', clientId: 'clear', text: 'Letter', status: 'draft' }];
    const seeded = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(seeded.status, 200, JSON.stringify(seeded.body));
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

test('a legacy id-less activity row does not block a later edit', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada-legacy@guard.test', status: 'active', zip: '' });
    built.db.data.workspace.activity = built.db.data.workspace.activity || [];
    built.db.data.workspace.activity.unshift({ at: '2020-01-01T00:00:00.000Z', text: 'Legacy note', clientId: 'ada' });
    const g = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(g.body.data));
    sent.clients.find(row => row.id === 'ada').zip = '08002';
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: sent });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.data.clients.find(row => row.id === 'ada').zip, '08002');
    assert.ok(saved.body.data.activity.some(row => row && !row.id && row.text === 'Legacy note'));
    sent.activity.push({ text: 'New note with no id', clientId: 'ada' });
    const denied = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: sent });
    assert.strictEqual(denied.status, 422);
    assert.ok(denied.body.refused.some(row => row.key === 'activity' && row.field === 'id'));
  });
});

test('staff cannot mark a held client dispute as mailed from a workspace save', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-mail@guard.test', status: 'active' });
    built.db.data.workspace.disputes = [{ id: 'held-d', clientId: 'held', recipient: 'Equifax', status: 'draft', sentAt: null, items: [] }];
    built.db.data.workspace.letters = [{ id: 'held-l', clientId: 'held', text: 'Letter', status: 'draft', sentAt: null }];
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-mail@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    const dispute = sent.disputes.find(row => row.id === 'held-d');
    dispute.status = 'ready';
    dispute.sentAt = '2026-11-18';
    dispute.tracking = '9400';
    dispute.receivedAt = '2026-11-19';
    dispute.notes = 'A note is not a mailing step';
    const letter = sent.letters.find(row => row.id === 'held-l');
    letter.status = 'approved';
    letter.approvedAt = '2026-11-18';
    letter.text = 'Rewritten letter';
    letter.sentAt = '2026-11-18';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    const fields = (key, id) => denied.body.refused.filter(row => row.key === key && row.id === id).map(row => row.field);
    assert.deepStrictEqual(fields('disputes', 'held-d').sort(), ['receivedAt', 'sentAt', 'status', 'tracking']);
    assert.ok(fields('letters', 'held-l').includes('text'));
    assert.ok(fields('letters', 'held-l').includes('approvedAt'));
    assert.ok(fields('letters', 'held-l').includes('status'));
    assert.ok(fields('letters', 'held-l').includes('sentAt'));
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'held-d').status, 'draft');
    assert.strictEqual(after.body.data.letters.find(row => row.id === 'held-l').text, 'Letter');
    const notes = JSON.parse(JSON.stringify(before.body.data));
    notes.disputes.find(row => row.id === 'held-d').notes = 'Still a draft';
    const noted = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: notes });
    assert.strictEqual(noted.status, 200, JSON.stringify(noted.body));
    assert.strictEqual(noted.body.data.disputes.find(row => row.id === 'held-d').notes, 'Still a draft');
    assert.strictEqual(noted.body.data.disputes.find(row => row.id === 'held-d').status, 'draft');
  });
});

test('a null row in a list is refused', async () => {
  await withOwner(async ({ owner }) => {
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [null];
    const denied = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(denied.status, 422);
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && /empty row/.test(row.reason)));
    const after = await owner('GET', '/api/workspace');
    assert.ok(!(after.body.data.disputes || []).includes(null));
  });
});

test('a new id-less dispute is refused and a bad workspace shape blocks the deploy gate', async () => {
  await withOwner(async ({ owner }) => {
    const g = await owner('GET', '/api/workspace');
    g.body.data.disputes = [{}];
    const denied = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data });
    assert.strictEqual(denied.status, 422);
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.field === 'id'));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-shape-'));
  const file = path.join(dir, 'ledger-db.json');
  const body = JSON.stringify({ workspace: { invoices: [{ id: 'ok', status: 'draft' }], disputes: [{}], addressBook: { bad: { name: 'North' } } } });
  fs.writeFileSync(file, body);
  const ran = spawnSync(process.execPath, [path.join(import.meta.dirname, '../server/count-invoice-statuses.js'), file], { encoding: 'utf8' });
  assert.strictEqual(ran.status, 0, ran.stderr);
  const out = JSON.parse(ran.stdout);
  assert.ok(out.missingIdWarnings.some(row => row.key === 'disputes' && row.count === 1));
  assert.ok(out.shapeErrors.some(row => row.key === 'addressBook'));
  assert.strictEqual(out.deployGate.ready, false);
  const warnFile = path.join(dir, 'legacy.json');
  fs.writeFileSync(warnFile, JSON.stringify({ workspace: { invoices: [{ id: 'ok', status: 'draft' }], activity: [{ text: 'Legacy' }, { text: 'Also legacy' }] } }));
  const warned = JSON.parse(spawnSync(process.execPath, [path.join(import.meta.dirname, '../server/count-invoice-statuses.js'), warnFile], { encoding: 'utf8' }).stdout);
  assert.deepStrictEqual(warned.shapeErrors, []);
  assert.deepStrictEqual(warned.missingIdWarnings, [{ key: 'activity', count: 2 }]);
  assert.strictEqual(warned.deployGate.ready, true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the browser names a structured refusal and does not retry it as offline', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const views = fs.readFileSync(path.join(import.meta.dirname, '../js/views.js'), 'utf8');
  const flush = appJs.slice(appJs.indexOf('async flush()'), appJs.indexOf('async poll()'));
  assert.match(flush, /Store\.applyServerSave\(r\.data, sent\)/);
  assert.match(flush, /e\.body && e\.body\.data/);
  assert.match(flush, /Not allowed: /);
  assert.match(flush, /status === 400 \|\| e\.status === 403/);
  assert.match(flush, /!e\.status \|\| e\.status >= 500/);
  assert.doesNotMatch(appJs, /Billing\.payToken\(\)/);
  assert.doesNotMatch(appJs, /beforeunload/);
  assert.doesNotMatch(appJs, /sessionStorage/);
  const voidAct = appJs.slice(appJs.indexOf("'invoice-void'"), appJs.indexOf("'invoice-print'"));
  assert.match(voidAct, /find\(x => x && x\.id === id\)/);
  assert.match(views, /ledgerUser && root\.ledgerUser\.role === 'owner'/);
});

test('a 409 with data adopts the server copy and does not re-save over a new client or task', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const flush = appJs.slice(appJs.indexOf('async flush()'), appJs.indexOf('async poll()'));
  const conflict = flush.slice(flush.indexOf('e.status === 409 && e.body && e.body.data'), flush.indexOf('else if (refused)'));
  assert.match(conflict, /Store\.adopt\(e\.body\.data\)/);
  assert.match(conflict, /Someone else updated this\. Redo your last change\./);
  assert.match(conflict, /requeue = false/);
  assert.match(conflict, /this\.pending = false/);
  assert.doesNotMatch(conflict, /applyServerSave/);
  assert.match(flush, /Store\.applyServerSave\(r\.data, sent\)/);
});

test('a held client dispute cannot be moved to a cleared client and marked sent', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-bypass@guard.test', status: 'active' });
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-bypass@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'clear');
    built.db.data.workspace.disputes = [{ id: 'held-d', clientId: 'held', recipient: 'Equifax', status: 'draft', items: [] }];
    built.db.data.workspace.letters = [{ id: 'held-l', clientId: 'held', text: 'Letter', status: 'draft' }];
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-bypass@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    const dispute = sent.disputes.find(row => row.id === 'held-d');
    dispute.clientId = 'clear';
    dispute.status = 'sent';
    dispute.sentAt = '2026-11-18';
    const letter = sent.letters.find(row => row.id === 'held-l');
    letter.clientId = 'clear';
    letter.status = 'approved';
    letter.approvedAt = '2026-11-18';
    letter.text = 'Rewritten';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    const fields = (key, id) => denied.body.refused.filter(row => row.key === key && row.id === id).map(row => row.field);
    assert.ok(fields('disputes', 'held-d').includes('clientId'));
    assert.ok(fields('disputes', 'held-d').includes('status'));
    assert.ok(fields('letters', 'held-l').includes('clientId'));
    assert.ok(fields('letters', 'held-l').includes('status'));
    assert.ok(fields('letters', 'held-l').includes('approvedAt'));
    assert.ok(fields('letters', 'held-l').includes('text'));
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'held-d').clientId, 'held');
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'held-d').status, 'draft');
    assert.strictEqual(after.body.data.letters.find(row => row.id === 'held-l').clientId, 'held');
    assert.strictEqual(after.body.data.letters.find(row => row.id === 'held-l').status, 'draft');
    const moveOnly = JSON.parse(JSON.stringify(before.body.data));
    moveOnly.disputes.find(row => row.id === 'held-d').clientId = 'clear';
    const moved = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: moveOnly });
    assert.strictEqual(moved.status, 409, JSON.stringify(moved.body));
    assert.ok(moved.body.refused.some(row => row.key === 'disputes' && row.id === 'held-d' && row.field === 'clientId'));
    const still = await owner('GET', '/api/workspace');
    assert.strictEqual(still.body.data.disputes.find(row => row.id === 'held-d').clientId, 'held');
    assert.strictEqual(still.body.data.disputes.find(row => row.id === 'held-d').status, 'draft');
  });
});

test('a stored null row does not block a later edit and a new null row is refused', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada-null@guard.test', status: 'active', zip: '' });
    built.db.data.workspace.disputes = [null];
    const g = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(g.body.data));
    sent.clients.find(row => row.id === 'ada').zip = '08002';
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: sent });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.data.clients.find(row => row.id === 'ada').zip, '08002');
    assert.ok(saved.body.data.disputes.includes(null));
    sent.disputes = [null, null];
    const denied = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: sent });
    assert.strictEqual(denied.status, 422, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && /empty row/.test(row.reason)));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-null-'));
  const file = path.join(dir, 'ledger-db.json');
  const body = JSON.stringify({ workspace: { invoices: [{ id: 'ok', status: 'draft' }], disputes: [null] } });
  fs.writeFileSync(file, body);
  const out = JSON.parse(spawnSync(process.execPath, [path.join(import.meta.dirname, '../server/count-invoice-statuses.js'), file], { encoding: 'utf8' }).stdout);
  assert.ok(out.shapeErrors.some(row => row.key === 'disputes' && /empty row/.test(row.reason)));
  assert.strictEqual(out.deployGate.ready, false);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a held dispute outcome and a letter tied to that dispute cannot advance', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-tied@guard.test', status: 'active' });
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-tied@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'clear');
    built.db.data.workspace.disputes = [{ id: 'held-d', clientId: 'held', recipient: 'Equifax', status: 'draft', outcome: null, respondedAt: null, dueAt: null, mail: null, letterId: 'tied-l', items: [] }];
    built.db.data.workspace.letters = [{ id: 'tied-l', clientId: 'clear', disputeId: 'held-d', text: 'Letter', status: 'draft' }];
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-tied@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    const dispute = sent.disputes.find(row => row.id === 'held-d');
    dispute.outcome = 'deleted';
    dispute.respondedAt = '2026-11-18';
    dispute.dueAt = '2026-12-18';
    dispute.mail = { lobId: 'ltr_1' };
    dispute.letterId = 'other-l';
    const letter = sent.letters.find(row => row.id === 'tied-l');
    letter.status = 'approved';
    letter.approvedAt = '2026-11-18';
    letter.text = 'Rewritten letter';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    const fields = (key, id) => denied.body.refused.filter(row => row.key === key && row.id === id).map(row => row.field);
    assert.ok(fields('disputes', 'held-d').includes('outcome'));
    assert.ok(fields('disputes', 'held-d').includes('respondedAt'));
    assert.ok(fields('disputes', 'held-d').includes('dueAt'));
    assert.ok(fields('disputes', 'held-d').includes('mail'));
    assert.ok(fields('disputes', 'held-d').includes('letterId'));
    assert.ok(fields('letters', 'tied-l').includes('text'));
    assert.ok(fields('letters', 'tied-l').includes('approvedAt'));
    assert.ok(fields('letters', 'tied-l').includes('status'));
    const notes = JSON.parse(JSON.stringify(before.body.data));
    notes.disputes.find(row => row.id === 'held-d').notes = 'Still a draft';
    notes.letters.find(row => row.id === 'tied-l').notes = 'A note is not a mailing step';
    const noted = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: notes });
    assert.strictEqual(noted.status, 200, JSON.stringify(noted.body));
    assert.strictEqual(noted.body.data.disputes.find(row => row.id === 'held-d').outcome, null);
    assert.strictEqual(noted.body.data.letters.find(row => row.id === 'tied-l').text, 'Letter');
    assert.strictEqual(noted.body.data.disputes.find(row => row.id === 'held-d').notes, 'Still a draft');
    assert.strictEqual(noted.body.data.disputes.find(row => row.id === 'held-d').letterId, 'tied-l');
  });
});

test('a 409 keeps the other user city and dispute recipient instead of re-saving', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const flush = appJs.slice(appJs.indexOf('async flush()'), appJs.indexOf('async poll()'));
  const conflict = flush.slice(flush.indexOf('e.status === 409 && e.body && e.body.data'), flush.indexOf('else if (refused)'));
  assert.match(conflict, /Store\.adopt\(e\.body\.data\)/);
  assert.match(conflict, /Someone else updated this\. Redo your last change\./);
  assert.match(conflict, /this\.pending = false/);
  assert.match(conflict, /requeue = false/);
  assert.doesNotMatch(conflict, /applyServerSave/);
  assert.doesNotMatch(conflict, /this\.pending = true/);
});

test('a refusal leaves Not allowed on the status and names the other dropped edits', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const flush = appJs.slice(appJs.indexOf('async flush()'), appJs.indexOf('async poll()'));
  const refused = flush.slice(flush.indexOf('else if (refused)'), flush.indexOf('else if (e.status === 401)'));
  assert.match(refused, /setSync\('conflict'\)/);
  assert.match(refused, /Not allowed: /);
  assert.match(refused, /Dropped: /);
  assert.match(refused, /droppedEdits\(/);
  assert.doesNotMatch(refused, /setSync\('saving'\)/);
});

test('a null client row is refused when new and a stored one can be removed', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada-null-client@guard.test', status: 'active', zip: '' });
    const g = await owner('GET', '/api/workspace');
    const added = JSON.parse(JSON.stringify(g.body.data));
    added.clients.push(null);
    const denied = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: added });
    assert.strictEqual(denied.status, 422, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'clients' && /empty row/.test(row.reason)));
    built.db.data.workspace.clients.push(null);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-null-client@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const current = await staff('GET', '/api/workspace');
    const edit = JSON.parse(JSON.stringify(current.body.data));
    edit.clients.find(row => row && row.id === 'ada').zip = '08002';
    const saved = await staff('PUT', '/api/workspace', { baseVersion: current.body.version, data: edit });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.ok(saved.body.data.clients.includes(null));
    const remove = JSON.parse(JSON.stringify(saved.body.data));
    remove.clients = remove.clients.filter(row => row && row.id);
    const cleared = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: remove });
    assert.strictEqual(cleared.status, 200, JSON.stringify(cleared.body));
    assert.ok(!cleared.body.data.clients.some(row => row == null));
    const again = await owner('GET', '/api/workspace');
    again.body.data.clients.find(row => row.id === 'ada').zip = '08003';
    const next = await owner('PUT', '/api/workspace', { baseVersion: again.body.version, data: again.body.data });
    assert.strictEqual(next.status, 200, JSON.stringify(next.body));
    assert.strictEqual(next.body.data.clients.find(row => row.id === 'ada').zip, '08003');
  });
});

test('a non-object row in a list is refused and a stored one stays a deploy-gate error', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada-bad-row@guard.test', status: 'active', zip: '' });
    const g = await owner('GET', '/api/workspace');
    for (const bad of [null, '', 0, false, [], 'note']) {
      const sent = JSON.parse(JSON.stringify(g.body.data));
      sent.disputes = [bad];
      const denied = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: sent });
      assert.strictEqual(denied.status, 422, JSON.stringify(bad) + ' ' + JSON.stringify(denied.body));
      assert.ok(denied.body.refused.some(row => row.key === 'disputes' && /empty row/.test(row.reason)));
    }
    built.db.data.workspace.letters = ['legacy'];
    const current = await owner('GET', '/api/workspace');
    const edit = JSON.parse(JSON.stringify(current.body.data));
    edit.clients.find(row => row.id === 'ada').zip = '08002';
    const saved = await owner('PUT', '/api/workspace', { baseVersion: current.body.version, data: edit });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.ok(saved.body.data.letters.includes('legacy'));
    edit.letters = ['legacy', 'new'];
    const extra = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: edit });
    assert.strictEqual(extra.status, 422, JSON.stringify(extra.body));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-bad-row-'));
  const file = path.join(dir, 'ledger-db.json');
  const body = JSON.stringify({ workspace: { invoices: [{ id: 'ok', status: 'draft' }], disputes: [null, '', 0, false, [], 'note'] } });
  fs.writeFileSync(file, body);
  const out = JSON.parse(spawnSync(process.execPath, [path.join(import.meta.dirname, '../server/count-invoice-statuses.js'), file], { encoding: 'utf8' }).stdout);
  assert.ok(out.shapeErrors.filter(row => row.key === 'disputes' && /empty row/.test(row.reason)).length >= 6);
  assert.strictEqual(out.deployGate.ready, false);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reordering keys of a stored id-less row is not a change', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada-order@guard.test', status: 'active', zip: '' });
    built.db.data.workspace.activity = [{ text: 'Legacy', clientId: 'ada', at: '2020-01-01T00:00:00.000Z' }];
    built.db.data.workspace.violations = { '': { status: 'new', note: 'keep' } };
    const g = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(g.body.data));
    sent.activity = [{ clientId: 'ada', at: '2020-01-01T00:00:00.000Z', text: 'Legacy' }];
    sent.violations = { '': { note: 'keep', status: 'new' } };
    sent.clients.find(row => row.id === 'ada').zip = '08002';
    const saved = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: sent });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.data.clients.find(row => row.id === 'ada').zip, '08002');
    assert.ok(saved.body.data.activity.some(row => row && !row.id && row.text === 'Legacy'));
  });
});

test('a wrong list shape is a 400 and an id-less violations key is a 422', async () => {
  await withOwner(async ({ owner }) => {
    const g = await owner('GET', '/api/workspace');
    const shaped = JSON.parse(JSON.stringify(g.body.data));
    shaped.addressBook = { bad: { name: 'North Bank' } };
    const denied = await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: shaped });
    assert.strictEqual(denied.status, 400, JSON.stringify(denied.body));
    const hit = denied.body.refused.find(row => row.key === 'addressBook');
    assert.ok(hit);
    assert.match(hit.reason, /list/);
    const again = await owner('GET', '/api/workspace');
    again.body.data.violations = { '': { status: 'new' } };
    const violations = await owner('PUT', '/api/workspace', { baseVersion: again.body.version, data: again.body.data });
    assert.strictEqual(violations.status, 422, JSON.stringify(violations.body));
    assert.ok(violations.body.refused.some(row => row.key === 'violations' && row.field === 'id'));
    const stored = await owner('GET', '/api/workspace');
    assert.ok(!stored.body.data.violations || !Object.prototype.hasOwnProperty.call(stored.body.data.violations, ''));
  });
});

test('the browser adopts the saved workspace and does not mint pay tokens', () => {
  const appJs = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
  const flush = appJs.slice(appJs.indexOf('async flush()'), appJs.indexOf('async poll()'));
  assert.match(flush, /Store\.applyServerSave\(r\.data, sent\)/);
  assert.match(flush, /renderWhenSafe\(\)/);
  assert.match(flush, /e\.body && e\.body\.data/);
  assert.match(flush, /await this\.reload\(\)/);
  assert.doesNotMatch(appJs, /Billing\.payToken\(\)/);
  const voidAct = appJs.slice(appJs.indexOf("'invoice-void'"), appJs.indexOf("'invoice-print'"));
  assert.match(voidAct, /find\(x => x && x\.id === id\)/);
  assert.match(voidAct, /logVoidIfSaved/);
  assert.doesNotMatch(voidAct, /Voided invoice/);
  assert.match(appJs, /Store\.get\.client\(clientId\)/);
});

test('a cleared dispute cannot take a held client letter and be marked sent', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-letterid@guard.test', status: 'active' });
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-letterid@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'clear');
    built.db.data.workspace.disputes = [{ id: 'clear-d', clientId: 'clear', recipient: 'Equifax', status: 'draft', letterId: null, items: [] }];
    built.db.data.workspace.letters = [{ id: 'held-l', clientId: 'held', disputeId: null, text: 'Held letter', status: 'approved' }];
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-letterid@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    const dispute = sent.disputes.find(row => row.id === 'clear-d');
    dispute.letterId = 'held-l';
    dispute.status = 'sent';
    dispute.sentAt = '2026-11-18';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    const fields = denied.body.refused.filter(row => row.key === 'disputes' && row.id === 'clear-d').map(row => row.field);
    assert.ok(fields.includes('letterId'));
    assert.ok(fields.includes('status'));
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'clear-d').letterId, null);
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'clear-d').status, 'draft');
    const quiet = JSON.parse(JSON.stringify(before.body.data));
    quiet.disputes.find(row => row.id === 'clear-d').letterId = 'held-l';
    const onlyLink = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: quiet });
    assert.strictEqual(onlyLink.status, 409, JSON.stringify(onlyLink.body));
    const planted = JSON.parse(JSON.stringify(before.body.data));
    planted.disputes.find(row => row.id === 'clear-d').letterId = 'held-l';
    built.db.data.workspace.disputes.find(row => row.id === 'clear-d').letterId = 'held-l';
    const blocked = await staff('POST', '/api/disputes/clear-d/mail', {});
    assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.body));
    assert.match(blocked.body.error, /Held Client/);
  });
});

test('deleting a held client in the same save cannot mark that dispute sent', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-delete@guard.test', status: 'lead' });
    built.db.data.workspace.disputes = [{ id: 'held-d', clientId: 'held', recipient: 'Equifax', status: 'draft', items: [] }];
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-delete-held@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.clients = sent.clients.filter(row => row.id !== 'held');
    sent.disputes.find(row => row.id === 'held-d').status = 'sent';
    sent.disputes.find(row => row.id === 'held-d').sentAt = '2026-11-18';
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.id === 'held-d' && row.field === 'status'));
    const after = await owner('GET', '/api/workspace');
    assert.ok(after.body.data.clients.some(row => row.id === 'held'));
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'held-d').status, 'draft');
  });
});

test('a dispute id removed from a held client cannot be recreated on a cleared client', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-tomb@guard.test', status: 'active' });
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-tomb@guard.test', status: 'lead' });
    seedSignedClient(built.db.data.workspace, 'clear');
    built.db.data.workspace.disputes = [{ id: 'tomb-d', clientId: 'held', recipient: 'Equifax', status: 'draft', items: [] }];
    const before = await owner('GET', '/api/workspace');
    const dropped = JSON.parse(JSON.stringify(before.body.data));
    dropped.disputes = dropped.disputes.filter(row => row.id !== 'tomb-d');
    const removed = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: dropped });
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    assert.ok(!(removed.body.data.disputes || []).some(row => row && row.id === 'tomb-d'));
    const again = JSON.parse(JSON.stringify(removed.body.data));
    again.disputes = again.disputes || [];
    again.disputes.push({ id: 'tomb-d', clientId: 'clear', recipient: 'Equifax', status: 'sent', sentAt: '2026-11-18', items: [] });
    const reborn = await owner('PUT', '/api/workspace', { baseVersion: removed.body.version, data: again });
    assert.strictEqual(reborn.status, 409, JSON.stringify(reborn.body));
    assert.ok(reborn.body.refused.some(row => row.key === 'disputes' && row.id === 'tomb-d' && row.field === 'id'));
    const stored = await owner('GET', '/api/workspace');
    assert.ok(!(stored.body.data.disputes || []).some(row => row && row.id === 'tomb-d'));
  });
});

test('a held letter cannot be pointed at another dispute by itself', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-retarget@guard.test', status: 'lead' });
    built.db.data.workspace.disputes = [
      { id: 'd1', clientId: 'held', recipient: 'Equifax', status: 'draft', items: [] },
      { id: 'd2', clientId: 'held', recipient: 'Experian', status: 'draft', items: [] }
    ];
    built.db.data.workspace.letters = [{ id: 'held-l', clientId: 'held', disputeId: 'd1', text: 'Letter', status: 'draft' }];
    const before = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.letters.find(row => row.id === 'held-l').disputeId = 'd2';
    const denied = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'letters' && row.id === 'held-l' && row.field === 'disputeId'));
    const notes = JSON.parse(JSON.stringify(before.body.data));
    notes.letters.find(row => row.id === 'held-l').notes = 'A note is not a mailing step';
    const noted = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: notes });
    assert.strictEqual(noted.status, 200, JSON.stringify(noted.body));
    assert.strictEqual(noted.body.data.letters.find(row => row.id === 'held-l').disputeId, 'd1');
    assert.strictEqual(noted.body.data.letters.find(row => row.id === 'held-l').notes, 'A note is not a mailing step');
  });
});

test('deleting a held client who still has work is refused, and an orphan stays on hold', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-orphan@guard.test', status: 'active' });
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-orphan@guard.test', status: 'lead' });
    await addClient(owner, { id: 'empty-held', name: 'Empty Held', kind: 'personal', email: 'empty-held@guard.test', status: 'lead' });
    seedSignedClient(built.db.data.workspace, 'clear');
    built.db.data.workspace.disputes = [{ id: 'held-d', clientId: 'held', recipient: 'Equifax', status: 'draft', items: [] }];
    built.db.data.workspace.letters = [{ id: 'held-l', clientId: 'held', text: 'Letter', status: 'draft' }];
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-orphan@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const before = await staff('GET', '/api/workspace');
    const dropClient = JSON.parse(JSON.stringify(before.body.data));
    dropClient.clients = dropClient.clients.filter(row => row.id !== 'held');
    const denied = await staff('PUT', '/api/workspace', { baseVersion: before.body.version, data: dropClient });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    const named = denied.body.refused.find(row => row.key === 'clients' && row.id === 'held');
    assert.ok(named);
    assert.match(named.reason, /dispute held-d/);
    assert.match(named.reason, /letter held-l/);
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.id === 'held-d'));
    assert.ok(denied.body.refused.some(row => row.key === 'letters' && row.id === 'held-l'));
    const kept = await owner('GET', '/api/workspace');
    assert.ok(kept.body.data.clients.some(row => row.id === 'held'));
    assert.strictEqual(kept.body.data.disputes.find(row => row.id === 'held-d').status, 'draft');
    built.db.data.workspace.clients = built.db.data.workspace.clients.filter(row => row.id !== 'held');
    const orphan = await staff('GET', '/api/workspace');
    const markSent = JSON.parse(JSON.stringify(orphan.body.data));
    markSent.disputes.find(row => row.id === 'held-d').status = 'sent';
    markSent.disputes.find(row => row.id === 'held-d').sentAt = '2026-11-18';
    const sent = await staff('PUT', '/api/workspace', { baseVersion: orphan.body.version, data: markSent });
    assert.strictEqual(sent.status, 409, JSON.stringify(sent.body));
    assert.ok(sent.body.refused.some(row => row.key === 'disputes' && row.id === 'held-d' && row.field === 'status'));
    const approve = JSON.parse(JSON.stringify(orphan.body.data));
    approve.letters.find(row => row.id === 'held-l').status = 'approved';
    approve.letters.find(row => row.id === 'held-l').approvedAt = '2026-11-18';
    const approved = await staff('PUT', '/api/workspace', { baseVersion: orphan.body.version, data: approve });
    assert.strictEqual(approved.status, 409, JSON.stringify(approved.body));
    assert.ok(approved.body.refused.some(row => row.key === 'letters' && row.id === 'held-l' && row.field === 'status'));
    const moved = JSON.parse(JSON.stringify(orphan.body.data));
    moved.disputes.find(row => row.id === 'held-d').clientId = 'clear';
    moved.letters.find(row => row.id === 'held-l').clientId = 'clear';
    const relocated = await staff('PUT', '/api/workspace', { baseVersion: orphan.body.version, data: moved });
    assert.strictEqual(relocated.status, 409, JSON.stringify(relocated.body));
    assert.ok(relocated.body.refused.some(row => row.key === 'disputes' && row.id === 'held-d' && row.field === 'clientId'));
    assert.ok(relocated.body.refused.some(row => row.key === 'letters' && row.id === 'held-l' && row.field === 'clientId'));
    const mailed = await staff('POST', '/api/disputes/held-d/mail', {});
    assert.strictEqual(mailed.status, 409, JSON.stringify(mailed.body));
    assert.match(mailed.body.error, /not in the workspace|not active for service work/);
    const quiet = await owner('GET', '/api/workspace');
    const dropEmpty = JSON.parse(JSON.stringify(quiet.body.data));
    dropEmpty.clients = dropEmpty.clients.filter(row => row.id !== 'empty-held');
    const removed = await owner('PUT', '/api/workspace', { baseVersion: quiet.body.version, data: dropEmpty });
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    assert.ok((removed.body.data.heldServiceIds.clients || []).some(row => row.id === 'empty-held'));
    assert.ok(!removed.body.data.clients.some(row => row.id === 'empty-held'));
  });
});

test('a cleared client cannot dispute a held client report or move that report', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-file@guard.test', status: 'active' });
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-file@guard.test', status: 'lead' });
    seedSignedClient(built.db.data.workspace, 'clear');
    built.db.data.workspace.reports = [
      { id: 'rep-h', clientId: 'held', bureau: 'Equifax', accounts: [{ id: 'acct-h', creditor: 'North Bank' }] },
      { id: 'rep-c', clientId: 'clear', bureau: 'Experian', accounts: [] }
    ];
    const before = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.disputes = [{ id: 'clear-d', clientId: 'clear', recipient: 'Equifax', status: 'sent', sentAt: '2026-11-18', letterId: 'clear-l', items: [{ id: 'item-1', reportId: 'rep-h', accountId: 'acct-h', creditor: 'North Bank' }] }];
    sent.letters = [{ id: 'clear-l', clientId: 'clear', disputeId: 'clear-d', status: 'approved', approvedAt: '2026-11-18', sentAt: '2026-11-18', text: 'Sent letter' }];
    const denied = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.id === 'clear-d' && row.field === 'items'));
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.id === 'clear-d' && row.field === 'status'));
    assert.ok(denied.body.refused.some(row => row.key === 'letters' && row.id === 'clear-l' && (row.field === 'status' || row.field === 'approvedAt' || row.field === 'text')));
    const after = await owner('GET', '/api/workspace');
    assert.ok(!(after.body.data.disputes || []).some(row => row && row.id === 'clear-d'));
    assert.strictEqual(after.body.data.reports.find(row => row.id === 'rep-h').clientId, 'held');
    const moved = JSON.parse(JSON.stringify(before.body.data));
    moved.reports.find(row => row.id === 'rep-h').clientId = 'clear';
    const reportMove = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: moved });
    assert.strictEqual(reportMove.status, 409, JSON.stringify(reportMove.body));
    assert.ok(reportMove.body.refused.some(row => row.key === 'reports' && row.id === 'rep-h' && row.field === 'clientId'));
    const shifted = JSON.parse(JSON.stringify(before.body.data));
    const heldReport = shifted.reports.find(row => row.id === 'rep-h');
    const account = heldReport.accounts.find(row => row.id === 'acct-h');
    heldReport.accounts = [];
    shifted.reports.find(row => row.id === 'rep-c').accounts = [account];
    const accountMove = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: shifted });
    assert.strictEqual(accountMove.status, 409, JSON.stringify(accountMove.body));
    assert.ok(accountMove.body.refused.some(row => row.key === 'reports' && row.id === 'rep-c' && row.field === 'accounts'));
  });
});

test('a held client with disputes cannot switch type to mark a dispute sent', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-kind@guard.test', status: 'lead' });
    built.db.data.workspace.disputes = [{ id: 'held-d', clientId: 'held', recipient: 'Equifax', status: 'draft', items: [] }];
    const before = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.clients.find(row => row.id === 'held').kind = 'business';
    sent.disputes.find(row => row.id === 'held-d').status = 'sent';
    sent.disputes.find(row => row.id === 'held-d').sentAt = '2026-11-18';
    const denied = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'clients' && row.id === 'held' && row.field === 'kind'));
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.id === 'held-d' && row.field === 'status'));
    const onlyKind = JSON.parse(JSON.stringify(before.body.data));
    onlyKind.clients.find(row => row.id === 'held').kind = 'business';
    const switched = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: onlyKind });
    assert.strictEqual(switched.status, 409, JSON.stringify(switched.body));
    assert.ok(switched.body.refused.some(row => row.key === 'clients' && row.id === 'held' && row.field === 'kind'));
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.clients.find(row => row.id === 'held').kind, 'personal');
    assert.strictEqual(after.body.data.disputes.find(row => row.id === 'held-d').status, 'draft');
  });
});

test('a removed held client is not held after the owner adds them back clear', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'back', name: 'Back Client', kind: 'personal', email: 'back-held@guard.test', status: 'lead' });
    const before = await owner('GET', '/api/workspace');
    const dropped = JSON.parse(JSON.stringify(before.body.data));
    dropped.clients = dropped.clients.filter(row => row.id !== 'back');
    const removed = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: dropped });
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    assert.ok((removed.body.data.heldServiceIds.clients || []).some(row => row.id === 'back'));
    const again = JSON.parse(JSON.stringify(removed.body.data));
    again.clients.push({ id: 'back', name: 'Back Client', kind: 'personal', email: 'back-held@guard.test', status: 'active' });
    const restored = await owner('PUT', '/api/workspace', { baseVersion: removed.body.version, data: again });
    assert.strictEqual(restored.status, 200, JSON.stringify(restored.body));
    seedSignedClient(built.db.data.workspace, 'back');
    const clear = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(clear.body.data));
    sent.disputes = [{ id: 'back-d', clientId: 'back', recipient: 'Equifax', status: 'sent', sentAt: '2026-11-18', items: [] }];
    const saved = await owner('PUT', '/api/workspace', { baseVersion: clear.body.version, data: sent });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.ok(!(saved.body.data.heldServiceIds.clients || []).some(row => row.id === 'back'));
    assert.strictEqual(saved.body.data.disputes.find(row => row.id === 'back-d').status, 'sent');
  });
});

test('the deploy gate lists orphan disputes and blank client rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-orphan-'));
  const file = path.join(dir, 'ledger-db.json');
  const body = JSON.stringify({ workspace: { invoices: [{ id: 'ok', status: 'draft' }], clients: [null], disputes: [{ id: 'gone-d', clientId: 'missing' }], letters: [{ id: 'gone-l', clientId: 'missing' }] } });
  fs.writeFileSync(file, body);
  const script = path.join(import.meta.dirname, '../server/count-invoice-statuses.js');
  const out = JSON.parse(spawnSync(process.execPath, [script, file], { encoding: 'utf8' }).stdout);
  assert.ok(out.shapeErrors.some(row => row.key === 'clients' && /empty row/.test(row.reason)));
  assert.ok(out.orphans.disputes.some(row => row.id === 'gone-d' && row.clientId === 'missing'));
  assert.ok(out.orphans.letters.some(row => row.id === 'gone-l'));
  assert.deepStrictEqual(out.deployGate.orphans.disputes, out.orphans.disputes);
  assert.strictEqual(out.deployGate.ready, false);
  const orphanOnly = path.join(dir, 'orphan-only.json');
  const orphanBody = JSON.stringify({ workspace: { invoices: [{ id: 'ok', status: 'draft' }], clients: [{ id: 'ada' }], disputes: [{ id: 'gone-d', clientId: 'missing' }], letters: [] } });
  fs.writeFileSync(orphanOnly, orphanBody);
  const listed = JSON.parse(spawnSync(process.execPath, [script, orphanOnly], { encoding: 'utf8' }).stdout);
  assert.strictEqual(listed.deployGate.ready, true);
  assert.deepStrictEqual(listed.orphans.disputes, [{ key: 'disputes', id: 'gone-d', clientId: 'missing' }]);
  const linkedFile = path.join(dir, 'linked.json');
  const linkedBody = JSON.stringify({ workspace: {
    invoices: [{ id: 'ok', status: 'draft' }],
    clients: [{ id: 'ada' }, { id: 'ben' }],
    reports: [{ id: 'rep-b', clientId: 'ben', accounts: [{ id: 'acct-b' }] }, { id: 'rep-gone', clientId: 'missing', accounts: [] }],
    disputes: [{ id: 'd1', clientId: 'ada', items: [{ reportId: 'rep-b', accountId: 'acct-b' }] }],
    letters: [{ id: 'l1', clientId: 'ada', reportId: 'rep-b' }]
  } });
  fs.writeFileSync(linkedFile, linkedBody);
  const linked = JSON.parse(spawnSync(process.execPath, [script, linkedFile], { encoding: 'utf8' }).stdout);
  assert.strictEqual(linked.deployGate.ready, true);
  assert.ok(linked.orphans.reports.some(row => row.id === 'rep-gone' && row.clientId === 'missing'));
  assert.ok(linked.crossClient.some(row => row.key === 'disputes' && row.id === 'd1' && row.ownerClientId === 'ben' && row.accountId === 'acct-b'));
  assert.ok(linked.crossClient.some(row => row.key === 'letters' && row.id === 'l1' && row.reportId === 'rep-b'));
  assert.deepStrictEqual(linked.deployGate.crossClient, linked.crossClient);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an already-sent orphan can record a bureau response, and a dispute without a client cannot be sent', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'other', name: 'Other Client', kind: 'personal', email: 'other-sent@guard.test', status: 'active' });
    built.db.data.workspace.disputes = [{ id: 'sent-d', clientId: 'gone', recipient: 'TransUnion', status: 'sent', sentAt: '2026-11-01', outcome: null, respondedAt: null, receivedDate: null, items: [] }];
    const before = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    const dispute = sent.disputes.find(row => row.id === 'sent-d');
    dispute.outcome = 'deleted';
    dispute.respondedAt = '2026-11-18';
    dispute.receivedDate = '2026-11-18';
    const saved = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const stored = saved.body.data.disputes.find(row => row.id === 'sent-d');
    assert.strictEqual(stored.outcome, 'deleted');
    assert.strictEqual(stored.respondedAt, '2026-11-18');
    assert.strictEqual(stored.receivedDate, '2026-11-18');
    const advance = JSON.parse(JSON.stringify(saved.body.data));
    advance.disputes.find(row => row.id === 'sent-d').tracking = '9400';
    const denied = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: advance });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.id === 'sent-d' && row.field === 'tracking'));
    const naked = JSON.parse(JSON.stringify(saved.body.data));
    naked.disputes.push({ id: 'no-client', recipient: 'Equifax', status: 'sent', sentAt: '2026-11-18', items: [] });
    const blocked = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: naked });
    assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.body));
    assert.ok(blocked.body.refused.some(row => row.key === 'disputes' && row.id === 'no-client' && (row.field === 'status' || row.field === 'sentAt' || row.field === 'clientId')));
    built.db.data.workspace.disputes.push({ id: 'mail-none', recipient: 'Equifax', status: 'draft', items: [] });
    const mailed = await owner('POST', '/api/disputes/mail-none/mail', {});
    assert.strictEqual(mailed.status, 409, JSON.stringify(mailed.body));
    assert.match(mailed.body.error, /client/);
    assert.doesNotMatch(mailed.body.error, /Lob API key/);
  });
});

test('a no-client draft dispute or letter can be saved, and only a send is refused', async () => {
  await withOwner(async ({ owner }) => {
    await addClient(owner, { id: 'other', name: 'Other Client', kind: 'personal', email: 'other-draft@guard.test', status: 'active' });
    const before = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.disputes = sent.disputes || [];
    sent.letters = sent.letters || [];
    sent.disputes.push({ id: 'draft-none', recipient: 'Equifax', status: 'draft', items: [] });
    sent.letters.push({ id: 'draft-letter', text: 'Draft letter', status: 'draft' });
    const saved = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.data.disputes.find(row => row.id === 'draft-none').status, 'draft');
    assert.strictEqual(saved.body.data.letters.find(row => row.id === 'draft-letter').text, 'Draft letter');
    const advance = JSON.parse(JSON.stringify(saved.body.data));
    advance.disputes.find(row => row.id === 'draft-none').status = 'sent';
    advance.disputes.find(row => row.id === 'draft-none').sentAt = '2026-11-18';
    advance.letters.find(row => row.id === 'draft-letter').status = 'approved';
    advance.letters.find(row => row.id === 'draft-letter').approvedAt = '2026-11-18';
    const denied = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: advance });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'disputes' && row.id === 'draft-none' && row.field === 'status' && /needs a client before it can be sent/.test(row.reason)));
    assert.ok(denied.body.refused.some(row => row.key === 'letters' && row.id === 'draft-letter' && row.field === 'status' && /needs a client before it can be sent/.test(row.reason)));
  });
});

test('a held client with only a report cannot be deleted, and a business recreate does not release the hold', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-report@guard.test', status: 'lead' });
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-report@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'clear');
    built.db.data.workspace.reports = [{ id: 'rep-h', clientId: 'held', bureau: 'Equifax', accounts: [{ id: 'acct-h', creditor: 'North Bank' }] }];
    const before = await owner('GET', '/api/workspace');
    const drop = JSON.parse(JSON.stringify(before.body.data));
    drop.clients = drop.clients.filter(row => row.id !== 'held');
    const denied = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: drop });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    const named = denied.body.refused.find(row => row.key === 'clients' && row.id === 'held');
    assert.match(named.reason, /report rep-h/);
    const kept = await owner('GET', '/api/workspace');
    const withoutReport = JSON.parse(JSON.stringify(kept.body.data));
    withoutReport.reports = withoutReport.reports.filter(row => row.id !== 'rep-h');
    const removedReport = await owner('PUT', '/api/workspace', { baseVersion: kept.body.version, data: withoutReport });
    assert.strictEqual(removedReport.status, 200, JSON.stringify(removedReport.body));
    assert.ok((removedReport.body.data.heldServiceIds.reports || []).some(row => row.id === 'rep-h'));
    assert.ok((removedReport.body.data.heldServiceIds.accounts || []).some(row => row.id === 'acct-h'));
    const again = JSON.parse(JSON.stringify(removedReport.body.data));
    again.reports.push({ id: 'rep-h', clientId: 'clear', bureau: 'Equifax', accounts: [{ id: 'acct-h', creditor: 'North Bank' }] });
    const reborn = await owner('PUT', '/api/workspace', { baseVersion: removedReport.body.version, data: again });
    assert.strictEqual(reborn.status, 409, JSON.stringify(reborn.body));
    assert.ok(reborn.body.refused.some(row => row.key === 'reports' && row.id === 'rep-h' && (row.field === 'id' || row.field === 'accounts')));
    const fresh = await owner('GET', '/api/workspace');
    const otherReport = JSON.parse(JSON.stringify(fresh.body.data));
    otherReport.reports.push({ id: 'rep-new', clientId: 'clear', bureau: 'Experian', accounts: [{ id: 'acct-h', creditor: 'North Bank' }] });
    const accountBack = await owner('PUT', '/api/workspace', { baseVersion: fresh.body.version, data: otherReport });
    assert.strictEqual(accountBack.status, 409, JSON.stringify(accountBack.body));
    assert.ok(accountBack.body.refused.some(row => row.key === 'reports' && row.field === 'accounts'));
    const current = await owner('GET', '/api/workspace');
    const dropClient = JSON.parse(JSON.stringify(current.body.data));
    dropClient.clients = dropClient.clients.filter(row => row.id !== 'held');
    const gone = await owner('PUT', '/api/workspace', { baseVersion: current.body.version, data: dropClient });
    assert.strictEqual(gone.status, 200, JSON.stringify(gone.body));
    assert.ok((gone.body.data.heldServiceIds.clients || []).some(row => row.id === 'held'));
    const business = JSON.parse(JSON.stringify(gone.body.data));
    business.clients.push({ id: 'held', name: 'Held Business', kind: 'business', email: 'held-biz@guard.test', status: 'active' });
    business.disputes = business.disputes || [];
    business.disputes.push({ id: 'biz-d', clientId: 'held', recipient: 'Equifax', status: 'sent', sentAt: '2026-11-18', items: [{ id: 'item-1', reportId: 'rep-h', accountId: 'acct-h' }] });
    const sent = await owner('PUT', '/api/workspace', { baseVersion: gone.body.version, data: business });
    assert.strictEqual(sent.status, 409, JSON.stringify(sent.body));
    assert.ok((sent.body.refused || []).some(row => row.id === 'biz-d' || row.id === 'held'));
    const quiet = await owner('GET', '/api/workspace');
    assert.ok((quiet.body.data.heldServiceIds.clients || []).some(row => row.id === 'held'));
    assert.ok(!quiet.body.data.clients.some(row => row.id === 'held'));
  });
});

test('a held client with a report cannot switch type', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-rep-kind@guard.test', status: 'lead' });
    built.db.data.workspace.reports = [{ id: 'rep-k', clientId: 'held', bureau: 'Equifax', accounts: [] }];
    const before = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.clients.find(row => row.id === 'held').kind = 'business';
    const denied = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(denied.status, 409, JSON.stringify(denied.body));
    assert.ok(denied.body.refused.some(row => row.key === 'clients' && row.id === 'held' && row.field === 'kind'));
  });
});

test('an unchanged dispute that cites a client who later cancels does not block another save', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-later@guard.test', status: 'active' });
    await addClient(owner, { id: 'later', name: 'Later Cancel', kind: 'personal', email: 'later-cancel@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'clear');
    seedSignedClient(built.db.data.workspace, 'later');
    built.db.data.workspace.reports = [{ id: 'rep-later', clientId: 'later', bureau: 'Equifax', accounts: [{ id: 'acct-later', creditor: 'North Bank' }, { id: 'acct-two', creditor: 'South Bank' }] }];
    const before = await owner('GET', '/api/workspace');
    const sent = JSON.parse(JSON.stringify(before.body.data));
    sent.disputes = [{ id: 'cite-d', clientId: 'clear', recipient: 'Equifax', status: 'draft', items: [{ id: 'item-1', reportId: 'rep-later', accountId: 'acct-later', creditor: 'North Bank' }] }];
    sent.letters = [{ id: 'cite-l', clientId: 'clear', disputeId: 'cite-d', text: 'Letter', status: 'draft' }];
    const saved = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const later = built.db.data.workspace.clients.find(row => row.id === 'later');
    later.onboarding.cancelledAt = '2026-11-18';
    later.status = 'cancelled';
    const current = await owner('GET', '/api/workspace');
    const notes = JSON.parse(JSON.stringify(current.body.data));
    notes.clients.find(row => row.id === 'clear').notes = 'Unrelated note';
    const quiet = await owner('PUT', '/api/workspace', { baseVersion: current.body.version, data: notes });
    assert.strictEqual(quiet.status, 200, JSON.stringify(quiet.body));
    assert.strictEqual(quiet.body.data.clients.find(row => row.id === 'clear').notes, 'Unrelated note');
    const changed = JSON.parse(JSON.stringify(quiet.body.data));
    changed.disputes.find(row => row.id === 'cite-d').items = [{ id: 'item-1', reportId: 'rep-later', accountId: 'acct-two', creditor: 'South Bank' }];
    const moved = await owner('PUT', '/api/workspace', { baseVersion: quiet.body.version, data: changed });
    assert.strictEqual(moved.status, 409, JSON.stringify(moved.body));
    assert.ok(moved.body.refused.some(row => row.key === 'disputes' && row.id === 'cite-d' && row.field === 'items'));
    const mailed = await owner('POST', '/api/disputes/cite-d/mail', {});
    assert.strictEqual(mailed.status, 409, JSON.stringify(mailed.body));
    assert.match(mailed.body.error, /not active for service work|held|cancellation/i);
    assert.doesNotMatch(mailed.body.error, /Lob API key/);
  });
});

test('recording a bureau response on a held or missing client does not notify, bill, or start work', async () => {
  const out = [];
  setTransport(async message => { out.push(message); });
  try {
    await withOwner(async ({ built, owner }) => {
      await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-resp@guard.test', status: 'lead' });
      await addClient(owner, { id: 'clear', name: 'Clear Client', kind: 'personal', email: 'clear-resp@guard.test', status: 'active' });
      seedSignedClient(built.db.data.workspace, 'clear');
      built.db.data.users.push({ id: 'held-user', name: 'Held Client', email: 'held-resp@guard.test', role: 'client', clientId: 'held', password: 'x', sessionEpoch: 1, createdAt: '2026-11-01T00:00:00.000Z', disabled: false });
      built.db.data.users.push({ id: 'clear-user', name: 'Clear Client', email: 'clear-resp@guard.test', role: 'client', clientId: 'clear', password: 'x', sessionEpoch: 1, createdAt: '2026-11-01T00:00:00.000Z', disabled: false });
      built.db.data.workspace.disputes = [
        { id: 'held-d', clientId: 'held', recipient: 'TransUnion', status: 'sent', sentAt: '2026-11-01', outcome: null, items: [{ id: 'item-1', creditor: 'North Bank', result: null }] },
        { id: 'gone-d', clientId: 'gone', recipient: 'Equifax', status: 'sent', sentAt: '2026-11-01', outcome: null, items: [] },
        { id: 'clear-d', clientId: 'clear', recipient: 'Experian', status: 'sent', sentAt: '2026-11-01', outcome: null, items: [] }
      ];
      const before = await owner('GET', '/api/workspace');
      const invoiceCount = (before.body.data.invoices || []).length;
      const taskCount = (before.body.data.tasks || []).length;
      const letterCount = (before.body.data.letters || []).length;
      const sent = JSON.parse(JSON.stringify(before.body.data));
      sent.disputes.find(row => row.id === 'held-d').outcome = 'deleted';
      sent.disputes.find(row => row.id === 'held-d').respondedAt = '2026-11-18';
      sent.disputes.find(row => row.id === 'held-d').receivedDate = '2026-11-18';
      sent.disputes.find(row => row.id === 'held-d').items[0].result = 'deleted';
      sent.disputes.find(row => row.id === 'gone-d').outcome = 'deleted';
      sent.disputes.find(row => row.id === 'gone-d').respondedAt = '2026-11-18';
      const saved = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: sent });
      assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.ok(!out.some(message => message.to === 'held-resp@guard.test'));
      assert.strictEqual((saved.body.data.invoices || []).length, invoiceCount);
      assert.strictEqual((saved.body.data.tasks || []).length, taskCount);
      assert.strictEqual((saved.body.data.letters || []).length, letterCount);
      const audit = await owner('GET', '/api/audit');
      const rows = audit.body.filter(row => row.action === 'dispute.bureau_response');
      assert.ok(rows.some(row => row.actor === 'owner@guard.test' && row.at && /held-d/.test(row.detail) && /items\.result/.test(row.detail) && /"result":"deleted"/.test(row.detail)));
      assert.ok(rows.some(row => row.actor === 'owner@guard.test' && row.at && /gone-d/.test(row.detail)));
      const billed = JSON.parse(JSON.stringify(saved.body.data));
      billed.invoices = billed.invoices || [];
      billed.invoices.push({ id: 'held-inv', clientId: 'held', disputeId: 'held-d', itemId: 'x', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2026-11-18', serviceCompletedAt: '2026-11-18' });
      const heldBill = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: billed });
      assert.strictEqual(heldBill.status, 409, JSON.stringify(heldBill.body));
      const orphanBill = JSON.parse(JSON.stringify(saved.body.data));
      orphanBill.invoices = orphanBill.invoices || [];
      orphanBill.invoices.push({ id: 'gone-inv', clientId: 'gone', disputeId: 'gone-d', itemId: 'x', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2026-11-18', serviceCompletedAt: '2026-11-18' });
      const goneBill = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: orphanBill });
      assert.strictEqual(goneBill.status, 409, JSON.stringify(goneBill.body));
      assert.match(goneBill.body.error, /client who is in the workspace/);
      const clearSent = JSON.parse(JSON.stringify(saved.body.data));
      clearSent.disputes.find(row => row.id === 'clear-d').outcome = 'deleted';
      clearSent.disputes.find(row => row.id === 'clear-d').respondedAt = '2026-11-18';
      const cleared = await owner('PUT', '/api/workspace', { baseVersion: saved.body.version, data: clearSent });
      assert.strictEqual(cleared.status, 200, JSON.stringify(cleared.body));
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.ok(out.some(message => message.to === 'clear-resp@guard.test'));
    });
  } finally {
    setTransport(null);
  }
});

test('a held client outcome does not schedule a removal message or the next letter', () => {
  const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Set, Map, Error, URLSearchParams, crypto, navigator: {} };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.top = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  const root = path.join(import.meta.dirname, '../js');
  for (const file of ['law.js', 'store.js', 'automations.js', 'sequences.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  const Store = ctx.Store;
  Store.load();
  Store.setRemote(true);
  Store.adopt({
    version: 2,
    clients: [
      { id: 'held', name: 'Held', kind: 'personal', status: 'lead', onboarding: {} },
      { id: 'clear', name: 'Clear', kind: 'personal', status: 'active', onboarding: { disclosureSignedAt: '2020-01-06', contractSignedAt: '2020-01-06', cancellationWindowEndsAt: '2020-01-09' } }
    ],
    signatures: [
      { id: 'd', clientId: 'clear', doc: 'disclosure' },
      { id: 'c', clientId: 'clear', doc: 'contract' }
    ],
    disputes: [
      { id: 'held-d', clientId: 'held', seqId: 'sq', type: 'cra_611', recipient: 'Equifax', sentAt: '2026-11-01', outcome: 'verified', respondedAt: '2026-11-18', items: [{ creditor: 'North Bank' }] },
      { id: 'clear-d', clientId: 'clear', recipient: 'Experian', sentAt: '2026-11-01', outcome: 'deleted', respondedAt: '2026-11-18', items: [{ creditor: 'South Bank' }] }
    ],
    sequences: [{ id: 'sq', clientId: 'held', status: 'active', title: 'Round' }],
    letters: [],
    automations: [{ id: 'removed', trigger: 'item_removed', delayDays: 0, channel: 'email', subject: 'Good news', body: 'Hi', enabled: true, enabledAt: '2020-01-01' }],
    automationLog: {},
    settings: { company: { name: 'Ledger' }, billing: {} }
  });
  const removed = ctx.Automations.due(Store.state, '2026-11-19', {});
  assert.ok(!removed.some(row => row.client && row.client.id === 'held'));
  assert.ok(removed.some(row => row.client && row.client.id === 'clear'));
  assert.strictEqual(ctx.Sequences.plan(Store.state, Store.state.sequences[0], '2026-11-19').length, 0);
  Store.state.disputes.find(row => row.id === 'held-d').sentAt = '2026-11-01';
  Store.state.automations.push({ id: 'mailed', trigger: 'letter_mailed', delayDays: 0, channel: 'email', subject: 'Your dispute letters were mailed', body: 'Hi', enabled: true, enabledAt: '2020-01-01' });
  assert.ok(!ctx.Automations.due(Store.state, '2026-11-19', {}).some(row => row.rule && row.rule.id === 'mailed' && row.client.id === 'held'));
  Store.state.clients.find(row => row.id === 'held').onboarding = { disclosureSignedAt: '2026-11-01', contractSignedAt: '2026-11-01', cancellationWindowEndsAt: '2026-11-10' };
  Store.state.signatures.push({ id: 'hd', clientId: 'held', doc: 'disclosure' }, { id: 'hc', clientId: 'held', doc: 'contract' });
  assert.ok(!ctx.Automations.due(Store.state, '2026-11-19', {}).some(row => row.rule && row.rule.id === 'mailed' && row.client.id === 'held'));
});

test('a held client can be sent a contract message, not a dispute result, and a gone portal login gets no mail', async () => {
  const out = [];
  setTransport(async message => { out.push(message); });
  try {
    await withOwner(async ({ built, owner, live }) => {
      await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-msg@guard.test', status: 'lead' });
      const heldIdentity = built.db.data.workspace.clients.find(row => row.id === 'held').identity;
      built.db.data.users.push({ id: 'held-portal', name: 'Held Client', email: 'held-msg@guard.test', role: 'client', clientId: 'held', clientIdentity: heldIdentity, password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-11-01T00:00:00.000Z', disabled: false });
      built.db.data.workspace.disputes = [{ id: 'due-d', clientId: 'held', recipient: 'Equifax', status: 'sent', sentAt: '2026-11-01', dueAt: new Date().toISOString().slice(0, 10), outcome: null, items: [] }];
      await built.auth.deadlineSweep();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.ok(!out.some(message => message.to === 'held-msg@guard.test'));
      const dispute = await owner('POST', '/api/messages', { clientId: 'held', channel: 'email', subject: 'Your dispute letters were mailed', body: 'We mailed your dispute letters today.', purpose: 'dispute' });
      assert.strictEqual(dispute.status, 409, JSON.stringify(dispute.body));
      assert.match(dispute.body.error, /on hold/);
      const contract = await owner('POST', '/api/messages', { clientId: 'held', channel: 'email', subject: 'Your contract', body: 'Please sign your contract.', purpose: 'contract' });
      assert.strictEqual(contract.status, 409, JSON.stringify(contract.body));
      const allowed = await owner('POST', '/api/messages', { clientId: 'held', channel: 'email', template: 'contract-1679d' });
      assert.strictEqual(allowed.status, 409, JSON.stringify(allowed.body));
      assert.match(allowed.body.error, /blank fields/);
      const skipped = (await owner('GET', '/api/audit')).body.find(row => row.action === 'notify.skipped');
      assert.ok(skipped && skipped.actor === 'system:sweep');
      const disguised = [
        { channel: 'email', purpose: 'contract', body: 'Experian removed the account.' },
        { channel: 'email', purpose: 'CONTRACT', body: 'Experian removed the account.' },
        { channel: 'email', purpose: 'onboarding', body: 'Experian removed X' },
        { channel: 'sms', purpose: 'contract', body: 'Equifax deleted the tradeline.' },
        { channel: 'email', purpose: '', body: 'We sent your letters to Experian. Contract attached.' }
      ];
      for (const row of disguised) {
        const sent = await owner('POST', '/api/messages', { clientId: 'held', channel: row.channel, subject: 'Your contract', body: row.body, purpose: row.purpose });
        assert.strictEqual(sent.status, 409, JSON.stringify(sent.body));
        assert.match(sent.body.error, /on hold/);
      }
      const portal = live.client();
      assert.strictEqual((await portal('POST', '/api/login', { email: 'held-msg@guard.test', password: 'portal password 1' })).status, 200);
      assert.strictEqual((await portal('GET', '/api/portal/me')).status, 200);
      for (const row of built.db.data.workspace.disputes || []) {
        row.status = 'draft';
        row.sentAt = null;
        row.sentDate = null;
        row.serverSentAt = null;
      }
      const before = await owner('GET', '/api/workspace');
      const drop = JSON.parse(JSON.stringify(before.body.data));
      drop.clients = drop.clients.filter(row => row.id !== 'held');
      drop.disputes = [];
      const removed = await owner('PUT', '/api/workspace', { baseVersion: before.body.version, data: drop });
      assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
      const user = built.db.data.users.find(row => row.id === 'held-portal');
      assert.strictEqual(user.disabled, false);
      const audit = await owner('GET', '/api/audit');
      assert.ok(!audit.body.some(row => row.action === 'portal.user.disabled'));
      assert.strictEqual((await portal('GET', '/api/portal/me')).status, 404);
      const back = await owner('GET', '/api/workspace');
      const again = JSON.parse(JSON.stringify(back.body.data));
      again.clients.push({ id: 'held', name: 'Held Client', kind: 'personal', email: 'held-msg@guard.test', status: 'lead' });
      const restored = await owner('PUT', '/api/workspace', { baseVersion: back.body.version, data: again });
      assert.strictEqual(restored.status, 200, JSON.stringify(restored.body));
      assert.strictEqual(built.db.data.users.find(row => row.id === 'held-portal').disabled, false);
      assert.notStrictEqual(restored.body.data.clients.find(row => row.id === 'held').identity, user.clientIdentity);
      assert.strictEqual((await portal('GET', '/api/portal/me')).status, 404);
      const forgot = await portal('POST', '/api/auth/forgot', { email: 'held-msg@guard.test' });
      assert.strictEqual(forgot.status, 200);
      assert.ok(!out.some(message => /reset/i.test(message.subject || '') || /held-msg@guard.test/.test(message.to || '')));
      const linked = await owner('POST', '/api/clients/held/portal-link', { email: 'held-msg@guard.test' });
      assert.strictEqual(linked.status, 200, JSON.stringify(linked.body));
      assert.strictEqual((await portal('GET', '/api/portal/me')).status, 200);
      seedSignedClient(built.db.data.workspace, 'held');
      await built.auth.deadlineSweep();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.ok(!out.some(message => message.to === 'held-msg@guard.test'));
    });
  } finally {
    setTransport(null);
  }
});

test('a deletion recorded during a hold is not billed until the contract is clear', () => {
  const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Set, Map, Error, URLSearchParams, crypto, navigator: {} };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.top = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  const root = path.join(import.meta.dirname, '../js');
  for (const file of ['law.js', 'store.js', 'billing.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  const Store = ctx.Store;
  Store.load();
  Store.adopt({
    version: 2,
    settings: { billing: { model: 'per_delete', perDelete: 50 } },
    clients: [{ id: 'held', name: 'Held', kind: 'personal', status: 'lead', onboarding: {} }],
    disputes: [{ id: 'd', clientId: 'held', type: 'cra_611', recipient: 'Equifax', sentAt: '2026-11-01', outcome: 'deleted', respondedAt: '2026-11-18', items: [{ creditor: 'North Bank', result: 'deleted', resultAt: '2026-11-18' }] }, { id: 'gone', clientId: 'missing', type: 'cra_611', recipient: 'Experian', sentAt: '2026-11-01', outcome: 'deleted', respondedAt: '2026-11-18', items: [{ creditor: 'South Bank', result: 'deleted', resultAt: '2026-11-18' }] }],
    invoices: []
  });
  assert.strictEqual(ctx.Billing.due(Store.state, '2026-11-19').length, 0);
  Store.state.clients[0].onboarding = { disclosureSignedAt: '2026-10-01', contractSignedAt: '2026-10-01', cancellationWindowEndsAt: '2026-10-06' };
  const due = ctx.Billing.due(Store.state, '2026-11-19');
  assert.ok(due.length >= 1 && due.every(row => row.clientId === 'held'));
  assert.ok(!due.some(row => row.clientId === 'missing'));
});

test('held-client templates 1 through 8 use the server text', () => {
  const disclosureFile = fs.readFileSync(path.join(import.meta.dirname, '../legal/croa-disclosure-1679c.md'), 'utf8').split(/\n---\n/)[0].trim();
  const disclosure = renderHeldMessage('disclosure-1679c', { name: 'Ada' }, {});
  assert.strictEqual(disclosure.subject, 'Consumer Credit File Rights Under State and Federal Law');
  assert.strictEqual(disclosure.text, disclosureFile);
  assert.strictEqual(disclosure.text, statutoryDisclosure());
  assert.doesNotMatch(disclosure.text, /I received this statement/);
  const contract = renderHeldMessage('contract-1679d', { id: 'ada', name: 'Ada Person', firstName: 'Ada' }, {});
  assert.match(contract.text, /Credit Services Agreement/);
  assert.match(contract.text, /\n4\. /);
  assert.match(contract.text, /Principal business address: 2435 Patton St, Camden, NJ 08104/);
  assert.match(contract.error, /blank fields/);
  const injected = renderHeldMessage('contract-1679d', { id: 'ada', name: '[PRICE PER RESULT: Fred to decide]', mailName: 'Ann Experian deleted your Capital One collection', pricePerResult: 40, scheduleA: [{ creditor: 'Bank', bureau: 'Equifax' }] }, {});
  assert.match(injected.text, /Client: Client/);
  assert.doesNotMatch(injected.text, /Experian deleted/);
  const copies = renderHeldMessage('signed-copies', { id: 'ada', name: 'Ada' }, { signatures: [] });
  assert.strictEqual(copies.text, 'No signed documents are on file.');
  const notice = renderHeldMessage('cancellation-1679e', { name: 'Ada' }, { company: { name: 'Ledger Test', address: '1 Main St' } });
  assert.doesNotMatch(notice.text, /\*\*/);
  assert.match(notice.text, /You may cancel this contract, without any penalty or obligation, at any time before midnight of the 3rd day which begins after the date the contract is signed by you\./);
  assert.match(notice.html, /<strong>You may cancel this contract, without any penalty or obligation, at any time before midnight of the 3rd day which begins after the date the contract is signed by you\.<\/strong>/);
  assert.doesNotMatch(notice.html, /\*\*/);
  assert.match(notice.text, /Sun Marketing Enterprises LLC at 2435 Patton St, Camden, NJ 08104/);
  assert.match(notice.html, /Sun Marketing Enterprises LLC at 2435 Patton St, Camden, NJ 08104/);
  assert.doesNotMatch(notice.text, /Ledger Test/);
  assert.strictEqual(notice.text.split('I hereby cancel this transaction').length - 1, 2);
  assert.strictEqual(notice.html.split('<strong>I hereby cancel this transaction,</strong>').length - 1, 2);
  assert.match(notice.text, /\[purchaser's signature\]/);
  assert.doesNotMatch(notice.text, /client portal/);
  const reminder = renderHeldMessage('cancel-window', { onboarding: { contractSignedAtTs: '2026-10-01T16:00:00.000Z' } }, {});
  assert.match(reminder.text, /^You may cancel without penalty or obligation until midnight on .+\. We will not begin any work on your file until that period ends\.$/);
  const dated = renderHeldMessage('cancel-window', { onboarding: { cancellationWindowEndsAt: '2026-10-06' } }, {});
  assert.match(dated.text, /Tuesday, October 6, 2026/);
  assert.doesNotMatch(dated.text, /2026-10-06/);
  const confirmed = renderHeldMessage('cancellation-confirmed', { id: 'ada', onboarding: { cancelledAt: '2026-10-03', cancellationTimely: true } }, { invoices: [{ id: 'i', clientId: 'ada', status: 'paid', amount: 40 }] });
  assert.match(confirmed.text, /We received your cancellation\. Your contract is cancelled as of Saturday, October 3, 2026\. The cancellation was timely\. We confirm a refund of \$40\.00 for a payment taken under the contract\./);
  const utcCut = renderHeldMessage('cancellation-confirmed', { id: 'ada', onboarding: { cancelledAt: '2026-10-04T02:30:00.000Z', cancellationTimely: false } }, {});
  assert.match(utcCut.text, /Saturday, October 3, 2026/);
  assert.doesNotMatch(utcCut.text, /2026-10-04/);
  const late = renderHeldMessage('cancellation-confirmed', { id: 'ada', onboarding: { cancelledAt: '2026-10-09', cancellationTimely: false } }, { invoices: [{ id: 'i', clientId: 'ada', status: 'paid', amount: 40 }] });
  assert.match(late.text, /The cancellation was late\./);
  assert.doesNotMatch(late.text, /refund/);
  for (const admin of ['invite', 'login', 'reset', 'verify']) {
    const adminMsg = renderHeldMessage('account-admin', { name: 'Ada' }, { admin, link: 'https://ledger.test/portal#invite=server' });
    assert.match(adminMsg.text, /https:\/\/ledger\.test\/portal#invite=server/);
    assert.match(adminMsg.text, /This message does not include anything from your file/);
    assert.doesNotMatch(adminMsg.text, /credit report|bureau|dispute|score/i);
  }
  assert.match(renderHeldMessage('account-admin', { name: 'Ada' }, { admin: 'login' }).error, /account link/);
  assert.strictEqual(renderHeldMessage('postmark-review', {}, { outcome: 'timely' }).text, 'The postmark review is complete. The cancellation is timely.');
  assert.strictEqual(renderHeldMessage('postmark-review', {}, { outcome: 'late' }).text, 'The postmark review is complete. The cancellation is late.');
});

test('a held client can be sent each allowlisted template and nothing else', async () => {
  await withOwner(async ({ owner }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-tpl@guard.test', phone: '5550100', status: 'lead', smsConsent: true });
    const allowed = [
      ['disclosure-1679c', {}],
      ['contract-1679d', {}],
      ['signed-copies', {}],
      ['cancellation-1679e', {}],
      ['cancel-window', {}],
      ['cancellation-confirmed', {}],
      ['account-admin', { admin: 'invite' }],
      ['postmark-review', { outcome: 'timely' }]
    ];
    for (const [template, extra] of allowed) {
      for (const channel of ['email', 'sms']) {
        const sent = await owner('POST', '/api/messages', Object.assign({ clientId: 'held', channel, template }, extra));
        if ((template === 'disclosure-1679c' || template === 'cancellation-1679e') && channel === 'sms') {
          assert.strictEqual(sent.status, 409, template + ' sms ' + JSON.stringify(sent.body));
          assert.match(sent.body.error, /email or the portal/);
        } else if (template === 'contract-1679d') {
          assert.strictEqual(sent.status, 409, template + ' ' + channel + ' ' + JSON.stringify(sent.body));
          assert.match(sent.body.error, /blank fields/);
        } else {
          assert.strictEqual(sent.status, 501, template + ' ' + channel + ' ' + JSON.stringify(sent.body));
        }
      }
    }
    const refused = [
      ['free text', { channel: 'email', subject: 'Hello', body: 'Please call me.' }],
      ['credit report', { channel: 'email', body: 'Please upload your credit report.' }],
      ['account', { channel: 'email', body: 'The account was taken off your credit report.' }],
      ['bureau', { channel: 'email', body: 'Equifax verified the tradeline.' }],
      ['dispute', { channel: 'email', body: 'We mailed your dispute letters today.' }],
      ['letter', { channel: 'email', body: 'Your letters went out.' }],
      ['result', { channel: 'email', body: 'the collection came off your file' }],
      ['score', { channel: 'email', body: 'your score went up 40 points after round 1' }],
      ['deletion', { channel: 'email', body: 'the tradeline was deleted' }],
      ['plan', { channel: 'email', body: 'Here is your plan for round 1.' }],
      ['invoice', { channel: 'email', body: 'Your invoice is ready.' }],
      ['payment link', { channel: 'email', body: 'Pay here: https://pay.example.test/invoice' }],
      ['credit monitoring', { channel: 'email', body: 'Enroll in credit monitoring with this affiliate link.' }],
      ['id request', { channel: 'email', template: 'docs', body: 'Please upload a photo ID and proof of address.' }],
      ['report template', { channel: 'email', template: 'report' }],
      ['marketing', { channel: 'email', body: 'Refer a friend and get a discount.' }],
      ['purpose bypass', { channel: 'email', purpose: 'contract', body: 'Please sign your contract.' }],
      ['purpose onboarding', { channel: 'email', purpose: 'onboarding', body: 'Credit report needed' }],
      ['text with template', { channel: 'email', template: 'cancel-window', subject: 'Hi', body: 'Your score went up.' }],
      ['sms result', { channel: 'sms', body: 'TU and EQ responded' }],
      ['obfuscated', { channel: 'email', body: 'Exp\u0435rian r\u0435moved the account.' }]
    ];
    for (const [name, body] of refused) {
      const sent = await owner('POST', '/api/messages', Object.assign({ clientId: 'held' }, body));
      assert.strictEqual(sent.status, 409, name + ' ' + JSON.stringify(sent.body));
    }
  });
});

test('a deletion recorded during the hold and a dispute mailed before the contract cannot be invoiced', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'bill', name: 'Bea Bill', kind: 'personal', email: 'hold-bill@guard.test', status: 'active', pricePerResult: 20 });
    seedSignedClient(built.db.data.workspace, 'bill', { onboarding: { disclosureSignedAt: '2026-10-01', disclosureAcknowledgedAt: '2026-10-01T15:00:00.000Z', contractSignedAt: '2026-10-01', contractSignedAtTs: '2026-10-01T16:00:00.000Z', cancellationWindowEndsAt: '2026-10-06', cancellationWindowEndsAtTs: '2026-10-07T03:59:59.999Z' } });
    const open = await owner('GET', '/api/workspace');
    open.body.data.disputes = [{ id: 'during', clientId: 'bill', status: 'draft', items: [{ id: 'di', creditor: 'Held Bank', bureau: 'Equifax' }] }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: open.body.version, data: open.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/clients/bill/cancel', { method: 'email', receivedAt: '2026-10-04' })).status, 200);
    const held = await owner('GET', '/api/workspace');
    held.body.data.disputes.find(d => d.id === 'during').items[0].result = 'deleted';
    held.body.data.disputes.find(d => d.id === 'during').items[0].bureauResultAt = '2026-10-04';
    const recorded = await owner('PUT', '/api/workspace', { baseVersion: held.body.version, data: held.body.data });
    assert.strictEqual(recorded.status, 200, JSON.stringify(recorded.body));
    built.db.data.workspace.clients.find(c => c.id === 'bill').onboarding.cancelledAt = null;
    built.db.data.workspace.clients.find(c => c.id === 'bill').onboarding.cancelledAtTs = null;
    built.db.data.workspace.clients.find(c => c.id === 'bill').status = 'active';
    const after = await owner('GET', '/api/workspace');
    const during = JSON.parse(JSON.stringify(after.body.data));
    during.disputes.find(d => d.id === 'during').items[0].bureauResultAt = '2026-11-18';
    during.disputes.find(d => d.id === 'during').sentAt = '2026-11-01';
    during.invoices = [{ id: 'hold-inv', clientId: 'bill', disputeId: 'during', itemId: 'di', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2026-11-18', serviceCompletedAt: '2026-11-18', bureauResultAt: '2026-11-18' }];
    const heldBill = await owner('PUT', '/api/workspace', { baseVersion: after.body.version, data: during });
    assert.strictEqual(heldBill.status, 409, JSON.stringify(heldBill.body));
    assert.match(heldBill.body.error, /after the cancellation window/);
    assert.ok(after.body.data.heldOutcomes.some(row => row.key === 'bill\nequifax' && row.onHold));
    const current = await owner('GET', '/api/workspace');
    const renamed = JSON.parse(JSON.stringify(current.body.data));
    renamed.disputes.find(d => d.id === 'during').items[0].id = 'di-renamed';
    const rename = await owner('PUT', '/api/workspace', { baseVersion: current.body.version, data: renamed });
    assert.strictEqual(rename.status, 409, JSON.stringify(rename.body));
    assert.match(rename.body.error, /cannot change its id/);
    const dated = await owner('GET', '/api/workspace');
    const addDate = JSON.parse(JSON.stringify(dated.body.data));
    addDate.disputes.find(d => d.id === 'during').items[0].bureauResultAt = '2099-06-01';
    delete addDate.disputes.find(d => d.id === 'during').items[0].serverResultAt;
    const stillHeld = await owner('PUT', '/api/workspace', { baseVersion: dated.body.version, data: addDate });
    assert.strictEqual(stillHeld.status, 200, JSON.stringify(stillHeld.body));
    const kept = stillHeld.body.data.disputes.find(d => d.id === 'during').items[0];
    assert.strictEqual(kept.resultRecordedOnHold, true);
    assert.strictEqual(kept.serverResultAt, '2026-10-04');
    const sent = await owner('GET', '/api/workspace');
    const mailed = JSON.parse(JSON.stringify(sent.body.data));
    mailed.disputes.push({ id: 'before', clientId: 'bill', status: 'sent', sentAt: '2026-09-01', items: [{ id: 'bi', creditor: 'Early Bank', bureau: 'Experian', result: 'deleted', bureauResultAt: '2026-09-01' }] });
    const mailedSave = await owner('PUT', '/api/workspace', { baseVersion: sent.body.version, data: mailed });
    assert.strictEqual(mailedSave.status, 200, JSON.stringify(mailedSave.body));
    const stampedSend = mailedSave.body.data.disputes.find(d => d.id === 'before');
    assert.strictEqual(stampedSend.serverSentAt, todayEt());
    assert.strictEqual(stampedSend.sentAt, '2026-09-01');
    assert.strictEqual(stampedSend.items[0].serverResultAt, '2026-09-01');
    const edited = await owner('GET', '/api/workspace');
    const moved = JSON.parse(JSON.stringify(edited.body.data));
    const early = moved.disputes.find(d => d.id === 'before');
    early.sentAt = null;
    early.sentDate = '2099-06-01';
    const movedSave = await owner('PUT', '/api/workspace', { baseVersion: edited.body.version, data: moved });
    assert.strictEqual(movedSave.status, 409, JSON.stringify(movedSave.body));
    assert.match(movedSave.body.error, /mailed date cannot be changed/);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.disputes.find(d => d.id === 'before').sentAt, '2026-09-01');
    assert.ok(!(await owner('GET', '/api/workspace')).body.data.invoices.some(row => row.id === 'hold-inv'));
  });
});

test('a stored dispute that cites a held client report cannot be mailed, and that client cannot be deleted', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'ada', name: 'Ada File', kind: 'personal', email: 'ada-file@guard.test', status: 'active' });
    await addClient(owner, { id: 'ben', name: 'Ben Clear', kind: 'personal', email: 'ben-clear@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'ada');
    seedSignedClient(built.db.data.workspace, 'ben');
    const g = await owner('GET', '/api/workspace');
    g.body.data.reports = [{ id: 'rep-a', clientId: 'ada', bureau: 'Equifax', date: '2026-06-01', accounts: [{ id: 'acct-a', creditor: 'Held Bank' }] }];
    g.body.data.disputes = [{ id: 'd-ben', clientId: 'ben', reportId: 'rep-a', status: 'draft', items: [{ creditor: 'Held Bank', accountId: 'acct-a' }], notes: 'stored' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/clients/ada/cancel', { method: 'email', receivedAt: todayEt() })).status, 200);
    const mailed = await owner('GET', '/api/workspace');
    mailed.body.data.disputes.find(row => row.id === 'd-ben').status = 'sent';
    mailed.body.data.disputes.find(row => row.id === 'd-ben').sentAt = '2026-11-01';
    const send = await owner('PUT', '/api/workspace', { baseVersion: mailed.body.version, data: mailed.body.data });
    assert.strictEqual(send.status, 409, JSON.stringify(send.body));
    const lettered = await owner('GET', '/api/workspace');
    lettered.body.data.letters = [{ id: 'l-ben', clientId: 'ben', disputeId: 'd-ben', status: 'draft', text: 'Please review this account.' }];
    const letter = await owner('PUT', '/api/workspace', { baseVersion: lettered.body.version, data: lettered.body.data });
    assert.strictEqual(letter.status, 409, JSON.stringify(letter.body));
    const noted = await owner('GET', '/api/workspace');
    noted.body.data.disputes.find(row => row.id === 'd-ben').notes = 'still stored';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: noted.body.version, data: noted.body.data })).status, 200);
    const reportOnly = await owner('GET', '/api/workspace');
    reportOnly.body.data.reports = [];
    const reportGone = await owner('PUT', '/api/workspace', { baseVersion: reportOnly.body.version, data: reportOnly.body.data });
    assert.strictEqual(reportGone.status, 409, JSON.stringify(reportGone.body));
    assert.match(reportGone.body.error, /cites this report/);
    const drop = await owner('GET', '/api/workspace');
    drop.body.data.clients = drop.body.data.clients.filter(row => row.id !== 'ada');
    drop.body.data.reports = [];
    const refused = await owner('PUT', '/api/workspace', { baseVersion: drop.body.version, data: drop.body.data });
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.body));
    assert.match(refused.body.error, /dispute d-ben/);
    const gone = await owner('GET', '/api/workspace');
    gone.body.data.clients = gone.body.data.clients.filter(row => row.id !== 'ada');
    gone.body.data.reports = [];
    gone.body.data.disputes = gone.body.data.disputes.filter(row => row.id !== 'd-ben');
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: gone.body.version, data: gone.body.data })).status, 200);
  });
});

test('startup migration binds existing logins, and a stale save cannot restore a deleted client', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-migrate-'));
  const boot = { dataDir: dir, encryptionKey: 'guard-key-not-a-secret-00', selfSignupEnabled: false, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } };
  const first = createApp(boot);
  const live = listen(first.app);
  const owner = live.client();
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@guard.test', password: 'owner password 1' })).status, 200);
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada@guard.test', status: 'lead' });
    await addClient(owner, { id: 'bea', name: 'Bea', kind: 'personal', email: 'bea@guard.test', status: 'lead' });
    first.db.data.users.push({ id: 'ada-login', name: 'Ada', email: 'ada@guard.test', role: 'client', clientId: 'ada', password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-01-01T00:00:00.000Z' });
    for (const row of first.db.data.workspace.clients) delete row.identity;
    delete first.db.data.portalIdentityMigration;
    first.db.data.audit = first.db.data.audit.filter(row => row.action !== 'portal.identity.migrate');
    first.db.persist();
  } finally {
    live.server.close();
    first.shutdown();
  }
  const second = createApp(boot);
  try {
    const ada = second.db.data.workspace.clients.find(row => row.id === 'ada');
    const login = second.db.data.users.find(row => row.email === 'ada@guard.test');
    assert.ok(ada.identity);
    assert.strictEqual(login.clientIdentity, ada.identity);
    assert.strictEqual(second.db.data.audit.filter(row => row.action === 'portal.identity.migrate').length, 1);
    assert.strictEqual(second.db.data.audit.find(row => row.action === 'portal.identity.migrate').actor, 'system:migrate');
  } finally { second.shutdown(); }
  const third = createApp(boot);
  const live3 = listen(third.app);
  const owner3 = live3.client();
  try {
    assert.strictEqual(third.db.data.audit.filter(row => row.action === 'portal.identity.migrate').length, 1);
    assert.strictEqual((await owner3('POST', '/api/login', { email: 'owner@guard.test', password: 'owner password 1' })).status, 200);
    const before = await owner3('GET', '/api/workspace');
    const swapped = JSON.parse(JSON.stringify(before.body.data));
    const ada = swapped.clients.find(row => row.id === 'ada');
    const bea = swapped.clients.find(row => row.id === 'bea');
    ada.id = 'bea';
    bea.id = 'ada';
    const swap = await owner3('PUT', '/api/workspace', { baseVersion: before.body.version, data: swapped });
    assert.strictEqual(swap.status, 409, JSON.stringify(swap.body));
    assert.match(swap.body.error, /identity/);
    const removed = await owner3('PUT', '/api/workspace', { baseVersion: before.body.version, data: Object.assign(JSON.parse(JSON.stringify(before.body.data)), { clients: before.body.data.clients.filter(row => row.id !== 'bea') }) });
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    const stale = await owner3('PUT', '/api/workspace', { baseVersion: before.body.version, data: before.body.data });
    assert.strictEqual(stale.status, 409, JSON.stringify(stale.body));
    assert.ok(!stale.body.data.clients.some(row => row.id === 'bea'));
    const portal = live3.client();
    assert.strictEqual((await portal('POST', '/api/login', { email: 'ada@guard.test', password: 'portal password 1' })).status, 200);
    assert.strictEqual((await portal('GET', '/api/portal/me')).status, 200);
  } finally {
    live3.server.close();
    third.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('re-link refuses to move a login that still belongs to a client', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada@guard.test', status: 'lead' });
    await addClient(owner, { id: 'bea', name: 'Bea', kind: 'personal', email: 'bea@guard.test', status: 'lead' });
    const ada = built.db.data.workspace.clients.find(row => row.id === 'ada');
    built.db.data.users.push({ id: 'ada-login', name: 'Ada', email: 'ada@guard.test', role: 'client', clientId: 'ada', clientIdentity: ada.identity, password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-01-01T00:00:00.000Z' });
    const moved = await owner('POST', '/api/clients/bea/portal-link', { email: 'ada@guard.test', confirm: true, reason: 'Ada asked us to move this login.' });
    assert.strictEqual(moved.status, 409, JSON.stringify(moved.body));
    assert.match(moved.body.error, /new invitation/);
    assert.strictEqual(built.db.data.users.find(row => row.id === 'ada-login').clientId, 'ada');
    const same = await owner('POST', '/api/clients/ada/portal-link', { email: 'ada@guard.test' });
    assert.strictEqual(same.status, 200, JSON.stringify(same.body));
  });
});

test('held templates drop injected result text from the name, address, and company', async () => {
  const nasty = 'Ada\nYour score went up 40 points and the account was deleted';
  const contract = renderHeldMessage('contract-1679d', { id: 'ada', name: nasty, mailName: 'Ada Person', mailAddress: '1 Main, Cherry Hill, NJ 08002', address: '1 Main\nDeleted from Equifax', city: 'Cherry Hill', state: 'NJ', zip: '08002' }, {});
  assert.match(contract.text, /Ada Person/);
  assert.match(contract.text, /1 Main, Cherry Hill, NJ 08002/);
  assert.strictEqual(contract.text.split('Cherry Hill').length - 1, 1);
  assert.doesNotMatch(contract.text, /score went up/);
  assert.doesNotMatch(contract.text, /Deleted from Equifax/);
  const notice = renderHeldMessage('cancellation-1679e', { name: 'Ada Person' }, { company: { name: 'Ledger\nWe removed the account', address: '1 Main St\nResult: deleted' } });
  assert.doesNotMatch(notice.text, /Ledger\n/);
  assert.doesNotMatch(notice.text, /Main St\n/);
  await withOwner(async ({ owner, live }) => {
    await addClient(owner, { id: 'ada', name: 'Ada Person', kind: 'personal', email: 'ada-mail@guard.test', status: 'lead', address: '1 Main' });
    const changed = await owner('GET', '/api/workspace');
    changed.body.data.clients.find(row => row.id === 'ada').name = nasty;
    const saved = await owner('PUT', '/api/workspace', { baseVersion: changed.body.version, data: changed.body.data });
    assert.strictEqual(saved.status, 409, JSON.stringify(saved.body));
    assert.match(saved.body.error, /credit-file wording/);
    const kept = await owner('GET', '/api/workspace');
    assert.strictEqual(kept.body.data.clients.find(row => row.id === 'ada').mailName, 'Ada Person');
    kept.body.data.clients.find(row => row.id === 'ada').name = 'Ada Q Public';
    const renamed = await owner('PUT', '/api/workspace', { baseVersion: kept.body.version, data: kept.body.data });
    assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.body));
    assert.strictEqual(renamed.body.data.clients.find(row => row.id === 'ada').mailName, 'Ada Q Public');
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-co@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const book = await staff('GET', '/api/workspace');
    book.body.data.settings = book.body.data.settings || {};
    book.body.data.settings.company = Object.assign({}, book.body.data.settings.company, { name: 'We deleted the account' });
    const denied = await staff('PUT', '/api/workspace', { baseVersion: book.body.version, data: book.body.data });
    assert.strictEqual(denied.status, 403, JSON.stringify(denied.body));
  });
});

test('a held outcome stays with the account when the item id changes, and a wrong bureau cannot be billed', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'bill', name: 'Bea Bill', kind: 'personal', email: 'acct-bill@guard.test', status: 'active', pricePerResult: 20 });
    seedSignedClient(built.db.data.workspace, 'bill', { onboarding: { disclosureSignedAt: '2026-10-01', disclosureAcknowledgedAt: '2026-10-01T15:00:00.000Z', contractSignedAt: '2026-10-01', contractSignedAtTs: '2026-10-01T16:00:00.000Z', cancellationWindowEndsAt: '2026-10-06', cancellationWindowEndsAtTs: '2026-10-07T03:59:59.999Z' } });
    const open = await owner('GET', '/api/workspace');
    open.body.data.disputes = [{ id: 'old', clientId: 'bill', status: 'draft', items: [{ id: 'one', creditor: 'Held Bank', bureau: 'Equifax' }] }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: open.body.version, data: open.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/clients/bill/cancel', { method: 'email', receivedAt: '2026-10-04' })).status, 200);
    const held = await owner('GET', '/api/workspace');
    held.body.data.disputes.find(d => d.id === 'old').items[0].result = 'corrected';
    held.body.data.disputes.find(d => d.id === 'old').items[0].bureauResultAt = '2026-10-04';
    const recorded = await owner('PUT', '/api/workspace', { baseVersion: held.body.version, data: held.body.data });
    assert.strictEqual(recorded.status, 200, JSON.stringify(recorded.body));
    built.db.data.workspace.clients.find(c => c.id === 'bill').onboarding.cancelledAt = null;
    built.db.data.workspace.clients.find(c => c.id === 'bill').onboarding.cancelledAtTs = null;
    const after = await owner('GET', '/api/workspace');
    const next = JSON.parse(JSON.stringify(after.body.data));
    next.disputes = [{ id: 'fresh', clientId: 'bill', status: 'sent', sentAt: '2026-11-02', items: [{ id: 'two', creditor: 'Held Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2026-11-18' }] }];
    next.invoices = [{ id: 'wrong', clientId: 'bill', disputeId: 'fresh', itemId: 'two', bureau: 'Experian', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2026-11-18', serviceCompletedAt: '2026-11-18' }];
    const billed = await owner('PUT', '/api/workspace', { baseVersion: after.body.version, data: next });
    assert.strictEqual(billed.status, 409, JSON.stringify(billed.body));
    assert.match(billed.body.error, /does not match the deleted item/);
    const current = await owner('GET', '/api/workspace');
    const sameBureau = JSON.parse(JSON.stringify(current.body.data));
    sameBureau.disputes = [{ id: 'fresh', clientId: 'bill', status: 'sent', sentAt: '2026-11-02', items: [{ id: 'two', creditor: 'Held Bank', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2026-11-18' }] }];
    sameBureau.invoices = [{ id: 'right', clientId: 'bill', disputeId: 'fresh', itemId: 'two', bureau: 'Equifax', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2026-11-18', serviceCompletedAt: '2026-11-18' }];
    const still = await owner('PUT', '/api/workspace', { baseVersion: current.body.version, data: sameBureau });
    assert.strictEqual(still.status, 409, JSON.stringify(still.body));
    assert.match(still.body.error, /recorded while the client was on hold/);
  });
});

test('a stored letter that cites a held report cannot be edited or sent, even if the citation is removed in the same save', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'ada', name: 'Ada File', kind: 'personal', email: 'ada-letter@guard.test', status: 'active' });
    await addClient(owner, { id: 'ben', name: 'Ben Clear', kind: 'personal', email: 'ben-letter@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'ada');
    seedSignedClient(built.db.data.workspace, 'ben');
    const g = await owner('GET', '/api/workspace');
    g.body.data.reports = [{ id: 'rep-a', clientId: 'ada', bureau: 'Equifax', date: '2026-06-01', accounts: [{ id: 'acct-a', creditor: 'Held Bank' }] }];
    g.body.data.disputes = [{ id: 'd-ben', clientId: 'ben', reportId: 'rep-a', status: 'draft', items: [{ creditor: 'Held Bank', accountId: 'acct-a' }] }];
    g.body.data.letters = [{ id: 'l-ben', clientId: 'ben', disputeId: 'd-ben', reportId: 'rep-a', status: 'draft', text: 'Please review this account.' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/clients/ada/cancel', { method: 'email', receivedAt: todayEt() })).status, 200);
    const edited = await owner('GET', '/api/workspace');
    const letter = edited.body.data.letters.find(row => row.id === 'l-ben');
    letter.text = 'We mailed this today.';
    letter.status = 'sent';
    letter.sentAt = '2026-11-18';
    const send = await owner('PUT', '/api/workspace', { baseVersion: edited.body.version, data: edited.body.data });
    assert.strictEqual(send.status, 409, JSON.stringify(send.body));
    const cleared = await owner('GET', '/api/workspace');
    const dispute = cleared.body.data.disputes.find(row => row.id === 'd-ben');
    dispute.reportId = '';
    dispute.items = [{ creditor: 'Held Bank' }];
    dispute.status = 'sent';
    dispute.sentAt = '2026-11-18';
    const same = await owner('PUT', '/api/workspace', { baseVersion: cleared.body.version, data: cleared.body.data });
    assert.strictEqual(same.status, 409, JSON.stringify(same.body));
  });
});

test('a staff save on a held client records a skipped notice', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'ada', name: 'Ada Hold', kind: 'personal', email: 'ada-skip@guard.test', status: 'active', pricePerResult: 20 });
    seedSignedClient(built.db.data.workspace, 'ada', { onboarding: { disclosureSignedAt: '2026-10-01', disclosureAcknowledgedAt: '2026-10-01T15:00:00.000Z', contractSignedAt: '2026-10-01', contractSignedAtTs: '2026-10-01T16:00:00.000Z', cancellationWindowEndsAt: '2026-10-06', cancellationWindowEndsAtTs: '2026-10-07T03:59:59.999Z' } });
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-skip@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const open = await owner('GET', '/api/workspace');
    open.body.data.disputes = [{ id: 'd1', clientId: 'ada', recipient: 'Equifax', status: 'draft', items: [{ creditor: 'North Bank' }] }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: open.body.version, data: open.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/clients/ada/cancel', { method: 'email', receivedAt: '2026-10-04' })).status, 200);
    const book = await staff('GET', '/api/workspace');
    book.body.data.disputes.find(row => row.id === 'd1').items[0].result = 'deleted';
    const saved = await staff('PUT', '/api/workspace', { baseVersion: book.body.version, data: book.body.data });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const audit = await owner('GET', '/api/audit');
    assert.ok(audit.body.some(row => row.action === 'notify.skipped' && row.actor === 'staff-skip@guard.test' && /Good news on your credit file/.test(row.detail) && !/resp:/.test(row.detail)));
  });
});

test('a bureau hold survives spelling changes and dispute deletes until the owner clears it', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'bill', name: 'Bea Bill', kind: 'personal', email: 'spell-bill@guard.test', status: 'active', pricePerResult: 20 });
    seedSignedClient(built.db.data.workspace, 'bill', { onboarding: { disclosureSignedAt: '2026-10-01', disclosureAcknowledgedAt: '2026-10-01T15:00:00.000Z', contractSignedAt: '2026-10-01', contractSignedAtTs: '2026-10-01T16:00:00.000Z', cancellationWindowEndsAt: '2026-10-06', cancellationWindowEndsAtTs: '2026-10-07T03:59:59.999Z' } });
    const open = await owner('GET', '/api/workspace');
    open.body.data.disputes = [{ id: 'old', clientId: 'bill', status: 'sent', sentAt: '2026-11-01', recipient: 'Experian Information Solutions', items: [{ id: 'one', creditor: 'Hold Bank, N.A.', bureau: 'Experian Information Solutions' }] }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: open.body.version, data: open.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/clients/bill/cancel', { method: 'email', receivedAt: '2026-10-04' })).status, 200);
    const held = await owner('GET', '/api/workspace');
    held.body.data.disputes.find(d => d.id === 'old').outcome = 'deleted';
    const recorded = await owner('PUT', '/api/workspace', { baseVersion: held.body.version, data: held.body.data });
    assert.strictEqual(recorded.status, 200, JSON.stringify(recorded.body));
    assert.ok(recorded.body.data.heldOutcomes.some(row => row.key === 'bill\nexperian' && row.onHold));
    built.db.data.workspace.clients.find(c => c.id === 'bill').onboarding.cancelledAt = null;
    built.db.data.workspace.clients.find(c => c.id === 'bill').onboarding.cancelledAtTs = null;
    const after = await owner('GET', '/api/workspace');
    const oldDispute = JSON.parse(JSON.stringify(after.body.data.disputes.find(d => d.id === 'old')));
    const freshDispute = { id: 'fresh', clientId: 'bill', status: 'sent', sentAt: '2026-11-02', recipient: 'Experian', items: [{ id: 'two', creditor: 'HOLD BANK NA', accountNumber: 'xx1234', bureau: 'EXPERIAN', result: 'deleted', bureauResultAt: '2026-11-18' }] };
    const renamed = JSON.parse(JSON.stringify(after.body.data));
    renamed.disputes = [oldDispute, freshDispute];
    renamed.invoices = [{ id: 'spell', clientId: 'bill', disputeId: 'fresh', itemId: 'two', bureau: 'Experian', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2026-11-18', serviceCompletedAt: '2026-11-18' }];
    const blocked = await owner('PUT', '/api/workspace', { baseVersion: after.body.version, data: renamed });
    assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.body));
    assert.match(blocked.body.error, /recorded while the client was on hold/);
    const wiped = await owner('GET', '/api/workspace');
    const again = JSON.parse(JSON.stringify(wiped.body.data));
    again.disputes = again.disputes.filter(row => row.id !== 'old');
    const deleted = await owner('PUT', '/api/workspace', { baseVersion: wiped.body.version, data: again });
    assert.strictEqual(deleted.status, 409, JSON.stringify(deleted.body));
    assert.match(deleted.body.error, /cannot be deleted/);
    const restored = await owner('GET', '/api/workspace');
    const rebilled = JSON.parse(JSON.stringify(restored.body.data));
    rebilled.heldOutcomes = [];
    rebilled.disputes = [JSON.parse(JSON.stringify(restored.body.data.disputes.find(d => d.id === 'old'))), freshDispute];
    rebilled.invoices = renamed.invoices;
    const still = await owner('PUT', '/api/workspace', { baseVersion: restored.body.version, data: rebilled });
    assert.strictEqual(still.status, 409, JSON.stringify(still.body));
    assert.match(still.body.error, /recorded while the client was on hold/);
    const staff = live.client();
    const invite = await owner('POST', '/api/invites', { role: 'staff', name: 'Staff', email: 'staff-hold@guard.test' });
    assert.strictEqual((await staff('POST', '/api/invites/accept', { token: invite.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    assert.strictEqual((await staff('POST', '/api/clients/bill/bureau-hold/clear', { bureau: 'Experian', reason: 'Staff cannot clear this.' })).status, 403);
    const cleared = await owner('POST', '/api/clients/bill/bureau-hold/clear', { bureau: 'Experian Information Solutions', reason: 'The window mail was a test file.' });
    assert.strictEqual(cleared.status, 200, JSON.stringify(cleared.body));
    const audit = await owner('GET', '/api/audit');
    assert.ok(audit.body.some(row => row.action === 'bureau.hold.clear' && row.actor === 'owner@guard.test' && /test file/.test(row.detail)));
    const ready = await owner('GET', '/api/workspace');
    const bill = JSON.parse(JSON.stringify(ready.body.data));
    bill.disputes = [JSON.parse(JSON.stringify(ready.body.data.disputes.find(d => d.id === 'old'))), freshDispute];
    bill.invoices = renamed.invoices;
    const issued = await owner('PUT', '/api/workspace', { baseVersion: ready.body.version, data: bill });
    assert.strictEqual(issued.status, 200, JSON.stringify(issued.body));
  });
});

test('portal identity migration runs once, and a reused id does not inherit a login', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-migrate-once-'));
  const boot = { dataDir: dir, encryptionKey: 'guard-key-not-a-secret-00', selfSignupEnabled: false, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } };
  const first = createApp(boot);
  try {
    first.db.data.workspace = { clients: [{ id: 'ada', name: 'Bea', kind: 'personal', email: 'bea@guard.test', status: 'lead' }], disputes: [], letters: [], reports: [], invoices: [], signatures: [], settings: { company: {} } };
    first.db.data.users.push(
      { id: 'alice', name: 'Alice', email: 'alice@guard.test', role: 'client', clientId: 'ada', password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'match', name: 'Bea', email: 'bea@guard.test', role: 'client', clientId: 'ada', password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'gone', name: 'Gone', email: 'gone@guard.test', role: 'client', clientId: 'missing', password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-01-01T00:00:00.000Z' }
    );
    delete first.db.data.portalIdentityMigration;
    first.db.data.audit = (first.db.data.audit || []).filter(row => row.action !== 'portal.identity.migrate');
    first.db.persist();
  } finally { first.shutdown(); }
  const second = createApp(boot);
  try {
    const bea = second.db.data.workspace.clients.find(row => row.id === 'ada');
    const alice = second.db.data.users.find(row => row.id === 'alice');
    const match = second.db.data.users.find(row => row.id === 'match');
    const gone = second.db.data.users.find(row => row.id === 'gone');
    assert.ok(bea.identity);
    assert.strictEqual(bea.mailName, 'Bea');
    assert.strictEqual(match.clientIdentity, bea.identity);
    assert.ok(!alice.clientIdentity);
    assert.strictEqual(alice.portalLinkNeedsInvite, true);
    assert.ok(!gone.clientIdentity);
    assert.strictEqual(gone.portalLinkNeedsInvite, true);
    const detail = second.db.data.audit.find(row => row.action === 'portal.identity.migrate').detail;
    assert.match(detail, /alice@guard\.test/);
    assert.match(detail, /gone@guard\.test/);
    second.db.data.workspace.clients.push({ id: 'missing', name: 'New Person', kind: 'personal', email: 'gone@guard.test', status: 'lead', identity: 'reused-identity' });
    second.db.persist();
  } finally { second.shutdown(); }
  const third = createApp(boot);
  try {
    const gone = third.db.data.users.find(row => row.id === 'gone');
    const alice = third.db.data.users.find(row => row.id === 'alice');
    assert.ok(!gone.clientIdentity);
    assert.notStrictEqual(gone.clientIdentity, 'reused-identity');
    assert.ok(!alice.clientIdentity);
    assert.strictEqual(third.db.data.audit.filter(row => row.action === 'portal.identity.migrate').length, 1);
  } finally {
    third.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a client can delete a report that only their own letter cites', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'ada', name: 'Ada File', kind: 'personal', email: 'ada-own@guard.test', status: 'active' });
    seedSignedClient(built.db.data.workspace, 'ada');
    const g = await owner('GET', '/api/workspace');
    g.body.data.reports = [{ id: 'rep-a', clientId: 'ada', bureau: 'Equifax', date: '2026-06-01', accounts: [{ id: 'acct-a', creditor: 'Own Bank' }] }];
    g.body.data.letters = [{ id: 'l-ada', clientId: 'ada', reportId: 'rep-a', status: 'draft', text: 'Please review this account.' }];
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: g.body.version, data: g.body.data })).status, 200);
    const drop = await owner('GET', '/api/workspace');
    drop.body.data.reports = [];
    const saved = await owner('PUT', '/api/workspace', { baseVersion: drop.body.version, data: drop.body.data });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  });
});

test('an invite link uses the configured site address and is not stored', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'held', name: 'Held Client', kind: 'personal', email: 'held-link@guard.test', status: 'lead', phone: '5550101' });
    const sent = await owner('POST', '/api/messages', { clientId: 'held', channel: 'email', template: 'account-admin', admin: 'invite' });
    assert.strictEqual(sent.status, 501, JSON.stringify(sent.body));
    const audit = await owner('GET', '/api/audit');
    const row = audit.body.find(item => item.action === 'invite.create');
    assert.match(row.detail, /http:\/\/127\.0\.0\.1:4100/);
    assert.doesNotMatch(row.detail, new RegExp(':' + live.server.address().port + '(/|$)'));
    assert.doesNotMatch(JSON.stringify(built.db.data), /#invite=/);
  });
});

test('I4 and I5: dropping or swapping an identity is refused', async () => {
  await withOwner(async ({ built, owner, live }) => {
    await addClient(owner, { id: 'ada', name: 'Ada', kind: 'personal', email: 'ada@guard.test', status: 'lead' });
    await addClient(owner, { id: 'bea', name: 'Bea', kind: 'personal', email: 'bea@guard.test', status: 'lead' });
    const ada = built.db.data.workspace.clients.find(row => row.id === 'ada');
    const bea = built.db.data.workspace.clients.find(row => row.id === 'bea');
    built.db.data.users.push(
      { id: 'ada-login', name: 'Ada', email: 'ada@guard.test', role: 'client', clientId: 'ada', clientIdentity: ada.identity, password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'bea-login', name: 'Bea', email: 'bea@guard.test', role: 'client', clientId: 'bea', clientIdentity: bea.identity, password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-01-01T00:00:00.000Z' }
    );
    const current = await owner('GET', '/api/workspace');
    const changed = JSON.parse(JSON.stringify(current.body.data));
    changed.clients.find(row => row.id === 'ada').identity = changed.clients.find(row => row.id === 'bea').identity;
    const different = await owner('PUT', '/api/workspace', { baseVersion: current.body.version, data: changed });
    assert.strictEqual(different.status, 409, JSON.stringify(different.body));
    assert.match(different.body.error, /identity/);
    const again = await owner('GET', '/api/workspace');
    const swapped = JSON.parse(JSON.stringify(again.body.data));
    const adaRow = swapped.clients.find(row => row.id === 'ada');
    const beaRow = swapped.clients.find(row => row.id === 'bea');
    const adaBody = Object.assign({}, beaRow, { id: 'ada' });
    const beaBody = Object.assign({}, adaRow, { id: 'bea' });
    delete adaBody.identity;
    delete beaBody.identity;
    swapped.clients = swapped.clients.filter(row => row.id !== 'ada' && row.id !== 'bea').concat([adaBody, beaBody]);
    const missing = await owner('PUT', '/api/workspace', { baseVersion: again.body.version, data: swapped });
    assert.strictEqual(missing.status, 409, JSON.stringify(missing.body));
    assert.match(missing.body.error, /identity/);
    const adaPortal = live.client();
    assert.strictEqual((await adaPortal('POST', '/api/login', { email: 'ada@guard.test', password: 'portal password 1' })).status, 200);
    const me = await adaPortal('GET', '/api/portal/me');
    assert.strictEqual(me.status, 200, JSON.stringify(me.body));
    assert.strictEqual(me.body.client.name, 'Ada');
  });
});

test('G4 through G7 and K2: a mailed dispute cannot be deleted, and a typed mailed date is not the billing date', async () => {
  await withOwner(async ({ built, owner }) => {
    await addClient(owner, { id: 'bill', name: 'Bea Bill', kind: 'personal', email: 'mail-bill@guard.test', status: 'active', pricePerResult: 20 });
    seedSignedClient(built.db.data.workspace, 'bill');
    const open = await owner('GET', '/api/workspace');
    open.body.data.disputes = [{ id: 'sent-1', clientId: 'bill', status: 'sent', sentAt: '2020-06-01', items: [{ id: 'si', creditor: 'North Bank', accountNumber: '1234', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-06-01' }] }];
    const saved = await owner('PUT', '/api/workspace', { baseVersion: open.body.version, data: open.body.data });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const stamped = saved.body.data.disputes.find(d => d.id === 'sent-1');
    assert.strictEqual(stamped.serverSentAt, todayEt());
    assert.strictEqual(stamped.sentAt, '2020-06-01');
    const drop = await owner('GET', '/api/workspace');
    drop.body.data.disputes = [];
    const removed = await owner('PUT', '/api/workspace', { baseVersion: drop.body.version, data: drop.body.data });
    assert.strictEqual(removed.status, 409, JSON.stringify(removed.body));
    assert.match(removed.body.error, /cannot be deleted/);
    const again = await owner('GET', '/api/workspace');
    const next = JSON.parse(JSON.stringify(again.body.data));
    next.disputes.push({ id: 'sent-2', clientId: 'bill', status: 'sent', sentAt: '2020-08-01', items: [{ id: 's2', creditor: 'North Bank', accountNumber: 'xx1234', bureau: 'Equifax', result: 'deleted', bureauResultAt: '2020-08-01' }] });
    next.invoices = [{ id: 'rekey', clientId: 'bill', disputeId: 'sent-2', itemId: 's2', description: 'Deletion', amount: 20, status: 'issued', issuedAt: '2020-08-01', serviceCompletedAt: '2020-08-01' }];
    const billed = await owner('PUT', '/api/workspace', { baseVersion: again.body.version, data: next });
    assert.strictEqual(billed.status, 200, JSON.stringify(billed.body));
    const created = billed.body.data.disputes.find(d => d.id === 'sent-2');
    assert.strictEqual(created.serverSentAt, todayEt());
    assert.notStrictEqual(created.serverSentAt, '2020-08-01');
    assert.ok(billed.body.data.invoices.some(row => row.id === 'rekey' && row.status === 'issued'));
  });
});

test('duplicate client ids stay flagged and their logins stay unbound', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-dup-id-'));
  const boot = { dataDir: dir, encryptionKey: 'guard-key-not-a-secret-00', selfSignupEnabled: false, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } };
  const first = createApp(boot);
  try {
    first.db.data.workspace = { clients: [{ id: 'ada', name: 'Ada', email: 'ada@guard.test' }, { id: 'ada', name: 'Other', email: 'other@guard.test' }], disputes: [], letters: [], reports: [], invoices: [], signatures: [], settings: { company: {} } };
    first.db.data.users.push({ id: 'ada-login', name: 'Ada', email: 'ada@guard.test', role: 'client', clientId: 'ada', password: hashPassword('portal password 1'), sessionEpoch: 1, createdAt: '2026-01-01T00:00:00.000Z' });
    delete first.db.data.portalIdentityMigration;
    first.db.data.audit = [];
    first.db.persist();
  } finally { first.shutdown(); }
  const second = createApp(boot);
  try {
    const rows = second.db.data.workspace.clients.filter(row => row.id === 'ada');
    assert.ok(rows.every(row => row.identityAmbiguous));
    const login = second.db.data.users.find(row => row.id === 'ada-login');
    assert.ok(!login.clientIdentity);
    assert.strictEqual(login.portalLinkNeedsInvite, true);
  } finally {
    second.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
