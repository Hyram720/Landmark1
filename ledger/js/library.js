/*
 * Library: reference material for staff. Plain-English summaries, not legal advice. Addresses
 * and bureau policies change; each section says what to verify.
 */
(function (root) {
  'use strict';

  // Sections are { tab, title, intro?, items: [[term, text], ...] }. Every item is searchable.
  const SECTIONS = [
    // ---------- Metro 2 field guide ----------
    { tab: 'fields', title: 'Metro 2 Base Segment — fields that matter in disputes', intro: 'Each account a lender reports is one 426-character Base Segment. These are the fields you will compare most often.', items: [
      ['Portfolio Type', 'C line of credit, I installment, M mortgage, O open (e.g. collections, charge cards), R revolving. A credit card reported as installment changes how utilization is calculated.'],
      ['Account Type', 'Two-character code for the product (e.g. credit card, auto loan, student loan, collection). Wrong account type can misstate the account to lenders.'],
      ['Date Opened', 'When the account was opened. For collection accounts it is the date the collector opened its account, not the original delinquency date.'],
      ['Credit Limit / Highest Credit', 'Revolving accounts report a limit; installment loans report the original amount as Highest Credit. A missing limit makes utilization look like 100%.'],
      ['Terms Duration & Frequency', 'Number of payments and how often (M monthly). Used to calculate the scheduled payment.'],
      ['Scheduled Monthly Payment', 'The payment due. Charged-off and collection accounts should report 0.'],
      ['Actual Payment Amount', 'What the consumer paid this cycle.'],
      ['Account Status', 'Current condition: 11 current, 13 paid/zero balance, 71–84 days late, 93 collection, 97 charge-off, 61–65 paid after a derogatory event. Must agree with balance, past-due amount and payment history.'],
      ['Payment Rating', 'Used with statuses 05, 13, 65, 88, 89, 94, 95 to show how the account was rated when it closed or transferred.'],
      ['Payment History Profile', '24 characters, newest month first: 0 current, 1–6 thirty to 180 days late, B no history before, D no data this month, E zero balance and current, G collection, H foreclosure, J voluntary surrender, K repossession, L charge-off. Each month must match what actually happened.'],
      ['Special Comment', 'Context such as AU (paid for less than full balance), M (closed by grantor), AC (partial payment agreement), AW (natural disaster).'],
      ['Compliance Condition Code', 'XA closed at consumer request, XB disputed (FCRA), XC dispute resolved – consumer disagrees, XH dispute resolved, XR removes the code. Furnishers must use XB while a dispute is open (FCRA § 623(a)(3)).'],
      ['Current Balance', 'Balance as of the Date of Account Information. Paid, transferred (05) or bankruptcy-discharged accounts report 0.'],
      ['Amount Past Due', 'Must be 0 for status 11 and can never exceed the balance.'],
      ['Original Charge-off Amount', 'Required with status 97 and 64.'],
      ['Date of Account Information', 'The “as of” date for the reported values.'],
      ['FCRA Compliance / Date of First Delinquency (DOFD)', 'The month the account first went delinquent and never became current again. Sets the 7-year reporting clock (§ 605(c)). It must not change when the debt is sold — a later DOFD on a collection is “re-aging”.'],
      ['Date Closed', 'When the account closed. Should not be before Date Opened.'],
      ['Date of Last Payment', 'Most recent payment. Does not restart the 7-year clock.'],
      ['ECOA Code', '1 individual, 2 joint, 3 authorized user, 5 co-maker, 7 maker, T terminated, X deceased, Z delete consumer. Authorized users are not liable for the debt.'],
      ['Consumer Information Indicator', 'Bankruptcy status: A–D petition filed (Ch. 7, 11, 12, 13), E–H discharged, I–L dismissed, Q removes the indicator. Discharged debts should report a 0 balance.'],
      ['K1 Segment — Original Creditor', 'Collection agencies and debt buyers report the original creditor name and creditor classification here.'],
      ['K2 Segment — Purchased From / Sold To', 'Shows who sold or bought the account. The seller should then report status 05 with a 0 balance.'],
      ['J1/J2 Segments — Associated Consumers', 'Joint borrowers and authorized users on the same account.']
    ] },

    // ---------- Errors & evidence ----------
    { tab: 'errors', title: 'Common reporting errors and how to prove them', intro: 'Dispute only what the client says is wrong, and attach proof. The right evidence matters more than the wording of the letter.', items: [
      ['Account is not mine (identity theft)', 'Evidence: FTC report from IdentityTheft.gov (or police report), photo ID, proof of address. Letter: § 605B identity-theft block (bureau must block within 4 business days). Also place a fraud alert or freeze.'],
      ['Account is not mine (mixed file)', 'Another person with a similar name or SSN. Evidence: ID, SSN card, proof of address history. Letter: § 611 bureau dispute. Ask the bureau to remove the other person’s identifiers too.'],
      ['Wrong balance', 'Evidence: latest statement, payoff letter, or bank record of payment. Letter: § 611 to the bureau, § 623 direct dispute to the furnisher.'],
      ['Late payment that was paid on time', 'Evidence: bank statement or confirmation showing the payment date, autopay records. Letter: § 611 / § 623 naming the exact month in the payment grid.'],
      ['Paid or settled account still shows a balance', 'Evidence: paid-in-full or settlement letter and proof of payment. Status should be 13, 61–65 or carry special comment AU with a 0 balance.'],
      ['Same debt reported twice', 'Original creditor and collector (or two collectors) both report a balance. Evidence: report pages showing both, sale/assignment notice if any. Only the current owner may report a balance.'],
      ['Re-aged debt (wrong DOFD)', 'Collector reports a later delinquency date than the original creditor. Evidence: original creditor tradeline or statements showing the first missed payment. Letter: § 611 / § 623 citing § 623(a)(5).'],
      ['Item older than 7 years', 'Evidence: report showing DOFD. Letter: § 605 obsolete-information request.'],
      ['Discharged in bankruptcy but still shows a balance', 'Evidence: discharge order and schedules listing the creditor. Should report 0 balance with CII E–H.'],
      ['Closed by me, reported as closed by creditor', 'Evidence: closure confirmation. Should use compliance code XA instead of special comment M.'],
      ['Authorized-user account hurting the client', 'Not an error (ECOA 3). Ask the card issuer to remove the client as an authorized user; it then drops off.'],
      ['Account shows open/active but was closed', 'Evidence: closure letter. Date Closed and status should reflect the closure.'],
      ['Wrong credit limit or no limit', 'Evidence: statement showing the limit. A missing limit inflates utilization.'],
      ['Student loan reported delinquent during deferment/forbearance', 'Evidence: servicer approval letter for the deferment period. Months in deferment should not show as late.'],
      ['Unauthorized hard inquiry', 'Evidence: client statement they did not apply. Ask the bureau to verify permissible purpose (§ 604); contact the creditor directly. If fraud, use § 605B.'],
      ['Wrong personal information', 'Old names, addresses, employers, or wrong SSN variations. Evidence: ID and proof of current address. Ask the bureau to remove inaccurate identifiers — they can cause mixed files.'],
      ['Collection with no validation', 'Within the validation period (30 days after the validation notice + 5 days for mailing under Reg F), send a § 809(b) validation request. Collection must pause until validated.'],
      ['Medical collection that should not report', 'The bureaus no longer report paid medical collections, medical collections under $500, or medical debt less than a year old (bureau policy since 2022–2023). Evidence: payment proof or dates.'],
      ['Accurate negative item', 'Not an error — do not dispute. Options: goodwill letter, pay-for-delete negotiation with a collector, settle and get AU special comment, rebuild positive credit, and wait for the purge date.']
    ] },

    // ---------- Laws ----------
    { tab: 'laws', title: 'Fair Credit Reporting Act (FCRA) — plain English', items: [
      ['§ 604 Permissible purpose', 'A report can only be pulled for a legitimate reason (credit application, account review, employment with consent, insurance, etc.). Unauthorized pulls can be challenged.'],
      ['§ 605 Obsolete information', 'Most negative items: 7 years from DOFD + 180 days. Bankruptcies: up to 10 years. Exceptions for large credit or employment decisions.'],
      ['§ 605A Fraud alerts and freezes', 'Initial fraud alert lasts 1 year, extended alert 7 years (with identity-theft report), active-duty alert 1 year. Security freezes are free at all three bureaus.'],
      ['§ 605B Identity-theft block', 'With proof of identity, an identity-theft report and the items, the bureau must block them within 4 business days and notify the furnisher.'],
      ['§ 609 File disclosure', 'Consumers can get everything in their file and the sources. No special wording required.'],
      ['§ 611 Reinvestigation', '30 days from receipt (45 if the consumer adds information during the period or disputes after a free annual report). Bureau must notify the furnisher within 5 business days, delete what cannot be verified, and send results within 5 business days of finishing. On request, describe how it verified within 15 days (§ 611(a)(7)). Frivolous notices within 5 business days. Reinserted items require notice within 5 business days.'],
      ['§ 612 Free reports', 'Free weekly online reports from each bureau at AnnualCreditReport.com, plus free reports after adverse action.'],
      ['§ 615 Adverse action', 'If credit is denied based on a report, the lender must say which bureau and how to get a free copy within 60 days.'],
      ['§ 616 / § 617 Civil liability', 'Willful violations: actual damages or $100–$1,000 statutory damages, plus punitive damages and attorney fees. Negligent violations: actual damages and attorney fees.'],
      ['§ 618 Time limit to sue', '2 years from discovering the violation, and no more than 5 years from the violation.'],
      ['§ 623 Furnisher duties', 'Report accurately, correct errors, report disputed accounts as disputed, report the DOFD within 90 days, and investigate disputes (forwarded by a bureau or sent directly under Reg V § 1022.43).']
    ] },
    { tab: 'laws', title: 'Credit Repair Organizations Act (CROA)', items: [
      ['§ 1679b Prohibited practices', 'No untrue or misleading statements to bureaus or creditors, no advice to create a new identity (CPN / EIN instead of SSN), no false claims about services, and no payment before services are fully performed.'],
      ['§ 1679c Disclosure', 'Give the “Consumer Credit File Rights Under State and Federal Law” statement as a separate document before the contract. Keep the signed copy 2 years.'],
      ['§ 1679d Contract', 'Written contract with total cost, services, time to perform, company name and address, and the cancellation notice. No services during the 3-business-day cancellation period.'],
      ['§ 1679e Cancellation', 'Consumer may cancel before midnight of the 3rd business day after signing. Provide the Notice of Cancellation form in duplicate.'],
      ['§ 1679g Liability', 'Actual damages (at least what the consumer paid), punitive damages and attorney fees. Contracts that violate CROA are void.'],
      ['Telemarketing Sales Rule', 'If services are sold by phone, no fee until a report issued more than 6 months after the results shows them.'],
      ['State laws', 'Many states require registration and a surety bond; some cap fees or ban advance fees entirely. Check your state attorney general or banking department before enrolling clients.']
    ] },
    { tab: 'laws', title: 'Debt collection, privacy and marketing', items: [
      ['FDCPA § 809 / Reg F validation', 'Collectors must send a validation notice. The consumer has 30 days after receiving it (Reg F adds 5 days for mailing) to dispute or request the original creditor. Collection pauses until the collector responds.'],
      ['FDCPA § 805 / § 806 Communications', 'No calls before 8 a.m. or after 9 p.m., no harassment, limits on contacting third parties and the workplace. Reg F limits call frequency (7 attempts in 7 days).'],
      ['FDCPA § 807 False representations', 'Collectors cannot misstate the amount, threaten action they cannot take, or report information they know is false.'],
      ['Reg F § 1006.30(a) Passive reporting', 'A collector may not report a debt to a bureau before contacting the consumer about it.'],
      ['Statute of limitations', 'State law sets how long a collector can sue (often 3–6 years). Separate from the 7-year reporting period. A payment can restart the lawsuit clock in some states — never advise clients to pay old debts without checking.'],
      ['GLBA Safeguards', 'Protect client SSNs, reports and IDs: limit access, encrypt, train staff, and delete what you no longer need.'],
      ['TCPA', 'Get written consent before marketing texts or autodialed calls. Honor STOP requests immediately.'],
      ['FTC Endorsement Guides', 'Disclose referral fees and affiliate relationships clearly when recommending products.']
    ] },

    // ---------- Timelines ----------
    { tab: 'timelines', title: 'How long items stay on a credit report', intro: 'Measured from the Date of First Delinquency unless noted. Bureau policies can shorten these.', items: [
      ['Late payments', '7 years from the late payment.'],
      ['Collections', '7 years from the original DOFD + 180 days — selling the debt does not restart the clock.'],
      ['Charge-offs', '7 years from the DOFD + 180 days.'],
      ['Repossession / foreclosure', '7 years from the DOFD.'],
      ['Chapter 7 bankruptcy', '10 years from filing.'],
      ['Chapter 13 bankruptcy', 'Up to 10 years by law; the bureaus remove it 7 years after filing.'],
      ['Accounts included in bankruptcy', '7 years from their own DOFD, reporting a 0 balance.'],
      ['Hard inquiries', '2 years; usually only the last 12 months affect FICO scores.'],
      ['Civil judgments and tax liens', 'No longer included on bureau reports since 2017–2018.'],
      ['Medical collections', 'Not reported if paid, under $500, or less than one year old (bureau policy).'],
      ['Closed accounts in good standing', 'Usually up to 10 years after closing — they help the score.'],
      ['Positive open accounts', 'Remain as long as the account is open.']
    ] },

    // ---------- Scores ----------
    { tab: 'scores', title: 'Credit scores — what moves them', items: [
      ['FICO factor weights', 'Payment history 35%, amounts owed 30%, length of history 15%, new credit 10%, credit mix 10%.'],
      ['FICO ranges', '300–850. Roughly: 800+ exceptional, 740–799 very good, 670–739 good, 580–669 fair, below 580 poor.'],
      ['Mortgage scores', 'Many mortgage lenders still use older FICO versions (FICO 2, 4, 5) — scores can differ from the free scores clients see.'],
      ['VantageScore', '300–850. Weighs payment history and utilization heavily; can score thinner files.'],
      ['Utilization', 'Balances ÷ limits, overall and per card. Under 30% helps; under 10% is best. It is recalculated monthly, so paying down before the statement date helps quickly.'],
      ['Payment history', 'One 30-day late can drop a good score significantly. Recent lates hurt more than old ones.'],
      ['Thin files', 'Fewer than 3–5 accounts. Credit-builder loans, secured cards, authorized-user accounts and rent/utility reporting help.'],
      ['Rate shopping', 'Multiple mortgage, auto or student-loan inquiries within a short window count as one for FICO.'],
      ['Closing old cards', 'Can raise utilization and eventually shorten history. Keep no-fee old cards open.'],
      ['Collections and scores', 'Newer FICO and VantageScore models ignore paid collections; older mortgage models do not.']
    ] },

    // ---------- Business credit ----------
    { tab: 'business', title: 'Building business credit — step by step', items: [
      ['1. Set up the entity correctly', 'LLC or corporation in good standing, EIN from the IRS, business bank account, consistent legal name and address everywhere.'],
      ['2. Look established', 'Business phone listed in directories, website with domain email, licenses in place, accurate NAICS code.'],
      ['3. Open the bureau files', 'Get a free D-U-N-S Number from Dun & Bradstreet. Experian and Equifax business files usually start when a creditor reports.'],
      ['4. Starter vendor accounts', 'Net-30 accounts with vendors that report payments (verify which bureau). Pay early — PAYDEX rewards paying before the due date.'],
      ['5. Business credit cards', 'Many require a personal guarantee at first. Choose cards that report to business bureaus and keep utilization low.'],
      ['6. Monitor', 'Check D&B, Experian and Equifax business files (e.g. through Nav). Business files are not covered by the FCRA — corrections go through each bureau’s process.'],
      ['7. Larger financing', 'Lenders look at time in business, revenue, bank balances, business scores and the owner’s personal credit. SBA loans use FICO SBSS for small loans.'],
      ['Personal guarantees', 'A personal guarantee can put business debt on the owner’s personal report if it defaults.'],
      ['Business scores', 'D&B PAYDEX 1–100 (80+ = on time), Experian Intelliscore Plus 1–100, Equifax Payment Index 0–100, FICO SBSS 0–300.']
    ] },

    // ---------- Contacts ----------
    { tab: 'contacts', title: 'Major credit bureaus', intro: 'Mailing addresses change. Check each bureau’s dispute page before mailing.', items: [
      ['Equifax disputes', 'Equifax Information Services LLC, P.O. Box 740256, Atlanta, GA 30374-0256 · equifax.com/personal/credit-report-services'],
      ['Experian disputes', 'Experian, P.O. Box 4500, Allen, TX 75013 · experian.com/disputes'],
      ['TransUnion disputes', 'TransUnion LLC Consumer Dispute Center, P.O. Box 2000, Chester, PA 19016 · transunion.com/credit-disputes'],
      ['Free reports', 'AnnualCreditReport.com — free weekly reports from all three bureaus.'],
      ['Security freezes', 'Free at each bureau online or by phone. Freeze all three; lift temporarily before applying for credit.']
    ] },
    { tab: 'contacts', title: 'Specialty consumer reporting agencies', intro: 'These also must follow the FCRA and offer free file disclosures.', items: [
      ['Innovis', 'Fourth credit bureau used by some lenders. innovis.com — request a report, freeze, or dispute online.'],
      ['LexisNexis Risk Solutions', 'Insurance, rental and identity data. consumer.risk.lexisnexis.com'],
      ['ChexSystems', 'Bank account history (closed accounts, overdrafts). chexsystems.com'],
      ['Early Warning Services', 'Bank and checking risk data. earlywarning.com/consumer-information'],
      ['NCTUE', 'Telecom and utility payment data. nctue.com'],
      ['Clarity Services / Experian', 'Alternative and short-term lending data. clarityservices.com'],
      ['Tenant screening companies', 'Rental history reports (e.g. RealPage, TransUnion SmartMove). Consumers can request and dispute these too.']
    ] },
    { tab: 'contacts', title: 'Government and consumer help', items: [
      ['CFPB complaints', 'consumerfinance.gov/complaint — companies generally respond within 15 days.'],
      ['FTC identity theft', 'IdentityTheft.gov — creates the identity-theft report needed for § 605B blocks.'],
      ['Prescreened offer opt-out', 'OptOutPrescreen.com or 1-888-5-OPT-OUT — stops prescreened credit offers for 5 years or permanently.'],
      ['State attorney general', 'Consumer protection complaints and credit repair registration rules.'],
      ['Consumer attorneys', 'NACA (consumeradvocates.org) lists attorneys who handle FCRA and FDCPA cases, often at no cost to the consumer.']
    ] },

    // ---------- Glossary ----------
    { tab: 'glossary', title: 'Glossary', items: [
      ['Authorized user', 'Someone allowed to use another person’s card but not liable for it (ECOA 3).'],
      ['Charge-off', 'The creditor wrote the debt off as a loss (status 97). The debt is still owed and may be sold.'],
      ['Collection account', 'A debt placed with or sold to a collection agency (status 93).'],
      ['CRA', 'Consumer reporting agency — a credit bureau or specialty agency.'],
      ['CRRG', 'Credit Reporting Resource Guide — the CDIA manual that defines Metro 2.'],
      ['DOFD', 'Date of First Delinquency — starts the 7-year reporting clock.'],
      ['e-OSCAR', 'The online system bureaus use to send disputes to furnishers as short codes (ACDVs).'],
      ['ACDV', 'Automated Consumer Dispute Verification — the dispute record sent from a bureau to a furnisher.'],
      ['Furnisher', 'Any company that reports account data to a bureau (lender, servicer, collector).'],
      ['Goodwill letter', 'A request to remove an accurate late payment as a courtesy. Not a dispute.'],
      ['Hard inquiry', 'A credit check for an application. Soft inquiries (account reviews, your own checks) do not affect scores.'],
      ['Metro 2', 'The standard data format furnishers use to report to the bureaus.'],
      ['Method of verification (MOV)', 'The description of how a bureau verified a disputed item (§ 611(a)(7)).'],
      ['Mixed file', 'A credit file that contains another person’s information.'],
      ['Pay for delete', 'Asking a collector to stop reporting in exchange for payment. Not guaranteed and many furnishers refuse.'],
      ['Reinsertion', 'A deleted item that reappears. The bureau must certify it and notify the consumer within 5 business days.'],
      ['Re-aging', 'Reporting a later DOFD to keep an item on the report longer. Illegal.'],
      ['Settled for less', 'Paid less than the full balance (special comment AU). Better than unpaid, still negative.'],
      ['Thin file', 'A report with few accounts — hard to score.'],
      ['Tradeline', 'One account on a credit report.'],
      ['Utilization', 'Revolving balances divided by limits.'],
      ['Validation', 'The collector’s proof of the debt and amount under FDCPA § 809.']
    ] },

    // ---------- Scripts ----------
    { tab: 'scripts', title: 'Free consultation outline', items: [
      ['1. Goals', '“What are you trying to do in the next 6–12 months — buy a home, a car, get a business loan?”'],
      ['2. Pull the report together', 'Review a current 3-bureau report with the client. Ask about each negative item: “Is this yours? Is anything about it wrong?”'],
      ['3. Explain the rules honestly', '“We can challenge information that is inaccurate, incomplete or can’t be verified. Accurate information can’t legally be removed — for those we’ll work on rebuilding.”'],
      ['4. Rights disclosure', 'Before any agreement, give the “Consumer Credit File Rights” statement and let them read it. Explain they can dispute on their own for free.'],
      ['5. Fees and timing', 'Explain exactly what you charge, that nothing is charged until the work is done, and that bureaus take 30–45 days per round.'],
      ['6. Cancellation', '“You can cancel within 3 business days for any reason, and we won’t start work until that period ends.”'],
      ['7. Next steps', 'Client signs in the portal, uploads ID and proof of address, and confirms each item to dispute.']
    ] },
    { tab: 'scripts', title: 'Answering common questions (compliant)', items: [
      ['“Can you guarantee results?”', '“No one can honestly guarantee results. We guarantee the work — accurate, documented disputes and follow-through on every response.”'],
      ['“How many points will my score go up?”', '“It depends on what is actually inaccurate and on your utilization and new accounts. We’ll show you exactly what changes after each round.”'],
      ['“Can you remove everything negative?”', '“Only information that is wrong or can’t be verified. For accurate items we’ll use goodwill requests, negotiation and rebuilding.”'],
      ['“What about a CPN or new credit identity?”', '“That is illegal. Using a CPN in place of your SSN on credit applications is fraud — we will never do it.”'],
      ['“Should I pay this old collection?”', '“Let’s check the reporting date and your state’s statute of limitations first — paying can sometimes restart the clock for a lawsuit.”'],
      ['“How long does this take?”', '“Each round takes about 30–45 days. Most clients go through 2–4 rounds while building positive credit at the same time.”']
    ] },
    { tab: 'scripts', title: 'Client FAQ', items: [
      ['Why do you need my ID and a utility bill?', 'The bureaus use them to confirm the dispute is really from you.'],
      ['What if a letter comes to my house?', 'Upload it in your portal or send us a photo. Bureau results are how we decide the next step.'],
      ['Will disputing hurt my score?', 'No. Disputing does not lower scores. Some lenders may ask that disputes be closed before a mortgage closes.'],
      ['Should I close my old credit cards?', 'Usually no — they help your history and utilization.'],
      ['Can I keep applying for credit?', 'Avoid new applications during repair unless needed; each hard inquiry can lower your score slightly.']
    ] }
  ];

  const TABS = [
    ['overview', 'Overview'], ['fields', 'Metro 2 field guide'], ['metro2', 'Metro 2 codes'], ['errors', 'Errors & evidence'],
    ['letters', 'Letters & deadlines'], ['laws', 'Laws'], ['timelines', 'Reporting timelines'], ['scores', 'Credit scores'],
    ['business', 'Business credit'], ['contacts', 'Bureaus & contacts'], ['glossary', 'Glossary'], ['scripts', 'Scripts & FAQ'], ['sources', 'Sources']
  ];

  function search(q) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) return [];
    const hits = [];
    SECTIONS.forEach(s => s.items.forEach(([t, b]) => { if ((t + ' ' + b).toLowerCase().includes(q)) hits.push({ tab: s.tab, section: s.title, term: t, text: b }); }));
    return hits;
  }

  const api = { SECTIONS, TABS, search };
  root.Library = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
