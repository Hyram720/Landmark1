#!/usr/bin/env node
// Read-only count of invoices whose status is outside draft, issued, paid, and void (N41).
// This does not write the database, start the server, or talk to production.
// Run it on a copy of the data file before deploy:
//   node ledger/server/count-invoice-statuses.js /path/to/ledger-db.json
// Encrypted files need LEDGER_ENCRYPTION_KEY in the environment. The key is not printed.
//
// Equivalent SQL if those invoices are loaded into a table named invoices:
//   SELECT coalesce(status, '(missing)') AS status, count(*) AS n
//   FROM invoices
//   WHERE status IS NULL OR status NOT IN ('draft', 'issued', 'paid', 'void')
//   GROUP BY 1
//   ORDER BY 1;
import fs from 'node:fs';
import crypto from 'node:crypto';

const ALLOWED = new Set(['draft', 'issued', 'paid', 'void']);
const file = process.argv[2];
if (!file) {
  console.error('Usage: node ledger/server/count-invoice-statuses.js <ledger-db.json>');
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8');
const data = decode(text, process.env.LEDGER_ENCRYPTION_KEY);
const invoices = (data && data.workspace && data.workspace.invoices) || [];
const counts = {};
for (const inv of invoices) {
  const status = inv && inv.status != null && inv.status !== '' ? String(inv.status) : '(missing)';
  if (ALLOWED.has(status)) continue;
  counts[status] = (counts[status] || 0) + 1;
}
const outside = Object.values(counts).reduce((sum, n) => sum + n, 0);
process.stdout.write(JSON.stringify({ file, invoices: invoices.length, outside, counts }, null, 2) + '\n');

function decode(raw, secret) {
  const parsed = JSON.parse(raw);
  if (!parsed || !parsed.enc) return parsed;
  if (!secret) throw new Error('Database is encrypted: set LEDGER_ENCRYPTION_KEY');
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  d.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(parsed.data, 'base64')), d.final()]).toString('utf8'));
}
