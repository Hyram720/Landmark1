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

    // ---------- Collections ----------
    { tab: 'collections', title: 'Collections — how they report', intro: 'A collection can come from the original creditor’s own collection department, a third-party agency, or a debt buyer that purchased the account. Each one reports differently.', items: [
      ['Who reports what', 'The collector or debt buyer reports its own tradeline (account type collection or debt buyer, status 93) and names the original creditor in the K1 segment. Once the original creditor sells or transfers the debt, its tradeline should show 0 balance and transferred/sold (status 05 or the K2 segment). Only the current owner may report a balance.'],
      ['Date of First Delinquency (DOFD)', 'A collector must report the original DOFD (FCRA § 623(a)(5)). The 7-year clock runs from 180 days after that delinquency (§ 605(c)) and does not restart when the debt is sold. A later DOFD on the collection than on the original account is re-aging.'],
      ['Date Opened on a collection', 'The date the collector opened its file, not when the debt began. It does not control the reporting period — the DOFD does.'],
      ['Paid collections and scores', 'FICO 9, FICO 10 and VantageScore 3.0/4.0 ignore paid collections. FICO 8 and the older FICO versions most mortgage lenders use still count them. Paying can help with newer models and with lenders who review the report manually.'],
      ['Medical collections', 'Equifax, Experian and TransUnion do not report paid medical collections, medical collections under $500, or medical debt less than one year past due (voluntary bureau policy since 2022–2023). The CFPB rule that would have removed all medical debt from reports was vacated by a federal court in Texas on July 11, 2025, so it is not in effect. Several states have their own medical-debt reporting limits — check the client’s state.'],
      ['Statute of limitations vs. reporting period', 'The statute of limitations (set by state law, often 3–6 years) controls whether the collector can sue. The 7-year FCRA period controls reporting. They are separate: a debt can be too old to sue on and still report, or vice versa. In some states a payment or written promise restarts the lawsuit clock — never tell a client to pay an old debt without checking.'],
      ['Settling or paying', 'Get any settlement or pay-for-delete agreement in writing before the client pays. Pay-for-delete is a request, not a right — collectors may refuse. A paid settlement should report a 0 balance, paid status, and usually special comment AU (paid for less than full balance).']
    ] },
    { tab: 'collections', title: 'Collections — laws that support the letters', items: [
      ['FDCPA § 809(a) / Reg F § 1006.34 — validation notice', 'Within 5 days of first contact, a debt collector must send validation information: the amount, an itemization since a set date, the creditor’s name, and the consumer’s rights. The validation period ends 30 days after the consumer receives it (Reg F assumes receipt 5 business days after mailing).'],
      ['FDCPA § 809(b) — collection must stop', 'If the consumer disputes in writing or asks for the original creditor’s name within the validation period, the collector must stop collecting until it mails verification or the original creditor’s name. Supports the debt validation letter.'],
      ['FDCPA § 807(8) — report the dispute', 'A collector may not communicate credit information it knows or should know is false, including failing to report that a disputed debt is disputed. If a collector keeps reporting without the XB dispute code after a dispute, cite this.'],
      ['FDCPA § 807(2) — false amount', 'A collector may not misrepresent the amount or legal status of a debt. Supports disputes over added interest, fees, or inflated balances.'],
      ['FDCPA § 808(1) — unauthorized amounts', 'Collecting any amount (interest, fees, charges) not authorized by the agreement or by law is unfair.'],
      ['FDCPA § 805(c) — stop contacting', 'If the consumer writes that they refuse to pay or want contact to stop, the collector must stop, except to confirm it is ending collection or to give notice of a specific action.'],
      ['Reg F § 1006.30(a) — no “parking” debts', 'A collector may not report a debt to a bureau before communicating with the consumer about it (a call or a letter, then waiting a reasonable time — 14 days — for a notice of undeliverability).'],
      ['Reg F § 1006.26(b) — time-barred debts', 'A collector may not sue or threaten to sue on a debt past the statute of limitations.'],
      ['FCRA § 623(a)(3) — disputed accounts', 'A furnisher that is told a consumer disputes an account must report it as disputed (compliance code XB).'],
      ['FCRA § 623(a)(5) — correct DOFD', 'Furnishers must report the month and year of the original delinquency within 90 days of reporting the account as placed for collection or charged off. Supports re-aging disputes.'],
      ['FCRA § 623(a)(8) / Reg V § 1022.43 — direct dispute', 'The consumer can dispute directly with the collector. The collector must investigate within 30 days and report the result.'],
      ['FCRA § 623(b) — after a bureau dispute', 'When the bureau forwards a dispute, the collector must review all relevant information provided and correct or delete inaccurate, incomplete or unverifiable information with every bureau it reports to.'],
      ['FCRA § 611(a)(5)(A) — unverifiable', 'If the information cannot be verified, the bureau must delete or modify it.'],
      ['FCRA § 615(f) and § 605B — identity theft', 'A collector told that a debt resulted from identity theft must notify the creditor and, on request, provide the consumer with the account documents. The bureau must block identity-theft debts within 4 business days of receiving the required documents.'],
      ['FDCPA § 813 — the consumer’s right to sue', 'A consumer can recover actual damages, up to $1,000 in statutory damages, and attorney’s fees. The deadline is 1 year from the violation. Refer clients with possible claims to a consumer attorney.']
    ] },
    { tab: 'collections', title: 'Collections — evidence, letter order and sample wording', intro: 'Use the sample wording only when it is true for this client. Paste it into the dispute’s discrepancy field and adapt it.', items: [
      ['Evidence checklist', 'Collector’s validation notice (and the envelope or date received), the client’s account statements, proof of payment or settlement letter, original creditor tradeline showing the DOFD, any sale/assignment notice, FTC identity-theft report if fraud, and the report pages showing every place the debt appears.'],
      ['Letter order', '1. Debt validation request (FDCPA § 809(b)) — within the validation period when possible; it can still be sent later. 2. Bureau dispute (§ 611) naming the specific error. 3. Direct dispute to the collector (§ 623). 4. Method of verification, then final notice to the furnisher and a CFPB complaint. 5. Consumer attorney review.'],
      ['Validation vs. verification', 'Validation is between the consumer and the collector (FDCPA). Verification is the bureau confirming data with the furnisher (FCRA). A bureau saying “verified” does not mean the collector has documents — ask with a method-of-verification letter.'],
      ['Sample: validation request', 'I am disputing this debt and requesting validation under 15 U.S.C. § 1692g(b). Please provide the name and address of the original creditor, an itemization of the amount you claim, and documents showing you own or are authorized to collect this debt. Please stop collection until you have provided this, and report the account as disputed.'],
      ['Sample: re-aged collection', 'Your account reports a date of first delinquency of [month/year]. The original account with [original creditor] first became delinquent in [month/year] and never became current again (see attached). Under 15 U.S.C. § 1681s-2(a)(5), the date of first delinquency must match the original delinquency. Please correct it.'],
      ['Sample: duplicate reporting', '[Original creditor] and [collector] both report a balance of $[amount] for the same debt. Only one entity can own this debt. Please correct the reporting so that only the current owner reports a balance, and the other account reports $0.'],
      ['Sample: paid collection still shows a balance', 'I paid this account in full [or settled it] on [date] (proof attached). It still reports a balance of $[amount]. Please update it to a $0 balance and a paid status.'],
      ['Sample: disputed but not marked disputed', 'I disputed this debt with you in writing on [date]. Your reporting does not show that it is disputed, as required by 15 U.S.C. § 1681s-2(a)(3) and § 1692e(8). Please report it as disputed.']
    ] },

    // ---------- Judgments ----------
    { tab: 'judgments', title: 'Judgments — how they report', intro: 'A judgment is a court decision that a person owes money. It is a public court record, not a credit account.', items: [
      ['Big-three credit reports', 'Since July 2017, under the National Consumer Assistance Plan, Equifax, Experian and TransUnion stopped including civil judgments that lacked full identifiers (name, address, and SSN or date of birth). In practice they no longer show civil judgments, and since April 2018 they no longer show tax liens. A judgment showing on a current big-three report is worth questioning.'],
      ['Where judgments still appear', 'Court records, LexisNexis Risk Solutions and other specialty reports, background checks and tenant screening reports. These companies are consumer reporting agencies, so the FCRA applies to them.'],
      ['The underlying debt', 'The collection or charge-off that led to the lawsuit can still report as its own tradeline. After a judgment is paid or settled, that tradeline should show a 0 balance.'],
      ['How long they can be reported', 'FCRA § 605(a)(2): civil judgments may be reported for 7 years from the date of entry, or until the statute of limitations has expired, whichever is longer. Exceptions in § 605(b): credit or insurance of $150,000 or more and jobs paying $75,000 or more.'],
      ['Common errors', 'Judgment belongs to someone else (matched by name only), satisfied judgment shown as unpaid, vacated or dismissed case shown as a judgment, wrong amount, the same case listed twice, or a judgment past its reporting period.'],
      ['Satisfaction of judgment', 'When a judgment is paid, the creditor should file a satisfaction (release) with the court. If it hasn’t, the client can ask the creditor or the court. Get a certified copy — it is the best evidence for disputes.'],
      ['Vacating a judgment', 'A court can set aside a judgment, for example a default judgment where the client was never properly served. Deadlines and rules vary by state and the outcome needs a court order. This is legal work: refer the client to a consumer attorney or legal aid. A credit repair company cannot give legal advice or represent the client in court.']
    ] },
    { tab: 'judgments', title: 'Judgments — laws that support the letters', items: [
      ['FCRA § 607(b) — maximum possible accuracy', 'Every consumer reporting agency must follow reasonable procedures to assure maximum possible accuracy. Matching public records by name only, or ignoring a satisfaction or vacatur, fails that standard.'],
      ['FCRA § 609 — file disclosure and sources', 'The client can request everything in their file, including the sources of the information. Use it first with LexisNexis or a background company to see exactly what is reported and where it came from.'],
      ['FCRA § 611 — reinvestigation', 'The agency must reinvestigate within 30 days and delete or correct information that is inaccurate, incomplete or cannot be verified.'],
      ['FCRA § 611(a)(7) — method of verification', 'After a “verified” result, the client can ask how it was verified. A public record verified only through a data vendor, without checking the court file, is weak.'],
      ['FCRA § 605(a)(2) — obsolete judgments', 'Judgments older than 7 years from entry (or the statute of limitations, if longer) cannot be reported, with the § 605(b) exceptions.'],
      ['FCRA § 613 — public records for employment', 'An agency reporting public records for employment must either notify the consumer when it reports them or use strict procedures to keep them complete and up to date.'],
      ['CROA § 1679b(a)(1) — no false statements', 'Never state that a judgment was paid, vacated or not the client’s if that is not true. Dispute only real errors, backed by court documents.']
    ] },
    { tab: 'judgments', title: 'Judgments — evidence, letter order and sample wording', intro: 'Use the sample wording only when it is true for this client.', items: [
      ['Evidence checklist', 'Court docket printout and case number, certified satisfaction of judgment, order vacating or dismissing, payment receipts or settlement agreement, and the client’s ID (to show different identifiers when it is someone else’s judgment).'],
      ['Letter order', '1. File disclosure request (§ 609) to the specialty agency. 2. Dispute (§ 611) with the agency, attaching court documents. 3. Method of verification. 4. CFPB complaint. 5. Consumer attorney review. If the underlying debt still reports a balance after payment, dispute that tradeline with the bureau and the collector too.'],
      ['Sample: judgment on a big-three report', 'Your report lists a civil judgment, [case number], from [court]. Please provide the source of this information and how you verified it. I dispute it as [not mine / satisfied / vacated — choose what is true]. Please delete or correct it.'],
      ['Sample: satisfied judgment', 'The judgment in [case number], [court], was satisfied on [date] (certified satisfaction attached). Your report shows it as unpaid. Please update it to show it was satisfied.'],
      ['Sample: vacated or dismissed', 'The judgment in [case number] was vacated [or the case was dismissed] by order of [court] on [date] (copy attached). Reporting it as an active judgment is inaccurate. Please delete it.'],
      ['Sample: not the client’s', 'The judgment in [case number] is not mine. The defendant’s identifiers do not match mine (my ID and proof of address are attached). Please delete it and tell me what identifiers you used to connect it to me.']
    ] },

    // ---------- Evictions ----------
    { tab: 'evictions', title: 'Evictions — how they report', intro: 'An eviction case is a court record. It hurts rental applications far more than credit scores.', items: [
      ['Big-three credit reports', 'Eviction filings and judgments do not appear on Equifax, Experian or TransUnion credit reports. What can appear is unpaid rent or damages sent to a collection agency, which reports as a collection.'],
      ['Tenant screening reports', 'Eviction records show up on tenant screening reports. Tenant screening companies are consumer reporting agencies, so the FCRA applies to them: they must be accurate, give a free file disclosure, and investigate disputes.'],
      ['Common errors', 'A case matched to the client by name only, a filing listed without its outcome (dismissed, tenant won, settled), a sealed or masked case still reported, one case listed several times, the amount the landlord asked for shown instead of the final judgment, and records older than 7 years.'],
      ['Sealed and masked records', 'Many states and cities seal eviction cases (some automatically when the tenant wins or the case is dismissed) or limit how long they can be reported. A sealed record should not be on a screening report. Check the client’s state and local rules.'],
      ['Enforcement example', 'In October 2023 the FTC and CFPB required TransUnion Rental Screening Solutions to pay $15 million over tenant screening reports that included sealed eviction records, duplicate entries for one case, wrong case outcomes and mislabeled amounts, and for not disclosing its data sources.'],
      ['Unpaid rent in collections', 'If the landlord sent a balance to a collector, the collection rules apply: validation, accurate DOFD and amount, and dispute rights. Damages are often disputed — compare the charges with the lease, move-out photos and the security deposit accounting.'],
      ['Facing an eviction now', 'Refer the client to legal aid or a tenant attorney right away. Many areas have right-to-counsel programs and rental assistance. Credit repair cannot stop an eviction case.']
    ] },
    { tab: 'evictions', title: 'Evictions — laws that support the letters', items: [
      ['FCRA § 607(b) — maximum possible accuracy', 'Screening companies must use reasonable procedures for accuracy. In a 2021 advisory opinion the CFPB said matching records by name only is not a reasonable procedure.'],
      ['FCRA § 609 — file disclosure and sources', 'The client can get a free copy of their tenant screening file, including where each record came from. Ask for it first.'],
      ['FCRA § 611 — reinvestigation', 'The screening company must reinvestigate within 30 days and delete or correct inaccurate, incomplete or unverifiable records, and tell the client the result.'],
      ['FCRA § 615(a) — adverse action notice', 'A landlord who denies an application, asks for a higher deposit, or requires a co-signer because of a screening report must tell the applicant, name the screening company, and explain the right to a free copy within 60 days and to dispute.'],
      ['FCRA § 605(a)(2) and (a)(5) — reporting period', 'Civil suits and judgments: 7 years from entry, or the statute of limitations if longer. Other adverse items: 7 years.'],
      ['State sealing and screening laws', 'Some states seal eviction cases or limit what screening companies can report. Reporting a sealed case is also inaccurate under the FCRA.'],
      ['FDCPA — rent collections', 'Third-party collectors of unpaid rent must follow § 809 validation and § 807 accuracy rules, the same as any collection.']
    ] },
    { tab: 'evictions', title: 'Evictions — evidence, letter order and sample wording', intro: 'Use the sample wording only when it is true for this client.', items: [
      ['Evidence checklist', 'Court docket with the outcome, dismissal or judgment for the tenant, sealing order, settlement agreement, lease, rent ledger and payment receipts, move-out inspection and photos, security deposit itemization, the landlord’s adverse action notice, and the client’s ID.'],
      ['Letter order', '1. File disclosure request (§ 609) to the screening company named in the adverse action notice. 2. Dispute (§ 611) with court documents. 3. If a collection is reporting: validation (§ 809) to the collector and a bureau dispute (§ 611). 4. Method of verification and a CFPB complaint. 5. Tenant or consumer attorney review.'],
      ['Sample: dismissed or tenant won', 'Your report lists eviction case [case number], [court]. That case was dismissed [or decided in my favor] on [date] (court record attached). Reporting it without that outcome is incomplete and misleading. Please delete it or report the correct outcome.'],
      ['Sample: sealed record', 'Eviction case [case number] was sealed by [court / state law] on [date] (attached). Sealed records should not appear on consumer reports. Please delete it.'],
      ['Sample: not the client’s', 'Eviction case [case number] is not mine. I never lived at [address] (proof of my addresses attached). Please delete it and tell me what identifiers you used to match it to me.'],
      ['Sample: duplicate or wrong amount', 'Your report lists the same eviction case [case number] [number] times [or shows $[amount], which is the amount the landlord asked for, not the final judgment of $[amount]]. Please correct it.']
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
      ['Civil judgments and tax liens', 'No longer included on Equifax, Experian or TransUnion reports since 2017–2018. Judgments can still appear on specialty and tenant screening reports for 7 years from entry (or the statute of limitations, if longer).'],
      ['Eviction records', 'Not on the big-three credit reports. On tenant screening reports, up to 7 years (unless sealed). Unpaid rent in collections follows the collection timeline.'],
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
    ['overview', 'Overview'], ['templates', 'Letter templates'], ['addresses', 'Creditor addresses'], ['fields', 'Metro 2 field guide'], ['metro2', 'Metro 2 codes'], ['errors', 'Errors & evidence'],
    ['collections', 'Collections'], ['judgments', 'Judgments'], ['evictions', 'Evictions'],
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
