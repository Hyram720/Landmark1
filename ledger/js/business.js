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

  const STARTER_VENDORS = [
    { vendor: 'Uline', category: 'Shipping & packaging', terms: 'Net 30', reportsTo: 'Commonly reported to D&B — verify' },
    { vendor: 'Quill', category: 'Office supplies', terms: 'Net 30', reportsTo: 'Commonly reported to D&B — verify' },
    { vendor: 'Grainger', category: 'Industrial supplies', terms: 'Net 30', reportsTo: 'Verify reporting' },
    { vendor: 'CreditStrong Business', category: 'Credit-builder account', terms: 'Monthly', reportsTo: 'Equifax Business, PayNet, SBFE per company — verify' },
    { vendor: 'Nav Prime', category: 'Monitoring + tradeline', terms: 'Monthly', reportsTo: 'Verify current reporting' }
  ];

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

  const api = { SCORE_MODELS, FOUNDATION, STARTER_VENDORS, BUREAU_CONTACTS, fundability };
  root.Business = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
