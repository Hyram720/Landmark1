// Run: npm run test:ledger
// Dispute sequences advance on the server: letters are drafted when due with nobody signed in,
// moot drafts are withdrawn, and staff get a review task.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { Sequences } from '../server/shared.js';

const item = { creditor: 'Example Servicing', accountNumber: 'XXXX1234', discrepancy: 'Reported 30 days late in March 2024 while the account was in an approved deferment.' };
const client = { id: 'c1', name: 'Jordan Sample', firstName: 'Jordan', lastName: 'Sample', kind: 'personal', address: '1 Main St\nExample City, NJ 08000', onboarding: {} };
const ids = () => { let n = 0; return () => 'id' + (++n); };
const at = () => '2026-03-01T12:00:00.000Z';

function workspace() {
  return {
    clients: [client], reports: [], letters: [], tasks: [], activity: [],
    sequences: [{ id: 'q1', clientId: 'c1', title: 'Student loan lates', furnisher: { name: 'Example Servicing', address: 'P.O. Box 1\nExample City, ST 00000' }, status: 'active' }],
    disputes: [
      { id: 'a', clientId: 'c1', seqId: 'q1', type: 'cra_611', round: 1, recipient: 'Experian', items: [item], status: 'sent', sentAt: '2026-01-01', dueAt: '2026-02-05', outcome: 'verified' },
      { id: 'b', clientId: 'c1', seqId: 'q1', type: 'cra_611', round: 1, recipient: 'Equifax', items: [item], status: 'sent', sentAt: '2026-01-01', dueAt: '2026-02-05', outcome: null }
    ]
  };
}

test('advance drafts due letters with text and one review task per client', () => {
  const ws = workspace();
  const r = Sequences.advance(ws, '2026-03-01', { uid: ids(), now: at });
  // Experian verified -> MOV; Equifax silent past deadline + mail time -> MOV; one furnisher letter.
  assert.strictEqual(r.drafted, 3);
  const made = ws.disputes.filter(d => d.parentId);
  assert.deepStrictEqual(made.map(d => [d.type, d.recipient]).sort(), [['furnisher_623', 'Example Servicing'], ['mov_611a7', 'Equifax'], ['mov_611a7', 'Experian']]);
  made.forEach(d => {
    const l = ws.letters.find(x => x.id === d.letterId);
    assert.ok(l && l.status === 'draft' && l.text.includes('Jordan'), 'letter drafted for ' + d.recipient);
    assert.strictEqual(d.status, 'draft', 'staff still approve before mailing');
  });
  assert.strictEqual(ws.tasks.length, 1);
  assert.match(ws.tasks[0].title, /Review 3 sequence letters/);
  // Nothing more until those are mailed and answered.
  assert.strictEqual(Sequences.advance(ws, '2026-03-02', { uid: ids(), now: at }).drafted, 0);
});

test('a letter drafted after "no response" is withdrawn when the earlier letter is later answered deleted', () => {
  const ws = workspace();
  Sequences.advance(ws, '2026-03-01', { uid: ids(), now: at });
  const eqChild = ws.disputes.find(d => d.parentId === 'b');
  eqChild.status = 'ready';
  ws.disputes.find(d => d.id === 'b').outcome = 'deleted';
  const r = Sequences.advance(ws, '2026-03-03', { uid: ids(), now: at });
  assert.strictEqual(r.withdrawn, 1);
  assert.strictEqual(r.drafted, 0, 'no replacement drafted');
  assert.strictEqual(eqChild.status, 'closed', 'off the Send round list');
  assert.ok(eqChild.withdrawnAt);
  // The Experian branch is still open, so the sequence is not finished.
  assert.notStrictEqual(Sequences.status(ws, ws.sequences[0], '2026-03-03').state, 'won');
});

test('a stopped sequence never drafts', () => {
  const ws = workspace();
  ws.sequences[0].status = 'stopped';
  assert.strictEqual(Sequences.advance(ws, '2026-03-01', { uid: ids(), now: at }).drafted, 0);
  assert.strictEqual(ws.disputes.length, 2);
});

test('server sweep drafts with nobody signed in; the run endpoint needs staff', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-seq-'));
  const { app, db, sequenceSweep, shutdown } = createApp({ dataDir: dir, encryptionKey: 'test-key' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.strictEqual((await fetch(base + '/api/sequences/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    const before = db.data.workspaceVersion;
    db.data.workspace = Object.assign({ version: 2 }, workspace());
    const r = sequenceSweep();
    assert.strictEqual(r.drafted, 3);
    assert.strictEqual(db.data.workspaceVersion, before + 1, 'open browsers pick the change up');
    assert.ok(db.data.workspace.activity.some(a => /drafted 3 due letters/.test(a.text)));
    assert.strictEqual(sequenceSweep().drafted, 0, 'idempotent');
    assert.strictEqual(db.data.workspaceVersion, before + 1);
  } finally {
    server.close();
    shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
