/*
 * Buying an operating business: deal tracker, due-diligence checklist with links to official
 * live searches, simple valuation checks and red flags, and a printable report.
 * Helps a client evaluate a real business with real history — not to borrow another company's
 * credit. Any change of ownership must be disclosed accurately to lenders.
 */
(function (root) {
  'use strict';

  const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  const enc = encodeURIComponent;
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

  const LINKS = {
    ocSearch: (name, st) => (name || st) ? `https://opencorporates.com/companies?q=${enc(name || '')}${st ? '&jurisdiction_code=us_' + st.toLowerCase() : ''}` : 'https://opencorporates.com/',
    opencorporates: d => `https://opencorporates.com/companies?q=${enc(d.name || '')}${d.state ? '&jurisdiction_code=us_' + d.state.toLowerCase() : ''}`,
    dnb: () => 'https://www.dnb.com/en-us/smb/duns/duns-lookup.html',
    pacer: () => 'https://pcl.uscourts.gov/',
    irs8821: () => 'https://www.irs.gov/forms-pubs/about-form-8821',
    sba: () => 'https://www.sba.gov/business-guide/plan-your-business/buy-existing-business-or-franchise',
    listings: st => st && STATES[st] ? `https://www.bizbuysell.com/${slug(STATES[st])}-businesses-for-sale/` : 'https://www.bizbuysell.com/businesses-for-sale/'
  };

  // Sellers of aged "shelf" companies (entities formed and held inactive by the seller, then sold).
  // Inventory, states and prices change daily — the seller's site is the live source. Seller
  // claims ("clean", "no debts") must be verified with the state and the checklist below.
  const SHELF_SELLERS = [
    { name: 'Wyoming Corporate Services', url: 'https://wyomingcompany.com/aged-corporation/', states: 'Wyoming plus other states', note: 'Long-running seller; lists thousands of aged corporations and LLCs with certificates of good standing. Sales are non-refundable.' },
    { name: 'Corporations Today', url: 'https://corporationstoday.com/', states: 'About 25 states', note: 'Aged corporations and LLCs sold without an EIN or activity.' },
    { name: 'Asset Profile', url: 'https://assetprofile.com/shelf-companies-for-sale/', states: 'Multiple states (DE, NV, WY and others)', note: 'Ready-made and aged shelf companies.' },
    { name: 'ShelfCompany.info', url: 'https://shelfcompany.info/', states: 'Says all 50 states', note: 'Pre-registered shelf companies; confirm the exact state and formation date before paying.' },
    { name: 'Tresp Corporate Services', url: 'https://trespcs.com/aged-shelf-companies/', states: 'Wyoming', note: 'Aged Wyoming LLCs and corporations.' },
    { name: 'DealStream — shelf companies', url: 'https://dealstream.com/d/financial/shelf/2inx70', states: 'Listings from many sellers (DE, NV, CA, TX, FL…)', note: 'Marketplace; each listing is a different seller.' }
  ];

  // Due-diligence checks. `link` returns a live search URL where one exists.
  const CHECKS = [
    // Identity & standing
    { key: 'filing', group: 'Identity & standing', label: 'Entity is active and in good standing with the Secretary of State', why: 'Inactive, dissolved or forfeited entities cannot be sold as going concerns without reinstatement — and reinstating one you do not own is not allowed.', link: d => LINKS.opencorporates(d), linkText: 'Search state records' },
    { key: 'owners', group: 'Identity & standing', label: 'Seller is the documented owner (officers, members, stock or membership ledger)', why: 'Only the real owner can sell. Get the operating agreement or bylaws and ownership records.' },
    { key: 'age', group: 'Identity & standing', label: 'Formation date and operating history verified (not just a shelf entity)', why: 'Confirm the business actually operated — tax returns, bank statements, customers — not only that a filing exists.' },
    { key: 'goodstanding', group: 'Identity & standing', label: 'Certificate of good standing ordered from the state', why: 'Official proof of status as of a current date; lenders and escrow often require it.' },
    // Liens, judgments, debts
    { key: 'ucc', group: 'Liens, judgments & debts', label: 'UCC lien search (Secretary of State)', why: 'UCC-1 filings show lenders with a security interest in the business’s assets. Liens must be paid off or released at closing.', link: d => LINKS.opencorporates(d), linkText: 'Find the state filing office' },
    { key: 'taxliens', group: 'Liens, judgments & debts', label: 'Federal and state tax lien search (county recorder and Secretary of State)', why: 'Tax liens can follow the assets and, in some purchases, the buyer.' },
    { key: 'judgments', group: 'Liens, judgments & debts', label: 'Judgment and lawsuit search (state and county courts)', why: 'Pending suits and unpaid judgments affect value and may transfer in a stock purchase.' },
    { key: 'bankruptcy', group: 'Liens, judgments & debts', label: 'Federal bankruptcy and federal case search (PACER)', why: 'Shows bankruptcies and federal lawsuits involving the business or owners.', link: () => LINKS.pacer(), linkText: 'PACER case locator' },
    { key: 'bizcredit', group: 'Liens, judgments & debts', label: 'Business credit reports (D&B, Experian, Equifax) with the seller’s permission', why: 'Shows payment history, collections, liens and judgments reported on the business.', link: () => LINKS.dnb(), linkText: 'D-U-N-S lookup' },
    { key: 'debts', group: 'Liens, judgments & debts', label: 'Debt schedule, leases and personal guarantees disclosed', why: 'Know every loan, equipment lease, merchant cash advance and guarantee before you sign.' },
    // Taxes
    { key: 'irs', group: 'Taxes', label: 'IRS account transcripts (seller signs Form 8821 or 4506-C)', why: 'Confirms filed returns and any balance owed to the IRS.', link: () => LINKS.irs8821(), linkText: 'Form 8821' },
    { key: 'statetax', group: 'Taxes', label: 'State sales and payroll tax clearance letter', why: 'Many states hold a buyer liable for the seller’s unpaid sales tax unless a clearance certificate is obtained before closing.' },
    { key: 'bulksale', group: 'Taxes', label: 'Bulk-sale / successor-liability notice filed where the state requires it', why: 'Some states require notifying the tax department before buying a business’s assets.' },
    // Financials
    { key: 'returns', group: 'Financials', label: '3 years of business tax returns match the profit-and-loss statements', why: 'Numbers in a listing are the seller’s claims; tax returns are the check.' },
    { key: 'bank', group: 'Financials', label: '12–24 months of bank statements support the stated revenue', why: 'Deposits should line up with reported sales.' },
    { key: 'receivables', group: 'Financials', label: 'Accounts receivable/payable aging and inventory count reviewed', why: 'Old receivables and unpaid vendors change what you are really buying.' },
    // Operations
    { key: 'licenses', group: 'Operations', label: 'Licenses and permits can be transferred or re-issued to the buyer', why: 'Some licenses are personal to the owner and must be re-applied for.' },
    { key: 'lease', group: 'Operations', label: 'Lease can be assigned (landlord consent in writing)', why: 'A business without its location may be worth far less.' },
    { key: 'contracts', group: 'Operations', label: 'Key customer, supplier and franchise contracts are assignable', why: 'Change-of-control clauses can end contracts at sale.' },
    { key: 'employees', group: 'Operations', label: 'Employees, contractors and payroll records reviewed', why: 'Misclassified workers and unpaid wages can carry over.' },
    { key: 'reputation', group: 'Operations', label: 'Online reviews, BBB and complaint history checked', why: 'Reputation is part of the value you are paying for.' },
    // Structure & closing
    { key: 'structure', group: 'Structure & closing', label: 'Asset vs. stock purchase decided with a CPA and attorney', why: 'Asset purchases usually leave old liabilities with the seller but start a new credit file; stock purchases keep the entity, its history and its liabilities.' },
    { key: 'escrow', group: 'Structure & closing', label: 'Escrow, holdback and seller representations & indemnities in the purchase agreement', why: 'Protects you if undisclosed debts or problems appear after closing.' },
    { key: 'disclose', group: 'Structure & closing', label: 'Plan to disclose the ownership change and date accurately to lenders and bureaus', why: 'Business credit history belongs to the entity. Lenders ask about ownership changes; misstating time in business or ownership on an application can be fraud.' }
  ];

  const STATUS = [['pending', 'To do'], ['clear', 'Clear'], ['issue', 'Issue found'], ['na', 'Not applicable']];

  const yearsBetween = (from, to) => { if (!from) return null; const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00'); return isNaN(a) ? null : Math.round(((b - a) / (365.25 * 864e5)) * 10) / 10; };

  /** Progress, red flags and simple valuation checks for a deal. */
  function evaluate(d, today) {
    const checks = d.checks || {};
    const done = CHECKS.filter(c => ['clear', 'na'].includes((checks[c.key] || {}).status)).length;
    const issues = CHECKS.filter(c => (checks[c.key] || {}).status === 'issue');
    const flags = issues.map(c => ({ sev: 'high', text: `${c.label}: ${(checks[c.key] || {}).note || 'issue found'}` }));
    const years = yearsBetween(d.formedOn, today);
    const price = Number(d.askingPrice) || 0, sde = Number(d.sde) || 0, rev = Number(d.revenue) || 0;
    const multiple = price && sde ? Math.round((price / sde) * 10) / 10 : null;
    const revMultiple = price && rev ? Math.round((price / rev) * 100) / 100 : null;
    if (years !== null && years < 2) flags.push({ sev: 'medium', text: `Only ${years} years since formation — limited history to verify.` });
    if (multiple !== null && multiple > 4) flags.push({ sev: 'medium', text: `Asking price is ${multiple}× seller’s discretionary earnings — high for most small businesses (often 2–3.5×). Ask how it was valued.` });
    if (price && !sde && !rev) flags.push({ sev: 'medium', text: 'No revenue or earnings figures yet — get financials before negotiating.' });
    if (!d.formedOn) flags.push({ sev: 'low', text: 'Formation date not recorded yet.' });
    return { done, total: CHECKS.length, pct: Math.round((done / CHECKS.length) * 100), issues: issues.length, flags, years, multiple, revMultiple };
  }

  /** Plain-text due-diligence report. */
  function report(d, client, today, company) {
    const e = evaluate(d, today);
    const checks = d.checks || {};
    const groups = [...new Set(CHECKS.map(c => c.group))];
    const lab = Object.fromEntries(STATUS);
    const L = [`DUE-DILIGENCE REPORT — ${d.name}`, `Prepared ${today}${company && company.name ? ' by ' + company.name : ''} for ${client.name}`, '',
      `State: ${d.state || '—'}  Entity #: ${d.entityNumber || '—'}  Formed: ${d.formedOn || '—'}${e.years !== null ? ` (${e.years} years)` : ''}`,
      `Asking price: ${d.askingPrice ? '$' + Number(d.askingPrice).toLocaleString() : '—'}  Revenue: ${d.revenue ? '$' + Number(d.revenue).toLocaleString() : '—'}  SDE: ${d.sde ? '$' + Number(d.sde).toLocaleString() : '—'}${e.multiple !== null ? `  (${e.multiple}× SDE)` : ''}`,
      `Structure: ${d.structure || 'undecided'}  Listing: ${d.listingUrl || '—'}`, '', `Progress: ${e.done} of ${e.total} checks complete · ${e.issues} issue(s)`, ''];
    if (e.flags.length) { L.push('RED FLAGS'); e.flags.forEach(f => L.push(`  • ${f.text}`)); L.push(''); }
    groups.forEach(g => { L.push(g.toUpperCase()); CHECKS.filter(c => c.group === g).forEach(c => { const s = checks[c.key] || {}; L.push(`  [${lab[s.status || 'pending']}] ${c.label}${s.note ? ' — ' + s.note : ''}`); }); L.push(''); });
    L.push('This checklist organizes the buyer’s review. It is not legal, tax or accounting advice — have an attorney and CPA review the purchase agreement and structure before closing.');
    return L.join('\n');
  }

  const api = { STATES, LINKS, SHELF_SELLERS, CHECKS, STATUS, evaluate, report, yearsBetween };
  root.Acquisition = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
