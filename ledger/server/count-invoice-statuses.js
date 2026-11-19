#!/usr/bin/env node
// Read-only count of invoices whose status is outside draft, issued, paid, and void (N41).
// This does not write the database, start the server, or talk to production.
// Run it on a copy of the data file before deploy:
//   node ledger/server/count-invoice-statuses.js /path/to/ledger-db.json
//   node ledger/server/count-invoice-statuses.js /path/to/ledger-db.json --reinvite-emails
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
const args = process.argv.slice(2);
const showReinviteEmails = args.includes('--reinvite-emails');
const file = args.find(arg => arg !== '--reinvite-emails');
if (!file) {
  console.error('Usage: node ledger/server/count-invoice-statuses.js <ledger-db.json> [--reinvite-emails]');
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
const orphans = orphanWork(data && data.workspace);
const crossClient = crossClientLinks(data && data.workspace);
const reinviteRows = unmatchedPortalLogins(data);
const reinviteLogins = showReinviteEmails ? reinviteRows : reinviteRows.length;
const mailedReview = mailedReviewReport(data && data.workspace);
const unstampedMailed = mailedReview.unstampedMailed;
const heldUndated = mailedReview.heldUndated;
const deployGate = {
  outside: outside,
  duplicatePayTokens,
  shapeErrors,
  missingIdWarnings,
  orphans,
  crossClient,
  unstampedMailed,
  heldUndated,
  ready: outside === 0 && duplicatePayTokens.sharedTokens === 0 && shapeErrors.length === 0 && unstampedMailed === 0,
  message: 'Run this on a copy of production before deploy. ready is true only when outside is 0, no pay token is shared, no workspace shape is wrong, and unstampedMailed is 0. A blank client row is a shape error and makes ready false. missingIdWarnings lists legacy rows that have no id, by key and count. orphans lists disputes, letters, and reports whose client is no longer in the workspace. crossClient lists a dispute or letter on one client whose items, report, or account cite another client. unstampedMailed counts mailed disputes that have neither a server mailed date nor a retirement. ready is false until that count is 0. heldUndated lists the undated mailed rows whose bureau is already on hold. The owner dates or retires those rows. A date inside the cancellation window or before the contract stays held and cannot be billed. reinviteLogins is a count of portal logins the migration left unbound or whose email does not match the client. Review that count before any invitation goes out. Pass --reinvite-emails to print those email addresses. They do not by themselves make ready false. Otherwise review ledger/server/preview-invoice-migration.js and migrate before deploy. This script does not write.'
};
process.stdout.write(JSON.stringify({ file, invoices: invoices.length, outside, counts, duplicatePayTokens, shapeErrors, missingIdWarnings, orphans, crossClient, unstampedMailed, heldUndated, reinviteLogins, deployGate }, null, 2) + '\n');

function mailedReviewReport(ws) {
  const workspace = ws || {};
  const day = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
  const retired = new Set(((workspace.mailedDisputeTombstones) || []).filter(row => row && row.retired && row.id).map(row => row.id));
  const heldKeys = new Set(((workspace.heldOutcomes) || []).filter(row => row && row.onHold && !row.cleared && row.key).map(row => row.key));
  const bureauOf = (value) => {
    const raw = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!raw) return '';
    if (raw === 'exp' || raw.startsWith('experian')) return 'experian';
    if (raw === 'efx' || raw === 'eq' || raw.startsWith('equifax')) return 'equifax';
    if (raw === 'tu' || raw.startsWith('transunion')) return 'transunion';
    return '';
  };
  const heldUndated = [];
  let unstampedMailed = 0;
  for (const dispute of workspace.disputes || []) {
    if (!dispute || retired.has(dispute.id)) continue;
    const sent = !!(dispute.sentAt || dispute.sentDate || dispute.serverSentAt || String(dispute.status || '') === 'sent');
    if (!sent || day(dispute.serverSentAt)) continue;
    unstampedMailed += 1;
    const bureaus = [];
    for (const item of dispute.items || []) {
      const bureau = item && bureauOf(item.bureau);
      if (bureau && !bureaus.includes(bureau)) bureaus.push(bureau);
    }
    const recipient = bureauOf(dispute.recipient);
    if (recipient && !bureaus.includes(recipient)) bureaus.push(recipient);
    const held = bureaus.filter(bureau => heldKeys.has(String(dispute.clientId || '') + '\n' + bureau));
    if (held.length) heldUndated.push({ id: dispute.id, clientId: dispute.clientId || '', bureaus: held });
  }
  return { unstampedMailed, heldUndated };
}

