# How Metro 2 credit dispute software works — research notes

These notes are what the Ledger rebuild is based on. They cover the data format, the laws that set the workflow, and the features of the established products (Credit Repair Cloud, DisputeFox, Client Dispute Manager, Credit Money Machine, UltraDispute). This is not legal advice. Have counsel review your program, contracts and state registrations before you take on clients.

## 1. What "Metro 2" actually is

- **Metro 2®** is the standard file format that *furnishers* (banks, lenders, servicers, collectors) use to send account data to Equifax, Experian, TransUnion and Innovis every month. It is published by the Consumer Data Industry Association (CDIA) in the **Credit Reporting Resource Guide (CRRG)**.
- Each tradeline is a fixed-length **Base Segment of 426 characters**, plus optional segments (J1/J2 associated consumers, K1 original creditor, K2 purchased/sold, K4 specialized payment, L1 account number change, N1 employment).
- The Base Segment fields that matter most for accuracy, and that Ledger stores per tradeline:

| Field | What it holds |
|---|---|
| Portfolio Type | C line of credit, I installment, M mortgage, O open, R revolving |
| Date Opened | Account open date |
| Credit Limit / Highest Credit | Revolving limit; original amount for installment loans |
| Account Status (17A) | 11 current, 13 paid/closed zero balance, 61–65 paid after derogatory event, 71–84 30 to 180+ days late, 93 collections, 94–96 foreclosure/surrender/repossession, 97 charge-off, 05 transferred, DA/DF delete |
| Payment Rating (17B) | 0–6, G, L. Tracks the current-month status for closed or paid accounts |
| Payment History Profile (18) | 24 characters, newest month first: 0–6, B, D, E, G, H, J, K, L |
| Special Comment (19) | e.g. AU settled for less, M closed by grantor, AC partial payment agreement |
| Compliance Condition Code (20) | XA closed by consumer, **XB disputed (FCRA)**, XC dispute resolved and consumer disagrees, XF/XG FCBA, XH dispute resolved, XR remove code |
| Current Balance / Amount Past Due | Past due must be 0 when status is 11, and can never exceed the balance |
| Original Charge-off Amount | Required for status 97/64 |
| Date of Account Information | As-of date |
| **Date of First Delinquency (25)** | Starts the FCRA § 605 7-year clock. Required for every delinquent, collection or charge-off account |
| Date Closed / Date of Last Payment | Must be consistent with the open date and the reporting date |
| ECOA Code (37) | 1 individual, 2 joint, 3 authorized user, 5 co-maker, 7 maker, T terminated, X deceased, Z delete |
| Consumer Information Indicator (38) | A–D bankruptcy petition, E–H discharged, I–L dismissed, Q remove |

### What the audit engine checks

Ledger checks tradelines for errors that can be shown from the data itself. It does not flag an item just because it is negative.

| Rule | Why it is an error |
|---|---|
| Status 11 with amount past due > 0 | CRRG: a current account reports zero past due |
| Status 13 / 61–65 with balance > 0 | Paid statuses require a zero balance |
| Past due > balance | The past-due amount is a portion of the balance |
| Derogatory status with no DOFD | Furnishers must report the delinquency date (FCRA § 623(a)(5)); without it the reporting period can't be applied |
| DOFD before date opened; closed before opened; last payment after reporting date | The dates can't all be true |
| Status 05 (transferred) with a balance | The debt is owned elsewhere, so it gets counted twice |
| Collector and original creditor both report a balance | Duplicate debt. Only the current owner should report a balance |
| Bankruptcy discharged (CII E–H) with a balance | Discharged debts report $0 |
| Latest payment-history month disagrees with status | Grid and status contradict each other |
| DOFD + 180 days + 7 years has passed | Obsolete under FCRA § 605(a), (c) |
| Consumer disputed but no XB-family code | FCRA § 623(a)(3) requires the account to be reported as disputed |
| Same account differs across bureaus | FCRA § 607(b), maximum possible accuracy. At least one bureau is wrong |

**What "Metro 2 compliance" does not mean.** Some products sell "Metro 2 letters" that claim any formatting technicality forces a bureau to delete an accurate debt. The law requires bureaus and furnishers to correct or delete information that is *inaccurate, incomplete, or unverifiable*. Disputes of accurate data can be dismissed as frivolous (FCRA § 611(a)(3)). The CFPB has brought enforcement actions against firms that sent mass or repeat disputes of accurate information, and a jury awarded damages against a large credit repair firm over frivolous dispute letters (*CBE Group v. Lexington Law*). Ledger uses Metro 2 knowledge to find and explain real errors.

## 2. The laws that set the workflow

