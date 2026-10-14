/*
 * Business credit reference data: bureaus and score models, the "fundability" foundation
 * checklist lenders and bureaus look for, and starter vendor (net-30) tradelines.
 * Business credit is not covered by the FCRA or CROA unless a personal guarantor's consumer
 * report is involved. Business bureaus take corrections through their own processes.
 */
(function (root) {
  'use strict';

  const SCORE_MODELS = [
    { key: 'paydex', bureau: 'Dun & Bradstreet', name: 'PAYDEX', min: 1, max: 100, good: 80, note: '80+ means suppliers are paid on time. Based on payment experiences reported to D&B.' },
    { key: 'intelliscore', bureau: 'Experian Business', name: 'Intelliscore Plus', min: 1, max: 100, good: 76, note: 'Higher is lower risk. 76–100 is the lowest-risk band.' },
    { key: 'fsr', bureau: 'Experian Business', name: 'Financial Stability Risk', min: 1, max: 5, good: 1, lowerIsBetter: true, note: '1 = lowest risk of financial distress.' },
    { key: 'eqx-payment', bureau: 'Equifax Business', name: 'Payment Index', min: 0, max: 100, good: 90, note: '90+ means obligations are paid as agreed.' },
    { key: 'eqx-risk', bureau: 'Equifax Business', name: 'Business Credit Risk Score', min: 101, max: 992, good: 700, note: 'Predicts severe delinquency. Higher is better.' },
    { key: 'eqx-failure', bureau: 'Equifax Business', name: 'Business Failure Score', min: 1000, max: 1880, good: 1500, note: 'Predicts business failure. Higher is better.' },
    { key: 'sbss', bureau: 'FICO', name: 'FICO SBSS', min: 0, max: 300, good: 160, note: 'Combines business and owner credit. Used by many lenders and SBA 7(a) small-loan prescreening.' }
  ];

  const FOUNDATION = [
    { key: 'entity', label: 'Entity formed and in good standing with the Secretary of State', why: 'Lenders verify the business is active.' },
    { key: 'ein', label: 'EIN issued by the IRS', why: 'Separates the business tax identity from the owner’s SSN.' },
    { key: 'nameMatch', label: 'Same legal name and address on IRS, state filing, bank, licenses and bureau files', why: 'Mismatches cause failed identity checks and split files.' },
    { key: 'address', label: 'Commercial or verifiable physical business address', why: 'Some underwriting flags PO boxes and some virtual addresses.' },
    { key: 'phone', label: 'Business phone number listed in directories (411)', why: 'Lenders look up the listing.' },
    { key: 'web', label: 'Website and email on the business domain', why: 'Shows an operating business.' },
    { key: 'bank', label: 'Business bank account with steady deposits', why: 'Bank rating and cash flow drive approvals.' },
    { key: 'duns', label: 'D-U-N-S Number and D&B file', why: 'Needed for a PAYDEX score.' },
    { key: 'naics', label: 'Accurate NAICS/SIC industry code', why: 'Some industries are treated as high risk.' },
    { key: 'licenses', label: 'Licenses and permits on file', why: 'Required for many lenders and vendors.' },
    { key: 'books', label: 'Separate bookkeeping and financial statements', why: 'Needed for larger credit lines and loans.' },
    { key: 'guarantor', label: 'Owner’s personal credit reviewed (personal guarantee)', why: 'Most early business credit is underwritten on the owner too.' },
    { key: 'monitoring', label: 'Business credit monitoring set up (e.g. Nav)', why: 'Catch errors and see what lenders see.' },
    { key: 'tradelines', label: '3–5 vendor or credit accounts reporting on-time payments', why: 'Payment history builds the file.' }
  ];

  // Bureau reporting changes and sources disagree — always confirm with the vendor's credit department.
  const STARTER_VENDORS = [
    { vendor: 'Uline', category: 'Shipping & packaging', terms: 'Net 30', reportsTo: 'D&B per most sources; some say Experian too — confirm' },
    { vendor: 'Quill', category: 'Office supplies', terms: 'Net 30', reportsTo: 'D&B and/or Experian per sources — confirm' },
    { vendor: 'Grainger', category: 'Industrial supplies', terms: 'Net 30', reportsTo: 'D&B per sources — confirm' },
    { vendor: 'Crown Office Supplies', category: 'Office supplies (credit-builder program)', terms: 'Net 30 · annual fee', reportsTo: 'SBFE and Creditsafe, shared with D&B/Experian/Equifax per Ramp — confirm' },
    { vendor: 'Summa Office Supplies', category: 'Office supplies', terms: 'Net 30', reportsTo: 'Equifax and Experian Business per Tipalti — confirm' },
    { vendor: 'CreditStrong Business', category: 'Credit-builder account', terms: 'Monthly', reportsTo: 'Business bureaus per company — confirm current list' },
    { vendor: 'Nav Prime', category: 'Monitoring + tradeline', terms: 'Monthly', reportsTo: 'Verify current reporting' }
  ];

  /**
   * 90-day fast-track plan for a new business. Each step has a day offset; steps tied to a
   * foundation checklist item count as done when that item is checked.
   */
  const FAST_TRACK = [
    { day: 0, key: 'foundation', checklist: ['entity', 'ein', 'nameMatch', 'address', 'bank'], title: 'Foundation: entity in good standing, EIN, one legal name and address everywhere, business bank account', how: 'Use the exact same legal name, address and phone on the state filing, IRS, bank, licenses and every application.' },
    { day: 1, key: 'phone-web', checklist: ['phone', 'web', 'naics'], title: 'Business phone listed in 411, website and domain email, accurate NAICS code', how: 'Lenders verify the phone listing and website. Pick the NAICS code that truly describes the business — some codes are treated as higher risk.' },
    { day: 1, key: 'duns', checklist: ['duns'], title: 'Request a free D-U-N-S Number from Dun & Bradstreet', how: 'Free at dnb.com (Get a D-U-N-S). D&B says it can take up to 30 business days — there is no need to pay for expedited service to build credit.', url: 'https://www.dnb.com/en-us/smb/duns/get-a-duns.html' },
    { day: 3, key: 'monitor', checklist: ['monitoring'], title: 'Set up business credit monitoring (e.g. Nav)', how: 'Watch the D&B, Experian and Equifax business files appear and catch errors early.' },
    { day: 7, key: 'vendors1', title: 'Open 2–3 starter net-30 vendor accounts', how: 'Choose vendors you will actually use (see the starter list). Make a small real purchase with each and pay before the due date — PAYDEX rewards paying early.' },
    { day: 10, key: 'builder', title: 'Add a business credit-builder account', how: 'An installment-style builder account adds another reporting tradeline while vendor accounts season.' },
    { day: 30, key: 'verify', title: 'Confirm the first accounts are reporting', how: 'Check your monitoring. If an account is not reporting after a full billing cycle, call the vendor’s credit department with your EIN and D-U-N-S.' },
    { day: 35, key: 'vendors2', checklist: ['tradelines'], title: 'Add 2 more reporting accounts (aim for 3–5 total)', how: 'Spread across bureaus — some vendors report only to D&B, others to Experian or Equifax.' },
    { day: 45, key: 'books', checklist: ['books', 'licenses'], title: 'Bookkeeping, financial statements, licenses and permits in order', how: 'Larger credit lines ask for statements and licenses.' },
    { day: 60, key: 'store', title: 'Apply for a store or fleet account in the business name', how: 'With several reporting tradelines, retail and fleet accounts become easier. Many still ask for a personal guarantee early on.' },
    { day: 75, key: 'scores', title: 'Record business scores (PAYDEX, Intelliscore, Equifax) in Ledger', how: 'Use the score log on this page to track progress.' },
    { day: 90, key: 'next', checklist: ['guarantor'], title: 'Review: business credit card, SBA microloan or line of credit', how: 'Apply only for what the business needs. Owner credit still matters for most early approvals — keep personal utilization low.' }
  ];

  function planStatus(c, today) {
    const plan = c.creditPlan;
    if (!plan || !plan.startedAt) return null;
    const done = c.businessChecklist || {};
    const steps = FAST_TRACK.map(s => {
      const due = addDays(plan.startedAt, s.day);
      const complete = (plan.done || {})[s.key] || (s.checklist && s.checklist.every(k => done[k]));
      return Object.assign({}, s, { due, complete: !!complete, overdue: !complete && due < today });
    });
    return { startedAt: plan.startedAt, steps, done: steps.filter(s => s.complete).length, total: steps.length };
  }
  function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }


  const BUREAU_CONTACTS = {
    'Dun & Bradstreet': 'Update or dispute through D&B’s customer service / D-U-N-S Manager.',
    'Experian Business': 'Use Experian’s business credit dispute and correction request.',
    'Equifax Business': 'Contact Equifax Commercial Services to request a correction.'
  };

  function fundability(c) {
    const done = (c.businessChecklist || {});
    const n = FOUNDATION.filter(f => done[f.key]).length;
    return { done: n, total: FOUNDATION.length, pct: Math.round(n / FOUNDATION.length * 100) };
  }

  const api = { SCORE_MODELS, FOUNDATION, STARTER_VENDORS, BUREAU_CONTACTS, FAST_TRACK, fundability, planStatus };
  root.Business = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
