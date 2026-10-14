/*
 * Compares a newly imported credit report with the previous report from the same bureau and
 * works out what happened to every disputed item: deleted, corrected, or still reporting.
 */
(function (root) {
  'use strict';
  const Metro2 = root.Metro2;
  const WATCH = ['status', 'balance', 'pastDue', 'dofd', 'paymentHistory', 'limit', 'closed', 'complianceCode'];
  const norm = v => (v === null || v === undefined ? '' : String(v).trim());

  /** Per-account diff between two reports of the same bureau. */
  function compareReports(prev, next) {
    const nextByKey = {};
    (next.accounts || []).forEach(a => { nextByKey[Metro2.matchKey(a)] = a; });
    const out = [];
    (prev.accounts || []).forEach(a => {
      const key = Metro2.matchKey(a);
      const b = nextByKey[key];
      if (!b) { out.push({ kind: 'deleted', key, before: a, after: null, changes: [] }); return; }
      delete nextByKey[key];
      const changes = WATCH.filter(f => norm(a[f]) !== norm(b[f])).map(f => ({ field: f, from: norm(a[f]), to: norm(b[f]) }));
      out.push({ kind: changes.length ? 'changed' : 'unchanged', key, before: a, after: b, changes });
    });
    Object.entries(nextByKey).forEach(([key, b]) => out.push({ kind: 'new', key, before: null, after: b, changes: [] }));
    return out;
  }

  /**
   * Applies a new report to the workspace: finds open disputes for this client and bureau,
   * marks items deleted or corrected, closes disputes whose items are all resolved, and
   * returns a list of wins for the client update. Mutates `ws`.
   */
  function applyNewReport(ws, newReport, today) {
    const prev = ws.reports.filter(r => r.clientId === newReport.clientId && r.bureau === newReport.bureau && r.id !== newReport.id && String(r.date) <= String(newReport.date) && (r.accounts || []).length)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!prev) return { wins: [], diff: [] };
    const diff = compareReports(prev, newReport);
    const byKey = {};
    diff.forEach(d => { byKey[d.key] = d; });
    const wins = [];
    ws.disputes.filter(d => d.clientId === newReport.clientId && d.sentAt && !d.outcome).forEach(d => {
      let resolved = 0;
      d.items.forEach(it => {
        if (it.result) { resolved++; return; }
        const itemBureau = it.bureau || d.recipient;
        if (itemBureau !== newReport.bureau) return;
        const acct = prev.accounts.find(a => a.id === it.accountId) || { creditor: it.creditor, accountNumber: it.accountNumber };
        const dd = byKey[Metro2.matchKey(acct)];
        if (!dd) return;
        if (dd.kind === 'deleted') { it.result = 'deleted'; it.resultAt = today; resolved++; wins.push({ kind: 'deleted', creditor: it.creditor, bureau: newReport.bureau, disputeId: d.id }); }
        else if (dd.kind === 'changed') { it.result = 'corrected'; it.resultAt = today; it.resultChanges = dd.changes; resolved++; wins.push({ kind: 'corrected', creditor: it.creditor, bureau: newReport.bureau, disputeId: d.id, changes: dd.changes }); }
        else if (dd.kind === 'unchanged') { it.result = 'unchanged'; it.resultAt = today; }
      });
      if (d.items.length && d.items.every(it => it.result)) {
        d.outcome = d.items.every(it => it.result === 'deleted') ? 'deleted' : d.items.some(it => it.result === 'deleted' || it.result === 'corrected') ? 'corrected' : 'verified';
        d.respondedAt = today;
        d.notes = ((d.notes || '') + `\nResult detected automatically from the ${newReport.bureau} report dated ${newReport.date}.`).trim();
      }
    });
    return { wins, diff, prev };
  }

  function winsText(clientName, wins) {
    const del = wins.filter(w => w.kind === 'deleted'), cor = wins.filter(w => w.kind === 'corrected');
    const lines = [`Good news, ${clientName.split(' ')[0]}! Your updated credit report shows results from your disputes:`];
    del.forEach(w => lines.push(`• ${w.creditor} was removed from your ${w.bureau} report.`));
    cor.forEach(w => lines.push(`• ${w.creditor} was corrected on your ${w.bureau} report.`));
    lines.push('Log in to your portal to see the details. We will keep working on the remaining items.');
    return lines.join('\n');
  }

  const api = { compareReports, applyNewReport, winsText };
  root.Results = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
