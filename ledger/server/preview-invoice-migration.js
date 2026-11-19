#!/usr/bin/env node
// Read-only preview of a status migration. It does not write the database.
// Run it on a copy of production data before deploy, after count-invoice-statuses.js
// reports outside invoices or duplicate pay tokens:
//   node ledger/server/preview-invoice-migration.js /path/to/ledger-db.json
// Review the printed plan. Nothing here is applied.
import fs from 'node:fs';
import crypto from 'node:crypto';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node ledger/server/preview-invoice-migration.js <ledger-db.json>');
  process.exit(2);
}
const text = fs.readFileSync(file, 'utf8');
const data = decode(text, process.env.LEDGER_ENCRYPTION_KEY);
const invoices = (data && data.workspace && data.workspace.invoices) || [];
const statusPlan = [];
for (const inv of invoices) {
  if (!inv) continue;
  const status = inv.status == null || inv.status === '' ? '(missing)' : String(inv.status);
  if (['draft', 'issued', 'paid', 'void'].includes(status)) continue;
  const suggested = (status === 'open' && (inv.serviceCompletedAt || inv.issuedAt)) ? 'issued' : 'draft';
  statusPlan.push({ id: inv.id || null, clientId: inv.clientId || null, status, suggested, review: 'Confirm before any write. This script does not change the file.' });
}
const byToken = {};
for (const inv of invoices) {
  if (!inv || !inv.payToken) continue;
  const token = String(inv.payToken);
  byToken[token] = byToken[token] || [];
  byToken[token].push(inv.id || null);
}
const duplicatePayTokens = Object.values(byToken).filter(ids => ids.length > 1).map(ids => ({ invoiceIds: ids, review: 'Give each invoice its own server token before taking payment. This script does not change the file.' }));
process.stdout.write(JSON.stringify({
  file,
  writes: false,
  outside: statusPlan.length,
  duplicatePayTokens: duplicatePayTokens.length,
  statusPlan,
  duplicatePlan: duplicatePayTokens
}, null, 2) + '\n');

function decode(raw, secret) {
  const parsed = JSON.parse(raw);
  if (!parsed || !parsed.enc) return parsed;
  if (!secret) throw new Error('Database is encrypted: set LEDGER_ENCRYPTION_KEY');
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  d.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(parsed.data, 'base64')), d.final()]).toString('utf8'));
}
