/*
 * Metro 2® reference tables and the accuracy-audit engine.
 *
 * Code values follow the CDIA Credit Reporting Resource Guide (CRRG) as summarised in
 * public furnisher documentation. The engine only flags data that is internally
 * inconsistent, inconsistent across bureaus, or past its FCRA reporting period. It never
 * flags an item merely because it is negative: accurate information cannot be removed
 * through a dispute (15 U.S.C. § 1679c(a)).
 */
(function (root) {
  'use strict';

  const ACCOUNT_STATUS = {
    '05': 'Account transferred',
    '11': 'Current',
    '13': 'Paid or closed, zero balance',
    '61': 'Paid in full — was a voluntary surrender',
    '62': 'Paid in full — was a collection account',
    '63': 'Paid in full — was a repossession',
    '64': 'Paid in full — was a charge-off',
    '65': 'Paid in full — foreclosure started',
    '71': '30–59 days past due',
    '78': '60–89 days past due',
    '80': '90–119 days past due',
    '82': '120–149 days past due',
    '83': '150–179 days past due',
    '84': '180+ days past due',
    '88': 'Claim filed with government',
    '89': 'Deed received in lieu of foreclosure',
    '93': 'Assigned to internal or external collections',
    '94': 'Foreclosure completed',
    '95': 'Voluntary surrender',
    '96': 'Merchandise repossessed',
    '97': 'Unpaid balance charged off',
    'DA': 'Delete entire account (not fraud)',
    'DF': 'Delete entire account (fraud)'
  };

  const DELINQUENT = ['71', '78', '80', '82', '83', '84'];
  const DEROGATORY = DELINQUENT.concat(['88', '89', '93', '94', '95', '96', '97']);
  const PAID_ZERO = ['13', '61', '62', '63', '64', '65'];

  // Payment rating / account status pairs and their 24-month history characters.
  const STATUS_TO_RATING = { '11': '0', '71': '1', '78': '2', '80': '3', '82': '4', '83': '5', '84': '6', '93': 'G', '97': 'L', '94': 'H', '95': 'J', '96': 'K' };

  const PAYMENT_HISTORY = {
    '0': 'Current / 0–29 days past due',
    '1': '30–59 days past due',
    '2': '60–89 days past due',
    '3': '90–119 days past due',
    '4': '120–149 days past due',
    '5': '150–179 days past due',
    '6': '180+ days past due',
    'B': 'No history before this date',
    'D': 'No history for this month',
    'E': 'Zero balance and current',
    'G': 'Collection',
    'H': 'Foreclosure completed',
    'J': 'Voluntary surrender',
    'K': 'Repossession',
    'L': 'Charge-off'
  };

  const PORTFOLIO_TYPE = { C: 'Line of credit', I: 'Installment', M: 'Mortgage', O: 'Open', R: 'Revolving' };

  const ECOA = {
    '1': 'Individual', '2': 'Joint contractual liability', '3': 'Authorized user',
    '5': 'Co-maker', '7': 'Maker', 'T': 'Association terminated', 'W': 'Business / commercial',
    'X': 'Consumer deceased', 'Z': 'Delete consumer'
  };

  const COMPLIANCE_CONDITION = {
    'XA': 'Account closed at consumer’s request',
    'XB': 'Account information disputed by consumer (FCRA) — investigation underway',
    'XC': 'FCRA dispute completed — consumer disagrees',
    'XD': 'Closed at consumer’s request; FCRA dispute underway',
    'XE': 'Closed at consumer’s request; dispute completed — consumer disagrees',
    'XF': 'Account in dispute under FCBA',
    'XG': 'FCBA dispute completed — consumer disagrees',
    'XH': 'Previously in dispute — investigation complete',
    'XJ': 'Closed at consumer’s request; FCBA dispute underway',
    'XR': 'Removes the most recent compliance condition code'
  };
  const DISPUTE_CCC = ['XB', 'XC', 'XD', 'XE', 'XF', 'XG', 'XJ'];

  const CONSUMER_INFO_INDICATOR = {
    'A': 'Chapter 7 petition', 'B': 'Chapter 11 petition', 'C': 'Chapter 12 petition', 'D': 'Chapter 13 petition',
    'E': 'Chapter 7 discharged', 'F': 'Chapter 11 discharged', 'G': 'Chapter 12 discharged', 'H': 'Chapter 13 discharged',
    'I': 'Chapter 7 dismissed', 'J': 'Chapter 11 dismissed', 'K': 'Chapter 12 dismissed', 'L': 'Chapter 13 dismissed',
    'Q': 'Removes previously reported bankruptcy indicator'
  };
  const BK_DISCHARGED = ['E', 'F', 'G', 'H'];

  const SPECIAL_COMMENT = {
    'AU': 'Account paid in full for less than the full balance',
    'M': 'Account closed at credit grantor’s request',
    'AC': 'Paying under a partial payment agreement',
    'AW': 'Affected by natural or declared disaster',
    'CI': 'Account closed due to inactivity'
  };

  const FIELDS = {
    status: 'Account Status (Base 17A)',
    rating: 'Payment Rating (Base 17B)',
    history: 'Payment History Profile (Base 18)',
    balance: 'Current Balance (Base 21)',
    pastDue: 'Amount Past Due (Base 22)',
    chargeOff: 'Original Charge-off Amount (Base 23)',
    limit: 'Credit Limit (Base 12)',
    highCredit: 'Highest Credit (Base 13)',
    dofd: 'Date of First Delinquency (Base 25)',
    closed: 'Date Closed (Base 26)',
    lastPayment: 'Date of Last Payment (Base 27)',
    opened: 'Date Opened (Base 10)',
    reported: 'Date of Account Information (Base 24)',
    ccc: 'Compliance Condition Code (Base 20)',
    ecoa: 'ECOA Code (Base 37)',
    cii: 'Consumer Information Indicator (Base 38)'
  };

  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  function date(v) {
    if (!v) return null;
    const d = new Date(String(v).length === 10 ? v + 'T00:00:00' : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function money(n) { return '$' + Number(n || 0).toLocaleString('en-US'); }
  function fmt(d) { return d ? d.toISOString().slice(0, 10) : '—'; }

  // FCRA § 605(a)(4)-(5), (c): most adverse items may be reported for 7 years, measured from
  // 180 days after the commencement of the delinquency that preceded the charge-off/collection.
  function obsolescenceDate(dofd) {
    const d = date(dofd);
    if (!d) return null;
    const out = new Date(d);
    out.setDate(out.getDate() + 180);
    out.setFullYear(out.getFullYear() + 7);
    return out;
  }

  /**
   * Audit a single tradeline. Returns an array of findings:
   * { code, severity: 'high'|'medium'|'low', title, detail, fields: [], basis, action }
   */
  function auditTradeline(t, opts) {
    const today = date((opts && opts.today) || new Date().toISOString().slice(0, 10));
    const f = [];
    const status = String(t.status || '').toUpperCase();
    const bal = num(t.balance), past = num(t.pastDue), limit = num(t.limit), high = num(t.highCredit), co = num(t.chargeOff);
    const opened = date(t.opened), closed = date(t.closed), lastPay = date(t.lastPayment), dofd = date(t.dofd), reported = date(t.reportedDate);
    const hist = String(t.paymentHistory || '').toUpperCase().replace(/[^0-6BDEGHJKL]/g, '');
    const add = (code, severity, title, detail, fields, basis, action) => f.push({ code, severity, title, detail, fields, basis, action });

    if (status && !ACCOUNT_STATUS[status]) {
      add('M2-STATUS-UNKNOWN', 'low', 'Unrecognised account status',
        `Status “${t.status}” is not a Metro 2 Account Status code. Confirm what the bureau actually displays before relying on this tradeline.`,
        [FIELDS.status], 'Data entry check', 'Verify against the report');
    }

    if (status === '11' && past > 0) {
      add('M2-CURRENT-PASTDUE', 'high', 'Current account reporting an amount past due',
        `Account Status is 11 (current) but Amount Past Due is ${money(past)}. Under the CRRG an account in status 11 reports zero past due; one of these values is inaccurate.`,
        [FIELDS.status, FIELDS.pastDue], 'FCRA § 611; § 623(a)(1)–(2) accuracy duties', 'Dispute the inconsistent field');
    }

    if (PAID_ZERO.includes(status) && bal > 0) {
      add('M2-PAID-BALANCE', 'high', 'Paid/closed status with a balance',
        `Account Status ${status} (${ACCOUNT_STATUS[status]}) requires a zero Current Balance, but ${money(bal)} is reported.`,
        [FIELDS.status, FIELDS.balance], 'FCRA § 611; § 623(a)(2) duty to correct', 'Dispute the balance');
    }

    if (past !== null && bal !== null && past > bal && bal >= 0 && past > 0) {
      add('M2-PASTDUE-GT-BAL', 'high', 'Amount past due exceeds the balance',
        `Amount Past Due (${money(past)}) is greater than Current Balance (${money(bal)}). The past-due amount is a portion of the balance and cannot exceed it.`,
        [FIELDS.pastDue, FIELDS.balance], 'FCRA § 611', 'Dispute the past-due amount');
    }

    if (DEROGATORY.includes(status) && !dofd) {
      add('M2-DOFD-MISSING', 'high', 'Derogatory account with no Date of First Delinquency',
        `Status ${status} is derogatory, but no Date of First Delinquency is reported. Furnishers must report the DOFD for delinquent, collection and charged-off accounts; without it the 7-year reporting period cannot be applied.`,
        [FIELDS.status, FIELDS.dofd], 'FCRA § 623(a)(5) — furnishers must report the delinquency date', 'Dispute the incomplete reporting');
    }

    if (dofd && opened && dofd < opened && status !== '93') {
      add('M2-DOFD-BEFORE-OPEN', 'high', 'Delinquency dated before the account was opened',
        `Date of First Delinquency (${fmt(dofd)}) is earlier than Date Opened (${fmt(opened)}).`,
        [FIELDS.dofd, FIELDS.opened], 'FCRA § 611', 'Dispute the dates');
    }

    if (closed && opened && closed < opened) {
      add('M2-CLOSE-BEFORE-OPEN', 'medium', 'Date closed is earlier than date opened',
        `Date Closed (${fmt(closed)}) precedes Date Opened (${fmt(opened)}).`, [FIELDS.closed, FIELDS.opened], 'FCRA § 611', 'Dispute the dates');
    }

    if (lastPay && reported && lastPay > reported) {
      add('M2-LASTPAY-AFTER-REPORT', 'low', 'Last payment dated after the reporting date',
        `Date of Last Payment (${fmt(lastPay)}) is later than Date of Account Information (${fmt(reported)}).`, [FIELDS.lastPayment, FIELDS.reported], 'FCRA § 611', 'Verify, then dispute if confirmed');
    }

    if (status === '97' && co === null && bal > 0) {
      add('M2-CO-AMOUNT-MISSING', 'low', 'Charge-off without an original charge-off amount',
        'Status 97 is reported without the Original Charge-off Amount. Request that the furnisher complete the record.',
        [FIELDS.chargeOff], 'FCRA § 623(a)(2) — complete and accurate', 'Request correction');
    }

    if (status === '97' && co > 0 && past > co) {
      add('M2-CO-GROWING', 'medium', 'Past-due amount larger than the original charge-off',
        `Past due (${money(past)}) is larger than the original charge-off (${money(co)}). Confirm any post-charge-off interest or fees are permitted by the agreement and are reported accurately.`,
        [FIELDS.pastDue, FIELDS.chargeOff], 'FCRA § 611', 'Request verification');
    }

    if (status === '05' && bal > 0) {
      add('M2-TRANSFER-BALANCE', 'high', 'Transferred/sold account still carries a balance',
        `Status 05 (transferred) should report a zero balance because the debt is now owned elsewhere. ${money(bal)} is reported, which can double-count the same debt.`,
        [FIELDS.status, FIELDS.balance], 'FCRA § 611; § 623(a)(2)', 'Dispute the balance');
    }

    if (BK_DISCHARGED.includes(String(t.cii || '').toUpperCase()) && bal > 0) {
      add('M2-BK-BALANCE', 'high', 'Discharged in bankruptcy but still reporting a balance',
        `Consumer Information Indicator ${t.cii} (${CONSUMER_INFO_INDICATOR[String(t.cii).toUpperCase()]}) is reported together with a ${money(bal)} balance. Discharged debts should report a zero balance.`,
        [FIELDS.cii, FIELDS.balance], 'FCRA § 611; § 623(a)(2)', 'Dispute the balance');
    }

    if (hist) {
      const latest = hist[0];
      const expected = STATUS_TO_RATING[status];
      if (expected && latest && /[0-6GHJKL]/.test(latest) && latest !== expected && !(status === '11' && latest === 'E')) {
        add('M2-HISTORY-MISMATCH', 'medium', 'Payment history disagrees with the account status',
          `The most recent month in the Payment History Profile is “${latest}” (${PAYMENT_HISTORY[latest]}), but the Account Status ${status} implies “${expected}”.`,
          [FIELDS.history, FIELDS.status], 'FCRA § 611', 'Dispute the inconsistent month');
      }
      if (/[1-6GL]/.test(hist) && !dofd && DEROGATORY.indexOf(status) === -1 && !PAID_ZERO.includes(status) && status !== '11') {
        add('M2-HISTORY-NO-DOFD', 'low', 'Delinquent months shown with no delinquency date',
          'The payment grid shows delinquency but no Date of First Delinquency is reported.', [FIELDS.history, FIELDS.dofd], 'FCRA § 623(a)(5)', 'Request the DOFD');
      }
    }

    if (dofd && DEROGATORY.concat(PAID_ZERO).includes(status)) {
      const purge = obsolescenceDate(t.dofd);
      if (purge && today && purge <= today) {
        add('FCRA-OBSOLETE', 'high', 'Past the 7-year reporting period',
          `Based on the reported DOFD (${fmt(dofd)}), this item became obsolete on ${fmt(purge)} and should no longer appear on consumer reports.`,
          [FIELDS.dofd], 'FCRA § 605(a), (c)', 'Request deletion of obsolete information');
      } else if (purge && today) {
        const days = Math.round((purge - today) / 86400000);
        if (days <= 180) {
          add('FCRA-OBSOLETE-SOON', 'low', 'Reaching the end of its reporting period',
            `This item is scheduled to age off on ${fmt(purge)} (${days} days). A dispute is not needed; diary the date and confirm removal.`,
            [FIELDS.dofd], 'FCRA § 605(c)', 'Diary the purge date');
        }
      }
    }

    if (t.consumerDisputed && !DISPUTE_CCC.includes(String(t.complianceCode || '').toUpperCase())) {
      add('M2-CCC-MISSING', 'low', 'Disputed account not marked as disputed',
        'The consumer has disputed this account, but no dispute Compliance Condition Code (e.g. XB) is reported. A furnisher that knows information is disputed must report it as disputed.',
        [FIELDS.ccc], 'FCRA § 623(a)(3)', 'Notify the furnisher');
    }

    if (String(t.ecoa || '') === '3' && DEROGATORY.includes(status)) {
      add('INFO-AU-DEROG', 'low', 'Derogatory account where the consumer is an authorized user',
        'ECOA 3 means the consumer is an authorized user and not contractually liable. The consumer may ask the card issuer to remove them as an authorized user.',
        [FIELDS.ecoa], 'Informational — not an inaccuracy by itself', 'Contact the issuer');
    }

    if (limit !== null && high !== null && String(t.type || '').toUpperCase() === 'I' && limit > 0 && limit !== high) {
      // Installment accounts report Highest Credit as the original loan amount; Credit Limit is normally zero.
      add('M2-INSTALL-LIMIT', 'low', 'Installment loan reporting a credit limit',
        'For installment loans the CRRG uses Highest Credit/Original Amount; a separate credit limit is unusual. Verify how the bureau displays it.',
        [FIELDS.limit, FIELDS.highCredit], 'Data quality', 'Verify');
    }

    if (t.issue && String(t.issue).trim()) {
      add('CONSUMER-ASSERTED', 'medium', 'Consumer-reported inaccuracy',
        `${t.issue}${t.evidence ? ' — evidence: ' + t.evidence : ''}`, [], 'FCRA § 611(a)(1)', 'Dispute with supporting evidence');
    }
    return f;
  }

  const CREDITOR_NOISE = new Set(['bank', 'na', 'inc', 'llc', 'corp', 'co', 'card', 'cards', 'services', 'svcs', 'the', 'usa']);
  function normCreditor(s) {
    return String(s || '').toLowerCase().replace(/\./g, '').split(/[^a-z0-9]+/).filter(w => w && !CREDITOR_NOISE.has(w)).join('');
  }
  function last4(s) { const d = String(s || '').replace(/\D/g, ''); return d.slice(-4); }
  function matchKey(t) { return normCreditor(t.creditor) + ':' + (last4(t.accountNumber) || ''); }

  /**
   * Compare the same tradeline across bureaus. `reports` is a list of { bureau, accounts }.
   * Returns [{ key, creditor, byBureau: {Experian: t, ...}, differences: [{field, values}] }].
   */
  function compareBureaus(reports) {
    const groups = {};
    reports.forEach(r => (r.accounts || []).forEach(t => {
      const k = matchKey(t);
      groups[k] = groups[k] || { key: k, creditor: t.creditor, byBureau: {} };
      groups[k].byBureau[r.bureau] = Object.assign({ reportId: r.id }, t);
    }));
    const checks = [
      ['status', 'Account status'], ['balance', 'Balance'], ['pastDue', 'Amount past due'], ['dofd', 'Date of first delinquency'],
      ['opened', 'Date opened'], ['limit', 'Credit limit'], ['lastPayment', 'Date of last payment'], ['closed', 'Date closed']
    ];
    return Object.values(groups).map(g => {
      const bureaus = Object.keys(g.byBureau);
      const differences = [];
      if (bureaus.length > 1) {
        checks.forEach(([field, label]) => {
          const values = {};
          bureaus.forEach(b => { const v = g.byBureau[b][field]; values[b] = v === undefined || v === null ? '' : String(v); });
          const distinct = new Set(Object.values(values).filter(v => v !== ''));
          if (distinct.size > 1) differences.push({ field, label, values });
        });
      }
      return Object.assign(g, { bureaus, differences });
    });
  }

  /** Same debt reported with a balance by more than one owner (original creditor + collector). */
  function duplicateDebts(accounts) {
    const out = [];
    const collections = accounts.filter(a => a.originalCreditor && num(a.balance) > 0);
    collections.forEach(c => {
      accounts.forEach(o => {
        if (o === c || num(o.balance) <= 0) return;
        if (normCreditor(o.creditor) === normCreditor(c.originalCreditor)) {
          out.push({ collector: c, original: o, detail: `${c.creditor} (collecting for ${c.originalCreditor}) and ${o.creditor} both report a balance for what appears to be the same debt. Only the current owner should report a balance.` });
        }
      });
    });
    return out;
  }

  function auditReport(report, opts) {
    const findings = [];
    (report.accounts || []).forEach(t => auditTradeline(t, opts).forEach(x => findings.push(Object.assign({ accountId: t.id, creditor: t.creditor, bureau: report.bureau, reportId: report.id }, x))));
    duplicateDebts(report.accounts || []).forEach(d => findings.push({
      accountId: d.original.id, creditor: d.original.creditor, bureau: report.bureau, reportId: report.id,
      code: 'M2-DUPLICATE-DEBT', severity: 'high', title: 'Same debt reported with two balances', detail: d.detail,
      fields: [FIELDS.balance, FIELDS.status], basis: 'FCRA § 611; § 623(a)(2)', action: 'Dispute the duplicate balance'
    }));
    return findings;
  }

  const api = {
    ACCOUNT_STATUS, PAYMENT_HISTORY, PORTFOLIO_TYPE, ECOA, COMPLIANCE_CONDITION, CONSUMER_INFO_INDICATOR, SPECIAL_COMMENT, FIELDS,
    DELINQUENT, DEROGATORY, PAID_ZERO,
    auditTradeline, auditReport, compareBureaus, duplicateDebts, obsolescenceDate, matchKey
  };
  root.Metro2 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
