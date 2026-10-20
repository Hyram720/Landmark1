/*
 * Dispute reasons: turns rules-engine findings (Metro2.auditReport / compareOverTime) into
 * specific, factual dispute items that Letters.build() accepts, and checks a planned letter for
 * frivolous-dispute risk before staff send it.
 *
 * Principles (see kb/ledger-kb.json):
 *  - Only findings that show an actual inconsistency or obsolescence become dispute items.
 *    Informational findings (e.g. "aging off soon", "authorized user") never do.
 *  - Each item names the field, the reported value and why it is wrong, and cites the rule.
 *  - Wording varies per account so a round doesn't read like a mass template, but it is never
 *    padded: one or two plain sentences in the consumer's voice. No "guaranteed deletion" language.
 *  - Anything the consumer must confirm is marked [CONFIRM ...] for staff to resolve.
 */
(function (root) {
  'use strict';

  // code → { kb: [knowledge base ids], letter: default letter type, ask: correction requested, confirm }
  const MAP = {
    'M2-CURRENT-PASTDUE': { kb: ['m2-status', 'fcra-611', 'fcra-623'], letter: 'cra_611', ask: 'Correct the amount past due to $0, or correct the account status if it is actually delinquent.' },
    'M2-PAID-BALANCE': { kb: ['m2-status', 'fcra-611', 'fcra-623'], letter: 'cra_611', ask: 'Report a $0 balance consistent with the paid/closed status.' },
    'M2-PAID-PASTDUE': { kb: ['m2-status', 'fcra-611', 'fcra-623'], letter: 'cra_611', ask: 'Report $0 past due consistent with the paid/closed status.' },
    'M2-PASTDUE-GT-BAL': { kb: ['m2-status', 'fcra-611'], letter: 'cra_611', ask: 'Correct the amount past due so it does not exceed the balance.' },
    'M2-DOFD-MISSING': { kb: ['m2-dofd', 'fcra-623', 'fcra-605'], letter: 'cra_611', ask: 'Report the correct date of first delinquency, or delete the item if it cannot be verified.' },
    'M2-DOFD-BEFORE-OPEN': { kb: ['m2-dofd', 'fcra-611'], letter: 'cra_611', ask: 'Correct the date of first delinquency and date opened.' },
    'M2-DOFD-FUTURE': { kb: ['m2-dofd', 'fcra-611'], letter: 'cra_611', ask: 'Correct the date of first delinquency.' },
    'M2-DOFD-ON-CURRENT': { kb: ['m2-dofd', 'fcra-611'], letter: 'cra_611', ask: 'Remove the delinquency date from this current account.', confirm: 'that this account was never late' },
    'M2-DOFD-REAGED': { kb: ['m2-dofd', 'fcra-623', 'fcra-605'], letter: 'cra_611', ask: 'Report the original date of first delinquency shown by the payment history, and apply the reporting period from that date.' },
    'M2-DOFD-MOVED': { kb: ['m2-dofd', 'fcra-623', 'fcra-605'], letter: 'cra_611', ask: 'Restore the original date of first delinquency reported earlier and apply the reporting period from it.' },
    'M2-CLOSE-BEFORE-OPEN': { kb: ['fcra-611'], letter: 'cra_611', ask: 'Correct the date opened and date closed.' },
    'M2-CO-GROWING': { kb: ['fcra-611'], letter: 'cra_611', ask: 'Verify the amount past due and correct any amount not permitted by the agreement.' },
    'M2-TRANSFER-BALANCE': { kb: ['m2-status', 'fcra-611', 'fcra-623'], letter: 'cra_611', ask: 'Report a $0 balance on the transferred account so the debt is not counted twice.' },
    'M2-BK-BALANCE': { kb: ['fcra-611', 'fcra-623'], letter: 'cra_611', ask: 'Report a $0 balance consistent with the bankruptcy discharge.', confirm: 'the discharge date and that this debt was included' },
    'M2-HISTORY-MISMATCH': { kb: ['m2-history', 'fcra-611'], letter: 'cra_611', ask: 'Correct the most recent payment history month so it matches the account status.' },
    'M2-HISTORY-NO-DOFD': { kb: ['m2-dofd', 'fcra-623'], letter: 'cra_611', ask: 'Report the date of first delinquency for the late months shown.' },
    'M2-DUPLICATE-DEBT': { kb: ['fcra-611', 'fcra-623'], letter: 'cra_611', ask: 'Report a $0 balance on the account that no longer owns the debt.' },
    'M2-DUPLICATE-COLLECTION': { kb: ['fcra-611', 'fcra-623', 'fdcpa-809'], letter: 'cra_611', ask: 'Delete the duplicate collection, or report a balance only for the collector that owns the debt.' },
    'M2-COLLECTION-NO-OC': { kb: ['fcra-611', 'fcra-623'], letter: 'cra_611', ask: 'Report the original creditor name, or delete the item if it cannot be verified.' },
    'M2-CCC-MISSING': { kb: ['m2-ccc', 'fcra-623'], letter: 'furnisher_623', ask: 'Report this account as disputed by the consumer (Compliance Condition Code XB) while the dispute is open.' },
    'M2-CCC-XB-STALE': { kb: ['m2-ccc', 'fcra-623'], letter: 'furnisher_623', ask: 'Update the compliance condition code to reflect that the investigation is complete.' },
    'M2-CO-AMOUNT-MISSING': { kb: ['fcra-623'], letter: 'cra_611', ask: 'Complete the record with the original charge-off amount.' },
    'FCRA-OBSOLETE': { kb: ['fcra-605', 'm2-dofd'], letter: 'obsolete_605', ask: 'Delete this item: it is past the reporting period allowed by FCRA § 605.' },
    'FCRA-OBSOLETE-UNKNOWN': { kb: ['fcra-605', 'm2-dofd'], letter: 'obsolete_605', ask: 'Provide the date of first delinquency relied on, and delete the item if it is past the reporting period.' },
    'FCRA-REINSERTED': { kb: ['fcra-611-reinsert'], letter: 'cra_611', ask: 'Provide the reinsertion notice and the furnisher’s certification, or delete the item.' },
    'CONSUMER-ASSERTED': { kb: ['consumer-asserted', 'fcra-611'], letter: 'cra_611', ask: 'Investigate and correct or delete the information if it cannot be verified as accurate.', confirm: 'every statement and attach the evidence' },
    // ---- personal information and inquiries (js/filecheck.js). Identity theft disputes are out of scope; refer clients to IdentityTheft.gov. ----
    'PII-NAME-VARIANT': { kb: ['pii-611'], letter: 'pii_611', plain: true, say: f => `My file lists a name I have never used: ${f.detail.match(/“([^”]+)”/) ? '“' + f.detail.match(/“([^”]+)”/)[1] + '”' : 'a name variant'}.`, ask: 'Remove this name from my file.', confirm: 'that the client never used this name' },
    'PII-ADDRESS-UNKNOWN': { kb: ['pii-611'], letter: 'pii_611', plain: true, say: f => `My file lists an address where I have never lived or that is out of date: ${f.detail.match(/“([^”]+)”/) ? '“' + f.detail.match(/“([^”]+)”/)[1] + '”' : 'an address'}.`, ask: 'Remove this address from my file. My current address is shown at the top of this letter.', confirm: 'that the client never lived at this address (or that it is outdated)' },
    'PII-EMPLOYER-UNKNOWN': { kb: ['pii-611'], letter: 'pii_611', plain: true, say: f => `My file lists an employer I have never worked for: ${f.detail.match(/“([^”]+)”/) ? '“' + f.detail.match(/“([^”]+)”/)[1] + '”' : 'an employer'}.`, ask: 'Remove this employer from my file.', confirm: 'that the client never worked there' },
    'PII-DOB-VARIATION': { kb: ['pii-611'], letter: 'pii_611', plain: true, say: () => 'My file shows an incorrect date of birth. My correct date of birth is shown at the top of this letter.', ask: 'Remove the incorrect date of birth.' },
    'PII-SSN-VARIATION': { kb: ['pii-611'], letter: 'pii_611', plain: true, say: () => 'My file shows an incorrect Social Security number variation.', ask: 'Remove the incorrect Social Security number variation.' },
    'INQ-UNRECOGNIZED': { kb: ['fcra-604-inquiry', 'fcra-611'], letter: 'inquiry_604', plain: true, say: f => `${f.detail.replace(/ The client says they did not apply or authorize it\./, '')} I did not apply for credit with this company or authorize it to obtain my report.`, ask: 'Verify the permissible purpose for this inquiry and delete it if it cannot be verified.', confirm: 'that the client did not apply with or authorize this company' },
    'INQ-OVER-2Y': { kb: ['inq-2yr'], letter: 'cra_611', plain: true, ask: 'Remove this outdated inquiry under your inquiry retention policy.' },
    // ---- business bureau files (not FCRA § 611 — each bureau’s correction process) ----
    'BIZ-NAME-MISMATCH': { kb: ['biz-dispute-letters', 'biz-fcra-scope'], letter: 'business_correction', plain: true, ask: 'Correct the business name to match our state filing.' },
    'BIZ-ADDRESS-MISMATCH': { kb: ['biz-dispute-letters', 'biz-fcra-scope'], letter: 'business_correction', plain: true, ask: 'Correct the business address to match our records.', confirm: 'the current business address and attach proof' },
    'BIZ-PHONE-MISMATCH': { kb: ['biz-dispute-letters'], letter: 'business_correction', plain: true, ask: 'Correct the business phone number.' },
    'BIZ-FORMED-MISMATCH': { kb: ['biz-dispute-letters', 'corp-fraud-warning'], letter: 'business_correction', plain: true, ask: 'Correct the date of formation to match the state filing (copy enclosed).' },
    'BIZ-YEARS-MISMATCH': { kb: ['biz-dispute-letters', 'corp-fraud-warning'], letter: 'business_correction', plain: true, ask: 'Correct the years in business to match the date of formation on the state filing (copy enclosed).' },
    'BIZ-NAICS-MISMATCH': { kb: ['biz-dispute-letters'], letter: 'business_correction', plain: true, ask: 'Correct the NAICS industry code.' },
    'BIZ-SIC-MISMATCH': { kb: ['biz-dispute-letters'], letter: 'business_correction', plain: true, ask: 'Correct the SIC industry code.' },
    'BIZ-TL-CLOSED-OPEN': { kb: ['biz-dispute-letters'], letter: 'business_correction', plain: true, ask: 'Report this account as closed.' },
    'BIZ-TL-STALE': { kb: ['biz-dispute-letters'], letter: 'business_correction', plain: true, ask: 'Update or remove this stale tradeline.', confirm: 'the current balance or that the account is paid' },
    'BIZ-TL-PAID-BALANCE': { kb: ['biz-dispute-letters'], letter: 'business_correction', plain: true, ask: 'Report a $0 balance consistent with the paid/closed status.' },
    'BIZ-TL-DUPLICATE': { kb: ['biz-dispute-letters'], letter: 'business_correction', plain: true, ask: 'Remove the duplicate tradeline.' },
    'BIZ-PR-SATISFIED-OPEN': { kb: ['biz-dispute-letters'], letter: 'business_correction', plain: true, ask: 'Update this filing to satisfied/released (or terminated). The release document is enclosed.' }
  };
  // Findings that are informational only — they never become dispute items.
  const NOT_DISPUTABLE = new Set(['FCRA-OBSOLETE-SOON', 'INFO-AU-DEROG', 'M2-STATUS-UNKNOWN', 'M2-INSTALL-LIMIT', 'M2-LASTPAY-AFTER-REPORT', 'CONSUMER-ASSERTED-NEEDS-REASON']);

  const OPENERS = [
    s => s,
    s => 'The information reported is internally inconsistent: ' + s.charAt(0).toLowerCase() + s.slice(1),
    s => 'I have reviewed this account and it is reported inaccurately. ' + s
  ];
  function pick(seed, n) { let h = 0; String(seed).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return h % n; }

  function isDisputable(f) { return !!f && !NOT_DISPUTABLE.has(f.code) && !!MAP[f.code]; }

  /** Finding (+ tradeline) → Letters item. Returns null for findings that must not be disputed. */
  function toItem(f, t) {
    if (!isDisputable(f)) return null;
    const m = MAP[f.code];
    const detail = String(f.detail || '').replace(/\s+/g, ' ').trim();
    const said = m.say ? m.say(f) : detail;
    const discrepancy = (m.plain ? said : OPENERS[pick((f.accountId || '') + f.code, OPENERS.length)](detail)) + (m.confirm ? ` [CONFIRM with the client: ${m.confirm}]` : '');
    return {
      accountId: f.accountId || (t && t.id) || '', creditor: f.creditor || (t && t.creditor) || '',
      accountNumber: t && t.accountNumber ? String(t.accountNumber).replace(/\D/g, '').slice(-4) : '',
      bureau: f.bureau || '', discrepancy, requested: m.ask, fields: f.fields || [], basis: f.basis || '',
      code: f.code, kb: m.kb, letterType: m.letter, needsClientConfirmation: !!m.confirm || f.code === 'CONSUMER-ASSERTED'
    };
  }

  const words = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3));
  function similarity(a, b) { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach(w => { if (B.has(w)) n += 1; }); return n / (A.size + B.size - n); }

  /**
   * Frivolous-dispute guard (FCRA § 611(a)(3); Reg V § 1022.43(f)).
   * Blocks an item when the same recipient already has it pending, or already verified it for a
   * near-identical reason and nothing new is offered. Returns { ok, blocked: [...], warnings: [...] }.
   */
  function checkRepeat({ items, recipient, letterType, priorDisputes, newEvidence }) {
    const blocked = [], warnings = [];
    const escalation = ['mov_611a7', 'furnisher_623', 'furnisher_final', 'cfpb_complaint'].includes(letterType);
    (items || []).forEach(it => {
      (priorDisputes || []).filter(d => d.recipient === recipient).forEach(d => {
        (d.items || []).forEach(p => {
          const same = (p.accountId && p.accountId === it.accountId) || String(p.creditor || '').toLowerCase() === String(it.creditor || '').toLowerCase();
          if (!same) return;
          const sim = similarity(p.discrepancy, it.discrepancy);
          if (!d.outcome && d.sentAt) blocked.push({ creditor: it.creditor, why: `Already disputed with ${recipient} (round ${d.round}, mailed ${d.sentAt}) and still awaiting a response.` });
          else if (['deleted', 'corrected'].includes(p.result)) blocked.push({ creditor: it.creditor, why: `${recipient} already ${p.result} this item.` });
          else if ((d.outcome === 'verified' || p.result === 'verified') && sim >= 0.5 && !escalation && !newEvidence) blocked.push({ creditor: it.creditor, why: `${recipient} verified a near-identical dispute (round ${d.round}). Re-sending the same reason risks a frivolous finding — add new evidence or move to a method-of-verification / direct furnisher letter.` });
          else if (sim >= 0.8) warnings.push({ creditor: it.creditor, why: `Wording is very close to round ${d.round}. Make sure something new is included.` });
        });
      });
    });
    const uniq = arr => arr.filter((x, i) => arr.findIndex(y => y.creditor === x.creditor && y.why === x.why) === i);
    if ((items || []).length > 6) warnings.push({ creditor: '', why: `${items.length} items in one letter. Bureaus are more likely to treat long lists as template disputes — split by issue or keep to the strongest items.` });
    return { ok: !uniq(blocked).length, blocked: uniq(blocked), warnings: uniq(warnings) };
  }

  /** All dispute-ready items for a client from their latest report per bureau (+ over-time checks). */
  function suggestionsFor(ws, clientId, opts) {
    const M = root.Metro2;
    const reports = (ws.reports || []).filter(r => r.clientId === clientId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const byBureau = {};
    reports.forEach(r => { (byBureau[r.bureau] = byBureau[r.bureau] || []).push(r); });
    const out = [];
    Object.values(byBureau).forEach(list => {
      const cur = list[list.length - 1], prev = list.length > 1 ? list[list.length - 2] : null;
      const findings = M.auditReport(cur, opts).concat(M.compareOverTime(prev, cur, opts));
      const client = (ws.clients || []).find(c => c.id === clientId) || {};
      const more = root.FileCheck ? root.FileCheck.personalChecks(cur, client, opts) : [];
      findings.concat(more).forEach(f => { const t = (cur.accounts || []).find(a => a.id === f.accountId); const it = toItem(f, t); if (it) out.push(Object.assign(it, { reportId: cur.id, severity: f.severity, title: f.title })); });
    });
    // Business bureau files (latest per bureau).
    const c = (ws.clients || []).find(x => x.id === clientId);
    if (c && root.FileCheck && (c.businessReports || []).length) {
      const latest = {};
      c.businessReports.forEach(r => { if (!latest[r.bureau] || String(r.date) > String(latest[r.bureau].date)) latest[r.bureau] = r; });
      Object.values(latest).forEach(br => root.FileCheck.businessChecks(br, c, opts).forEach(f => { const t = (br.tradelines || []).find(a => a.id === f.accountId); const it = toItem(f, t); if (it) out.push(Object.assign(it, { reportId: br.id, severity: f.severity, title: f.title, business: true })); }));
    }
    return out;
  }

  const api = { MAP, NOT_DISPUTABLE, isDisputable, toItem, checkRepeat, similarity, suggestionsFor };
  root.DisputeReasons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
