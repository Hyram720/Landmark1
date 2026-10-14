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
  if (!data.secret) { data.secret = crypto.randomBytes(32).toString('hex'); persist(); }

  function persist() {
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, encode(data, key), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function audit(entry) {
    data.audit.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    if (data.audit.length > 5000) data.audit.length = 5000;
  }

  return { get data() { return data; }, persist, audit, encrypted: !!key, file };
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
