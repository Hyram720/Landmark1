// File-backed datastore with atomic writes and optional AES-256-GCM encryption at rest.
// One JSON document holds users, sessions metadata, the workspace and an audit log.
// Swap this module for Postgres when you outgrow a single server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openDb({ dir, encryptionKey }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'ledger-db.json');
  const key = encryptionKey ? deriveKey(encryptionKey) : null;

  let data = { users: [], invites: [], workspace: null, workspaceVersion: 0, audit: [], secret: null };
  if (fs.existsSync(file)) data = Object.assign(data, decode(fs.readFileSync(file, 'utf8'), key));

  // Every write re-encrypts and rewrites the whole document, atomically (write temp file, fsync,
  // rename). High-frequency, low-value writes (link clicks) use persistSoon(), which batches them.
  let timer = null, dirty = false;
  function persist() {
    if (timer) { clearTimeout(timer); timer = null; }
    dirty = false;
    const tmp = file + '.' + process.pid + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, encode(data, key)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    snapshotDaily();
  }
  function persistSoon(ms = 2000) {
    dirty = true;
    if (!timer) { timer = setTimeout(() => { timer = null; if (dirty) persist(); }, ms); if (timer.unref) timer.unref(); }
  }
  function flush() { if (dirty || timer) persist(); }

  // One encrypted copy of the database per day under <dir>/backups, newest `keep` kept. These sit
  // on the same volume, so they protect against bad saves, not against losing the volume.
  const backupDir = path.join(dir, 'backups');
  const keep = Math.max(1, Number(process.env.LEDGER_BACKUP_DAYS || 14));
  let lastSnapshot = '';
  function snapshotDaily() {
    const day = new Date().toISOString().slice(0, 10);
    if (day === lastSnapshot || process.env.LEDGER_BACKUPS === 'off') return;
    try {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      const target = path.join(backupDir, `ledger-db-${day}.json`);
      if (!fs.existsSync(target)) fs.copyFileSync(file, target);
      fs.readdirSync(backupDir).filter(f => /^ledger-db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(keep)
        .forEach(f => fs.rmSync(path.join(backupDir, f), { force: true }));
      lastSnapshot = day;
    } catch (e) { console.error('[db] daily backup failed:', e.message); }
  }

  if (!data.secret) { data.secret = crypto.randomBytes(32).toString('hex'); persist(); }

  function audit(entry) {
    data.audit.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    if (data.audit.length > 5000) data.audit.length = 5000;
  }

  function writable() { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } }

  return { get data() { return data; }, persist, persistSoon, flush, audit, writable, encrypted: !!key, file, backupDir };
}

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encode(obj, key) {
  const json = JSON.stringify(obj);
  if (!key) return json;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(json, 'utf8'), c.final()]);
  return JSON.stringify({ enc: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: enc.toString('base64') });
}

function decode(text, key) {
  const parsed = JSON.parse(text);
  if (!parsed.enc) return parsed;
  if (!key) throw new Error('Database is encrypted: set LEDGER_ENCRYPTION_KEY');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  d.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(parsed.data, 'base64')), d.final()]).toString('utf8'));
}