### Credit Repair Organizations Act (15 U.S.C. § 1679 et seq.)
- **§ 1679b(a): prohibited practices.** You may not advise a consumer to make untrue or misleading statements to a bureau or creditor. You may not advise a consumer to change their identity (CPNs, an EIN used in place of an SSN). You may not make untrue or misleading claims about your services.
- **§ 1679b(b): no advance fees.** You may not charge or receive money for a service before it is fully performed.
- **§ 1679c: required disclosure.** Give the consumer the verbatim statement *"Consumer Credit File Rights Under State and Federal Law"* before any contract is signed. It must be a separate document. Keep the signed acknowledgment for **2 years**.
- **§ 1679d: contract contents.** The contract must state the total payment, a full description of the services, the time needed to perform them, and the company's name and address. **No services may be performed until the 3-business-day cancellation period ends.**
- **§ 1679e: right to cancel.** The consumer may cancel until midnight of the 3rd business day after signing. The contract must come with a "Notice of Cancellation" form, in duplicate, using the statutory wording.
- **§ 1679a: business day** means any calendar day except Sunday or a legal public holiday. Saturdays count.
- If services are sold by telephone, the **FTC Telemarketing Sales Rule** bans advance fees until the consumer receives a report, at least 6 months after results are achieved, showing those results.
- **State law.** Many states require registration and a surety bond. Some cap or bar fees entirely.

### Fair Credit Reporting Act
- **§ 611 (1681i): bureau reinvestigation.** The bureau has **30 days** from receipt. That extends to **45 days** if the consumer adds information during the period, or disputes after a free annual report. The bureau must notify the furnisher within 5 business days, delete information that can't be verified, and send results within 5 business days of completing the reinvestigation. A frivolous determination must be noticed within 5 business days. Reinserted information requires notice within 5 business days (§ 611(a)(5)(B)). On request, the bureau must give a description of the procedure it used within 15 days (§ 611(a)(7)).
- **§ 623 (1681s-2) and Reg V § 1022.43: furnisher duties and direct disputes.** Furnishers must report accurately, correct errors, report the account as disputed, and report the DOFD. A direct dispute must identify the account, the specific information disputed, and the basis, with supporting documents.
- **§ 605 (1681c): obsolescence.** Most adverse items can be reported for 7 years, measured from 180 days after the DOFD. Bankruptcies can be reported for 10 years.
- Identity theft disputes are out of scope; refer clients to IdentityTheft.gov.
- **§ 609 (1681g): file disclosure.** The consumer doesn't need special wording such as "complete file".

### FDCPA § 809 / Regulation F
- The consumer can request validation within the validation period stated in the collector's notice. Collection must pause until the collector mails the validation.

## 3. Features of established credit repair platforms → Ledger

| Industry feature | Ledger implementation |
|---|---|
| Client CRM, lead → onboarding → active pipeline | Clients with statuses, search, CSV lead import, notes, referral source |
| Online agreement / e-sign | Agreement record with dates; printable § 1679c disclosure, contract, and duplicate cancellation notice |
| Report import from monitoring services (IdentityIQ, SmartCredit, MyScoreIQ) | Per-bureau reports with scores; manual entry or CSV tradeline import using a template |
| 3-bureau side-by-side view | Cross-bureau comparison that highlights differing fields |
| Negative-item tagging and "client's choice" | Metro 2 audit findings. The client confirms each item before any letter is drafted |
| Letter library / mail merge | 9 letter types (§ 611, § 623, § 611(a)(7) MOV, § 809 validation, § 605 obsolete, § 609 disclosure, reinsertion, goodwill) generated from findings, editable |
| Rounds and status tracking | Dispute pipeline: draft → approved → mailed → overdue/resolved. Rounds numbered per recipient |
| Deadline reminders | Received date → 30-day / 4-business-day / 15-day deadlines; auto-created follow-up task; overdue alerts |
| Certified mail tracking | Tracking number and received date per dispute |
| Client portal / progress reports | Printable progress report with score history and dispute outcomes |
| Billing / merchant integration | Invoices tied to completed services; CROA advance-fee blocks; CSV export |
| Affiliates / referral partners | Partner list with referred and active client counts |
| Team activity log | Workspace and client activity history |
| Compliance tooling | Compliance center: CROA gating, disclosure order checks, retention dates, repeat/frivolous dispute guard, deceptive-claim checker |

## 4. Partner referral programs (researched October 2026)

Affiliate terms change often and third-party listings disagree. Treat these as starting points and confirm them in each program's dashboard.

| Program | Who it's for | Referral bonus | How confirmed |
|---|---|---|---|
| CreditStrong | Personal credit builder | **$25 per successful referral** (Referral Rock) | Official refer-a-friend page. Its page description still says $10 |
| CreditStrong Business | Business credit builder | Same referral program; business payout not published | Company pages list Equifax Business, PayNet and SBFE reporting. D&B reporting not confirmed |
| Nav | Business credit monitoring | $5–$50 per sale reported by networks; ~$40 for Nav Prime; 45-day cookie | Program confirmed on Nav's official partner page (impact.com). Rate not published |
| Credit Sesame | Free score and monitoring | $3–$6 per approved sign-up reported | **Still operating, but affiliate program status in 2026 is unconfirmed**; listings conflict and one campaign shows as paused. Disabled for clients by default |
| Self | Credit builder | $10–$12 per account reported | Network listings |
| Kikoff | Credit builder | $5–$33 reported | Program confirmed on Kikoff's affiliate page (impact.com) |
| IdentityIQ / MyScoreIQ (IDIQ) | 3-bureau monitoring (report pulls) | ~$35–$40 per enrollment typical | Program confirmed on IDIQ's partner page |
| MyFreeScoreNow (MFSN) | 3-bureau monitoring (report pulls) | $6 per trial to $50–$60 per sale reported; 1-day cookie | Listings conflict; some network listings closed |
| SmartCredit | 3-bureau monitoring | $10–$24 reported | Listings conflict; one network shows closed |
| Experian Boost, D-U-N-S Number | Free tools | None | Recommend on merit |

