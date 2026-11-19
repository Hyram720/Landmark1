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
const tokenCounts = {};
for (const inv of invoices) {
  if (!inv || !inv.payToken) continue;
  const token = String(inv.payToken);
  tokenCounts[token] = (tokenCounts[token] || 0) + 1;
}
const duplicateGroups = Object.values(tokenCounts).filter(n => n > 1);
const duplicatePayTokens = {
  sharedTokens: duplicateGroups.length,
  invoices: duplicateGroups.reduce((sum, n) => sum + n, 0)
};
const shapeReport = workspaceShapeReport(data && data.workspace);
const shapeErrors = shapeReport.shapeErrors;
const missingIdWarnings = shapeReport.missingIdWarnings;
const deployGate = {
  outside: outside,
  duplicatePayTokens,
  shapeErrors,
  missingIdWarnings,
  ready: outside === 0 && duplicatePayTokens.sharedTokens === 0 && shapeErrors.length === 0,
  message: 'Run this on a copy of production before deploy. ready is true only when outside is 0, no pay token is shared, and no workspace shape is wrong. missingIdWarnings lists legacy rows that have no id, by key and count. Otherwise review ledger/server/preview-invoice-migration.js and migrate before deploy. This script does not write.'
};
process.stdout.write(JSON.stringify({ file, invoices: invoices.length, outside, counts, duplicatePayTokens, shapeErrors, missingIdWarnings, deployGate }, null, 2) + '\n');

function workspaceShapeReport(ws) {
  const shapeErrors = [];
  const missingCounts = {};
  const lists = ['clients', 'reports', 'disputes', 'letters', 'tasks', 'invoices', 'referrals', 'activity', 'offers', 'partnerReferrals', 'signatures', 'messages', 'documents', 'sequences', 'pendingImports', 'addressBook', 'automations'];
  const maps = ['automationLog', 'violations', 'settings'];
  const needsId = lists.filter(key => key !== 'addressBook');
  const workspace = ws || {};
  const noteMissing = (key) => { missingCounts[key] = (missingCounts[key] || 0) + 1; };
  lists.forEach(key => {
    if (workspace[key] == null) return;
    if (!Array.isArray(workspace[key])) { shapeErrors.push({ key, id: '', reason: key + ' must be a list.' }); return; }
    workspace[key].forEach(row => {
      if (row == null) shapeErrors.push({ key, id: '', reason: key + ' contains an empty row.' });
    });
    if (!needsId.includes(key)) return;
    workspace[key].forEach(row => {
      if (row && typeof row === 'object' && !Array.isArray(row) && !String(row.id || '').trim()) noteMissing(key);
    });
  });
  maps.forEach(key => {
    if (workspace[key] == null) return;
    if (Array.isArray(workspace[key]) || typeof workspace[key] !== 'object') { shapeErrors.push({ key, id: '', reason: key + ' must be a map.' }); return; }
    if (key !== 'violations') return;
    Object.keys(workspace[key]).forEach(id => {
      if (!String(id || '').trim()) noteMissing(key);
    });
  });
  const missingIdWarnings = Object.keys(missingCounts).map(key => ({ key, count: missingCounts[key] }));
  return { shapeErrors, missingIdWarnings };
}

function decode(raw, secret) {
  const parsed = JSON.parse(raw);
  if (!parsed || !parsed.enc) return parsed;
  if (!secret) throw new Error('Database is encrypted: set LEDGER_ENCRYPTION_KEY');
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  d.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(parsed.data, 'base64')), d.final()]).toString('utf8'));
}
