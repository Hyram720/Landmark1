/*
 * FCRA / FDCPA violation tracker. Scans the workspace for documented events that may be
 * violations (missed deadlines, reinsertion without notice, accounts not marked disputed,
 * obsolete reporting) and builds an evidence packet for a consumer attorney. These are
 * flags for attorney review, not legal conclusions.
 */
(function (root) {
  'use strict';
  const Law = root.Law, Metro2 = root.Metro2;
  const MAIL_BACK = 5;
  const BUREAU_TYPES = ['cra_611', 'obsolete_605', 'public_record_611', 'tenant_screening_611', 'reinsertion_611', 'pii_611', 'inquiry_604'];
  const FURNISHER_TYPES = ['furnisher_623', 'student_loan_623', 'furnisher_final'];

  const STATUS = [['new', 'New'], ['reviewing', 'Reviewing'], ['referred', 'Sent to attorney'], ['accepted', 'Attorney accepted'], ['declined', 'Attorney declined'], ['closed', 'Closed']];

  function v(key, d, o) { return Object.assign({ key, clientId: d.clientId, disputeIds: [d.id], severity: 'medium' }, o); }

  /** All potential violations for a workspace (or one client). */
  function scan(ws, today, clientId) {
    const out = [];
    const disputes = ws.disputes.filter(d => !clientId || d.clientId === clientId);
    disputes.forEach(d => {
      const t = (Law.DISPUTE_TYPES[d.type] || {});
      // 1. No response by the deadline.
      if (d.sentAt && !d.outcome && d.dueAt && today > Law.addDays(d.dueAt, MAIL_BACK)) {
        if (BUREAU_TYPES.includes(d.type)) out.push(v('noresp:' + d.id, d, { law: 'FCRA § 611(a)(1)(A) — 15 U.S.C. § 1681i(a)(1)(A)', title: `${d.recipient} did not complete the reinvestigation within 30 days`, detail: `Dispute mailed ${d.sentAt}${d.receivedAt ? ', received ' + d.receivedAt : ''}; response was due ${d.dueAt}. No result recorded. If the bureau cannot verify within the period, it must delete the item (§ 611(a)(5)(A)).`, severity: 'high' }));
        else if (FURNISHER_TYPES.includes(d.type)) out.push(v('noresp:' + d.id, d, { law: 'FCRA § 623(a)(8)(E) — 15 U.S.C. § 1681s-2(a)(8)(E); 12 C.F.R. § 1022.43(e)', title: `${d.recipient} did not respond to the direct dispute within 30 days`, detail: `Direct dispute mailed ${d.sentAt}; response was due ${d.dueAt}. No result recorded.` }));
      }
      // 2. Method of verification not provided within 15 days.
      if (d.type === 'mov_611a7' && d.sentAt && !d.outcome) {
        const due = Law.addDays(d.receivedAt || Law.addDays(d.sentAt, 5), 15 + MAIL_BACK);
        if (today > due) out.push(v('mov:' + d.id, d, { law: 'FCRA § 611(a)(7) — 15 U.S.C. § 1681i(a)(7)', title: `${d.recipient} did not describe its verification procedure within 15 days`, detail: `Method-of-verification request mailed ${d.sentAt}. No description received.` }));
      }
      // 3. Verified again despite documents (step 2+), possible failure to review information provided.
      if (d.outcome === 'verified' && d.parentId && d.items.some(i => i.evidence)) {
        out.push(v('reverified:' + d.id, d, { law: 'FCRA § 611(a)(4) and § 623(b)(1) — failure to review relevant information provided', title: `${d.recipient} verified again after receiving documents`, detail: 'The item was verified a second time even though supporting documents were enclosed. Ask the attorney whether the investigation was reasonable.', severity: 'low' }));
      }
    });

    // Reports: reinsertion, not marked disputed, obsolete reporting.
    const reports = ws.reports.filter(r => (!clientId || r.clientId === clientId) && (r.accounts || []).length);
    disputes.forEach(d => d.items.forEach((it, i) => {
      const bureau = it.bureau || (Law.BUREAUS[d.recipient] ? d.recipient : null);
      if (!bureau) return;
      const key = Metro2.matchKey({ creditor: it.creditor, accountNumber: it.accountNumber });
      const later = reports.filter(r => r.clientId === d.clientId && r.bureau === bureau && d.sentAt && String(r.date) > String(it.resultAt || d.sentAt))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      later.forEach(r => {
        const acct = r.accounts.find(a => Metro2.matchKey(a) === key);
        if (it.result === 'deleted' && acct && String(r.date) > String(it.resultAt)) {
          out.push(v(`reinsert:${d.id}:${i}`, d, { law: 'FCRA § 611(a)(5)(B) — 15 U.S.C. § 1681i(a)(5)(B)', title: `${it.creditor} reappeared on ${bureau} after deletion`, detail: `Deleted ${it.resultAt}; present again on the ${bureau} report dated ${r.date}. The bureau must certify accuracy with the furnisher and notify the consumer in writing within 5 business days. Confirm with the client whether a reinsertion notice was received.`, severity: 'high', reportId: r.id }));
        }
        const disputedOpen = !it.result || it.result === 'unchanged';
        if (acct && disputedOpen && !/^X[BC]$/i.test(String(acct.complianceCode || '')) && d.receivedAt && String(r.date) > Law.addDays(d.receivedAt, 30)) {
          out.push(v(`xb:${d.id}:${i}:${r.id}`, d, { law: d.type === 'validation_809' ? 'FDCPA § 807(8) — 15 U.S.C. § 1692e(8)' : 'FCRA § 623(a)(3) — 15 U.S.C. § 1681s-2(a)(3)', title: `${it.creditor} not reported as disputed on ${bureau}`, detail: `Disputed (received ${d.receivedAt}); the ${bureau} report dated ${r.date} has no XB/XC compliance condition code.`, severity: 'medium', reportId: r.id }));
        }
      });
    }));
    // Obsolete items still reported (latest report per bureau).
    const latest = {};
    reports.forEach(r => { const k = r.clientId + r.bureau; if (!latest[k] || String(r.date) > String(latest[k].date)) latest[k] = r; });
    Object.values(latest).forEach(r => (r.accounts || []).forEach(a => {
      const od = a.dofd && Metro2.obsolescenceDate(a.dofd);
      const until = od && !isNaN(od) ? od.toISOString().slice(0, 10) : null;
      if (until && String(r.date) > until) out.push({ key: `obsolete:${r.id}:${a.id}`, clientId: r.clientId, disputeIds: [], reportId: r.id, law: 'FCRA § 605(a), (c) — 15 U.S.C. § 1681c', title: `${a.creditor} reported past the 7-year limit on ${r.bureau}`, detail: `Date of first delinquency ${a.dofd}; reportable until about ${until}; still on the report dated ${r.date}.`, severity: 'high' });
    }));
    const seen = new Set();
    return out.filter(x => !seen.has(x.key) && seen.add(x.key)).map(x => Object.assign(x, { review: (ws.violations || {})[x.key] || { status: 'new' } }));
  }

  /** Plain-text evidence packet for an attorney. */
  function packet(ws, clientId, keys, today, company) {
    const c = ws.clients.find(x => x.id === clientId) || {};
    const list = scan(ws, today, clientId).filter(x => !keys || keys.includes(x.key));
    const disputeIds = [...new Set(list.flatMap(x => x.disputeIds))];
    const ds = ws.disputes.filter(d => disputeIds.includes(d.id)).sort((a, b) => String(a.sentAt || a.createdAt).localeCompare(String(b.sentAt || b.createdAt)));
    const lines = [];
    lines.push(`ATTORNEY REVIEW PACKET — ${c.name || ''}`, `Prepared ${today}${company && company.name ? ' by ' + company.name : ''}`, '',
      'This packet lists events that may be violations of the FCRA or FDCPA, with the dates and letters that document them. It is a summary for review by a licensed attorney, not a legal conclusion. The consumer has authorized sharing this information with the attorney.', '',
      `Consumer: ${c.name || ''}`, `Address: ${[c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')}`, `Phone: ${c.phone || ''}  Email: ${c.email || ''}`, '', 'POSSIBLE VIOLATIONS', '');
    list.forEach((x, i) => lines.push(`${i + 1}. ${x.title}`, `   Law: ${x.law}`, `   Facts: ${x.detail}`, ''));
    lines.push('DISPUTE TIMELINE', '');
    ds.forEach(d => {
      lines.push(`• ${(Law.DISPUTE_TYPES[d.type] || {}).label || d.type} → ${d.recipient}`, `  Mailed: ${d.sentAt || '—'}  Received: ${d.receivedAt || '—'}  Due: ${d.dueAt || '—'}  Tracking: ${d.tracking || '—'}`, `  Result: ${d.outcome || 'none recorded'}${d.respondedAt ? ' (' + d.respondedAt + ')' : ''}`);
      d.items.forEach(it => lines.push(`  Item: ${it.creditor}${it.accountNumber ? ' ' + it.accountNumber : ''} — ${it.discrepancy}${it.evidence ? ' Evidence: ' + it.evidence : ''}`));
      lines.push('');
    });
    lines.push('LETTERS SENT', '');
    ds.forEach(d => { const l = ws.letters.find(x => x.id === d.letterId); if (l && l.text) lines.push('-----', l.text, ''); });
    return lines.join('\n');
  }

  const api = { STATUS, scan, packet };
  root.Violations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