**Rules for referral income:**
- Disclose referral fees to clients (FTC Endorsement Guides).
- Never require a client to buy a partner product.
- Referral fees from a partner aren't fees charged to the consumer, but don't let them influence advice.
- Paying or receiving referral fees connected to mortgages can trigger RESPA. Check with counsel.

## Sources

- [15 U.S.C. § 1679c — CROA disclosures (Cornell LII)](https://www.law.cornell.edu/uscode/text/15/1679c)
- [15 U.S.C. § 1679e — Right to cancel (Cornell LII)](https://www.law.cornell.edu/uscode/text/15/1679e)
- [15 U.S.C. ch. 41, subch. II-A — Credit Repair Organizations (Justia)](https://law.justia.com/codes/us/title-15/chapter-41/subchapter-ii-a)
- [15 U.S.C. § 1679b (GovInfo)](https://www.govinfo.gov/link/uscode/15/1679b) · [§ 1679c](https://www.govinfo.gov/link/uscode/15/1679c) · [§ 1679d](https://www.govinfo.gov/link/uscode/15/1679d)
- [Metro 2 Base Segment layout and compliance condition codes — Galileo / SoFi furnisher docs](https://docs.tech.sofi.com/pro/page/metro-2-base-segment)
- [Metro 2 glossary — DOFD, account status, CRRG (Switch Labs)](https://metro2.switchlabs.dev/metro2/glossary) · [Onboarding guide](https://www.switchlabs.dev/metro2/onboarding-guide)
- [STORIS Metro 2 settings reference](https://support.storis.com/helpRevisions/StorisWebHelp98/Settings/Actions_and_Field_Details/Metro_2_Code_Settings.htm)
- [The CFPB shuts down another credit repair service — Ballard Spahr Consumer Finance Monitor](https://www.consumerfinancemonitor.com/2017/09/06/the-cfpb-shuts-down-another-credit-repair-service/)
- [Credit Repair Organizations: what's happened and has it changed — RMAI](https://rmaintl.org/wp-content/uploads/2020/01/2.-Credit-Repair-Organizations-What%E2%80%99s-Happened-and-Has-it-Changed.pdf)
- [Credit Repair Cloud help center — Client's Choice](https://intercom.help/crc-support/en/articles/9190950)
- [Credit repair software hands-on review (Dupple)](https://dupple.com/reviews/credit) · [Credit Money Machine (GetApp)](https://www.getapp.com/all-software/a/credit-money-machine/) · [UltraDispute (G2)](https://www.g2.com/sellers/ultradispute)
- FCRA sections cited above: [§ 1681c](https://www.law.cornell.edu/uscode/text/15/1681c), [§ 1681g](https://www.law.cornell.edu/uscode/text/15/1681g), [§ 1681i](https://www.law.cornell.edu/uscode/text/15/1681i), [§ 1681s-2](https://www.law.cornell.edu/uscode/text/15/1681s-2), [12 C.F.R. § 1022.43](https://www.law.cornell.edu/cfr/text/12/1022.43)

Partner programs: [CreditStrong refer-a-friend](https://www.creditstrong.com/refer-a-friend/) · [CreditStrong business FAQ](https://www.creditstrong.com/business/business-faq) · [Nav partner program](https://www.nav.com/partner-program/) · [Nav (Lasso)](https://getlasso.co/affiliate/nav/) · [Credit Sesame (Commissiondex)](https://commissiondex.com/programs/credit-sesame/) · [Credit Sesame (UpPromote)](https://uppromote.com/affiliate-program-directory/credit-sesame/) · [Credit Sesame review (Creator Hero)](https://www.creator-hero.com/blog/credit-sesame-affiliate-program-in-depth-review-pros-and-cons) · [Kikoff affiliates](https://about.kikoff.com/affiliate) · [Self (FlexOffers)](https://www.flexoffers.com/affiliate-programs/self-inc-affiliate-program) · [IDIQ affiliate partners](https://www.idiq.com/partnerships/affiliate-partners) · [IdentityIQ (Awin)](https://ui.awin.com/merchant-profile/18765) · [MyFreeScoreNow (Lasso)](https://getlasso.co/affiliate/myfreescorenow-com/) · [MyFreeScoreNow (FlexOffers)](https://www.flexoffers.com/affiliate-programs/myfreescorenow-com-affiliate-program/) · [SmartCredit (FlexOffers)](https://www.flexoffers.com/affiliate-programs/smartcredit-affiliate-program/)

The official CRRG is licensed by CDIA. Buy the current edition before relying on exact code tables or field positions in production.