function unmatchedPortalLogins(data) {
  const clients = ((data && data.workspace && data.workspace.clients) || []).filter(c => c && c.id);
  const byId = new Map(clients.map(c => [c.id, c]));
  const rows = [];
  for (const u of (data && data.users) || []) {
    if (!u || u.role !== 'client' || u.disabled) continue;
    const client = byId.get(u.clientId);
    const loginEmail = String(u.email || '').toLowerCase().trim();
    const clientEmail = client ? String(client.email || '').toLowerCase().trim() : '';
    if (u.portalLinkNeedsInvite || !client || loginEmail !== clientEmail) {
      rows.push({ email: u.email || '', clientId: u.clientId || '', reason: !client ? 'client missing' : (loginEmail !== clientEmail ? 'email does not match' : 'needs a new invitation') });
    }
  }
  return rows;
}

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
      if (row == null || typeof row !== 'object' || Array.isArray(row)) shapeErrors.push({ key, id: '', reason: key + ' contains an empty row.' });
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

function orphanWork(ws) {
  const workspace = ws || {};
  const ids = new Set(((workspace.clients) || []).filter(row => row && row.id).map(row => row.id));
  const list = (rows, key) => (rows || []).filter(row => row && row.id && row.clientId && !ids.has(row.clientId)).map(row => ({ key, id: row.id, clientId: row.clientId }));
  return { disputes: list(workspace.disputes, 'disputes'), letters: list(workspace.letters, 'letters'), reports: list(workspace.reports, 'reports') };
}

function crossClientLinks(ws) {
  const workspace = ws || {};
  const reportOwner = new Map();
  const accountOwner = new Map();
  (workspace.reports || []).forEach(report => {
    if (!report || !report.id || !report.clientId) return;
    reportOwner.set(report.id, report.clientId);
    (report.accounts || []).forEach(acct => {
      if (acct && acct.id) accountOwner.set(acct.id, { clientId: report.clientId, reportId: report.id });
    });
  });
  const links = [];
  const see = (node, row, key, seen) => {
    if (!node || typeof node !== 'object') return;
    if (node.reportId && reportOwner.has(node.reportId) && reportOwner.get(node.reportId) !== row.clientId) {
      const token = key + '/' + row.id + '/report/' + node.reportId;
      if (!seen.has(token)) {
        seen.add(token);
        links.push({ key, id: row.id, clientId: row.clientId || '', reportId: node.reportId, ownerClientId: reportOwner.get(node.reportId) });
      }
    }
    if (node.accountId && accountOwner.has(node.accountId) && accountOwner.get(node.accountId).clientId !== row.clientId) {
      const owner = accountOwner.get(node.accountId);
      const token = key + '/' + row.id + '/account/' + node.accountId;
      if (!seen.has(token)) {
        seen.add(token);
        links.push({ key, id: row.id, clientId: row.clientId || '', accountId: node.accountId, reportId: owner.reportId, ownerClientId: owner.clientId });
      }
    }
    (node.items || []).forEach(item => see(item, row, key, seen));
  };
  const walk = (rows, key) => (rows || []).forEach(row => { if (row && row.id) see(row, row, key, new Set()); });
  walk(workspace.disputes, 'disputes');
  walk(workspace.letters, 'letters');
  return links;
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
