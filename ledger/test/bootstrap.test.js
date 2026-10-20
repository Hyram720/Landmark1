// Run: node --test ledger/test/bootstrap.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

const VARS = ['LEDGER_BOOTSTRAP_OWNER_EMAIL', 'LEDGER_BOOTSTRAP_OWNER_PASSWORD_HASH', 'LEDGER_BOOTSTRAP_OWNER_NAME'];
const clear = () => VARS.forEach(v => delete process.env[v]);

async function login(app, email, password) {
  const server = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return r.status;
  } finally { server.close(); }
}

test('bootstrap creates an owner, applies once, and resets an existing owner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-boot-'));
  try {
    // An existing owner the operator can no longer sign in as.
    let { app, db, shutdown } = createApp({ dataDir: dir, encryptionKey: 'test-key' });
    db.data.users.push({ id: 'o1', name: 'Old', email: 'old@example.test', role: 'owner', password: hashPassword('forgotten password 1'), sessionEpoch: 1 });
    db.data.users.push({ id: 'c1', name: 'Client', email: 'client@example.test', role: 'client', password: hashPassword('client password 1'), sessionEpoch: 1 });
    db.persist(); shutdown();

    clear();
    process.env.LEDGER_BOOTSTRAP_OWNER_EMAIL = 'New@Example.test';
    process.env.LEDGER_BOOTSTRAP_OWNER_PASSWORD_HASH = hashPassword('brand new password 1');
    ({ app, db, shutdown } = createApp({ dataDir: dir, encryptionKey: 'test-key' }));
    assert.strictEqual(db.data.users.find(u => u.email === 'new@example.test').role, 'owner');
    assert.strictEqual(await login(app, 'new@example.test', 'brand new password 1'), 200);
    shutdown();

    // Applied once: a restart does not duplicate the user.
    ({ app, db, shutdown } = createApp({ dataDir: dir, encryptionKey: 'test-key' }));
    assert.strictEqual(db.data.users.filter(u => u.email === 'new@example.test').length, 1);
    shutdown();

    // Existing owner gets a new password.
    process.env.LEDGER_BOOTSTRAP_OWNER_EMAIL = 'old@example.test';
    process.env.LEDGER_BOOTSTRAP_OWNER_PASSWORD_HASH = hashPassword('replacement password 1');
    ({ app, db, shutdown } = createApp({ dataDir: dir, encryptionKey: 'test-key' }));
    assert.strictEqual(await login(app, 'old@example.test', 'replacement password 1'), 200);
    assert.strictEqual(await login(app, 'old@example.test', 'forgotten password 1'), 401);
    shutdown();

    // A client is never promoted or changed.
    process.env.LEDGER_BOOTSTRAP_OWNER_EMAIL = 'client@example.test';
    process.env.LEDGER_BOOTSTRAP_OWNER_PASSWORD_HASH = hashPassword('takeover password 1');
    ({ app, db, shutdown } = createApp({ dataDir: dir, encryptionKey: 'test-key' }));
    const c = db.data.users.find(u => u.email === 'client@example.test');
    assert.strictEqual(c.role, 'client');
    assert.strictEqual(await login(app, 'client@example.test', 'takeover password 1'), 401);
    shutdown();

    // Plain-text password in the hash variable is ignored.
    process.env.LEDGER_BOOTSTRAP_OWNER_EMAIL = 'plain@example.test';
    process.env.LEDGER_BOOTSTRAP_OWNER_PASSWORD_HASH = 'not-a-hash';
    ({ app, db, shutdown } = createApp({ dataDir: dir, encryptionKey: 'test-key' }));
    assert.ok(!db.data.users.find(u => u.email === 'plain@example.test'));
    shutdown();
  } finally { clear(); fs.rmSync(dir, { recursive: true, force: true }); }
});
