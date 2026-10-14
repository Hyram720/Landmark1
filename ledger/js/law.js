/*
 * Statutory timelines, required disclosures, dispute types and letter templates.
 * Sources are listed in ledger/RESEARCH.md. This is workflow software, not legal advice.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const parse = s => (s instanceof Date ? new Date(s) : new Date(String(s).slice(0, 10) + 'T00:00:00'));

  function nthWeekday(year, month, weekday, n) {
    const d = new Date(year, month, 1);
    let count = 0;
    while (true) {
      if (d.getDay() === weekday && ++count === n) return d;
      d.setDate(d.getDate() + 1);
    }
  }
  function lastWeekday(year, month, weekday) {
    const d = new Date(year, month + 1, 0);
    while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
    return d;
  }
  const holidayCache = {};
  // Legal public holidays, 5 U.S.C. § 6103(a), with weekend observance shifts.
  function federalHolidays(year) {
    if (holidayCache[year]) return holidayCache[year];
    const fixed = [[0, 1], [5, 19], [6, 4], [10, 11], [11, 25]].map(([m, d]) => {
      const dt = new Date(year, m, d);
      if (dt.getDay() === 6) dt.setDate(dt.getDate() - 1);
      if (dt.getDay() === 0) dt.setDate(dt.getDate() + 1);
      return dt;
    });
    const floating = [
      nthWeekday(year, 0, 1, 3), nthWeekday(year, 1, 1, 3), lastWeekday(year, 4, 1),
      nthWeekday(year, 8, 1, 1), nthWeekday(year, 9, 1, 2), nthWeekday(year, 10, 4, 4)
    ];
    holidayCache[year] = new Set(fixed.concat(floating).map(iso));
    return holidayCache[year];
  }
  const isHoliday = d => federalHolidays(d.getFullYear()).has(iso(d));

  /** CROA business day: any calendar day except Sunday or a legal public holiday (15 U.S.C. § 1679a). */
  const isCroaBusinessDay = d => d.getDay() !== 0 && !isHoliday(d);
  /** General business day (Mon–Fri, excluding federal holidays) used for FCRA business-day periods. */
  const isBusinessDay = d => d.getDay() !== 0 && d.getDay() !== 6 && !isHoliday(d);

  function addBusinessDays(start, n, test) {
    const d = parse(start);
    let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); if ((test || isBusinessDay)(d)) added++; }
    return iso(d);
  }
  function addDays(start, n) { const d = parse(start); d.setDate(d.getDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / DAY); }

  /** Last day the consumer may cancel: midnight of the 3rd business day beginning after signing (§ 1679e(a)). */
  function croaCancelDeadline(signedAt) { return signedAt ? addBusinessDays(signedAt, 3, isCroaBusinessDay) : null; }

  const BUREAUS = {
    Equifax: { name: 'Equifax Information Services LLC', address: 'P.O. Box 740256\nAtlanta, GA 30374-0256' },
    Experian: { name: 'Experian', address: 'P.O. Box 4500\nAllen, TX 75013' },
    TransUnion: { name: 'TransUnion LLC Consumer Dispute Center', address: 'P.O. Box 2000\nChester, PA 19016' }
  };

  /**
   * Dispute types. `days` is the response window from the date the recipient receives the dispute.
   * `recipient` is 'bureau', 'furnisher' or 'collector'.
   */
  const DISPUTE_TYPES = {
    cra_611: { label: 'Bureau reinvestigation', cite: 'FCRA § 611 (15 U.S.C. § 1681i)', recipient: 'bureau', days: 30,
      note: '30 days from receipt; up to 45 if the consumer adds information during the period or disputes after a free annual report. Results within 5 business days of completion.' },
    furnisher_623: { label: 'Direct dispute to furnisher', cite: 'FCRA § 623(a)(8); 12 C.F.R. § 1022.43', recipient: 'furnisher', days: 30,
      note: 'Must identify the account, the specific information disputed, the basis, and include supporting documents.' },
    mov_611a7: { label: 'Method of verification request', cite: 'FCRA § 611(a)(6)(B)(iii), (a)(7)', recipient: 'bureau', days: 15,
      note: 'After a “verified” result. Bureau must describe the procedure used within 15 days of the request.' },
    validation_809: { label: 'Debt validation request', cite: 'FDCPA § 809(b) (15 U.S.C. § 1692g); Reg F § 1006.34', recipient: 'collector', days: 0,
      note: 'Send within the validation period stated in the collector’s notice. Collection must pause until validation is mailed.' },
    block_605b: { label: 'Identity-theft block', cite: 'FCRA § 605B (15 U.S.C. § 1681c-2)', recipient: 'bureau', days: 4, businessDays: true,
      note: 'Bureau must block within 4 business days of receiving proof of identity, an identity theft report, the items, and the consumer’s statement.' },
    obsolete_605: { label: 'Obsolete information', cite: 'FCRA § 605(a), (c)', recipient: 'bureau', days: 30,
      note: 'Items past 7 years from DOFD + 180 days (10 years for bankruptcies).' },
    disclosure_609: { label: 'File disclosure request', cite: 'FCRA § 609 (15 U.S.C. § 1681g)', recipient: 'bureau', days: 15,
      note: 'Requests all information in the consumer’s file and sources. No special wording is required.' },
    reinsertion_611: { label: 'Reinsertion without notice', cite: 'FCRA § 611(a)(5)(B)', recipient: 'bureau', days: 30,
      note: 'Bureau must certify accuracy with the furnisher and notify the consumer within 5 business days of reinserting deleted information.' },
    business_correction: { label: 'Business bureau correction request', cite: 'Bureau correction process (business files are not covered by the FCRA)', recipient: 'bureau', days: 0,
      note: 'Send to Dun & Bradstreet, Experian Business or Equifax Business with documents that prove the correct information.' },
    goodwill: { label: 'Goodwill adjustment request', cite: 'Courtesy request — not a dispute', recipient: 'furnisher', days: 0,
      note: 'Asks a creditor to reconsider accurate late payments. Never describe accurate information as inaccurate.' }
  };

  function responseDue(type, receivedAt) {
    const t = DISPUTE_TYPES[type];
    if (!t || !t.days || !receivedAt) return null;
    return t.businessDays ? addBusinessDays(receivedAt, t.days) : addDays(receivedAt, t.days);
  }

  const CROA_DISCLOSURE = `Consumer Credit File Rights Under State and Federal Law

You have a right to dispute inaccurate information in your credit report by contacting the credit bureau directly. However, neither you nor any “credit repair” company or credit repair organization has the right to have accurate, current, and verifiable information removed from your credit report. The credit bureau must remove accurate, negative information from your report only if it is over 7 years old. Bankruptcy information can be reported for 10 years.

You have a right to obtain a copy of your credit report from a credit bureau. You may be charged a reasonable fee. There is no fee, however, if you have been turned down for credit, employment, insurance, or a rental dwelling because of information in your credit report within the preceding 60 days. The credit bureau must provide someone to help you interpret the information in your credit file. You are entitled to receive a free copy of your credit report if you are unemployed and intend to apply for employment in the next 60 days, if you are a recipient of public welfare assistance, or if you have reason to believe that there is inaccurate information in your credit report due to fraud.

You have a right to sue a credit repair organization that violates the Credit Repair Organization Act. This law prohibits deceptive practices by credit repair organizations.

You have the right to cancel your contract with any credit repair organization for any reason within 3 business days from the date you signed it.

Credit bureaus are required to follow reasonable procedures to ensure that the information they report is accurate. However, mistakes may occur.

You may, on your own, notify a credit bureau in writing that you dispute the accuracy of information in your credit file. The credit bureau must then reinvestigate and modify or remove inaccurate or incomplete information. The credit bureau may not charge any fee for this service. Any pertinent information and copies of all documents you have concerning an error should be given to the credit bureau.

If the credit bureau’s reinvestigation does not resolve the dispute to your satisfaction, you may send a brief statement to the credit bureau, to be kept in your file, explaining why you think the record is inaccurate. The credit bureau must include a summary of your statement about disputed information with any report it issues about you.

The Federal Trade Commission regulates credit bureaus and credit repair organizations. For more information contact:

The Public Reference Branch
Federal Trade Commission
Washington, D.C. 20580`;

  function cancellationNotice(company, deadline) {
    return `NOTICE OF CANCELLATION

You may cancel this contract, without any penalty or obligation, at any time before midnight of the 3rd day which begins after the date the contract is signed by you.

To cancel this contract, mail or deliver a signed, dated copy of this cancellation notice, or any other written notice to ${company.name || '[name of credit repair organization]'} at ${(company.address || '[address of credit repair organization]').replace(/\n/g, ', ')} before midnight on ${deadline || '[date]'}.

I hereby cancel this transaction,

______________________ [date]

______________________ [purchaser’s signature]`;
  }

  function contractTerms(company, client, fee) {
    return `CREDIT SERVICES AGREEMENT

Between ${company.name || '[Company]'} (“we”) and ${client.name} (“you”).

1. Services. We will review your consumer reports with you, identify information you believe is inaccurate, incomplete or unverifiable, prepare written disputes for your review and signature, track statutory response deadlines, and report results to you.

2. Terms and conditions of payment. ${fee || '[Describe fee]'}. We will not charge or receive any payment for a service until that service is fully performed (15 U.S.C. § 1679b(b)). The total amount you may pay is stated above.

3. Estimated time to perform services. Disputes are typically prepared within 10 business days after the cancellation period ends. Bureaus generally have 30 days (up to 45) to respond to each dispute.

4. No guarantee. We cannot and do not promise any particular result, score increase or removal. Accurate, current and verifiable information cannot be removed from your report.

5. Your rights. You may cancel this contract within 3 business days of signing — see the attached Notice of Cancellation. You have also received the separate statement “Consumer Credit File Rights Under State and Federal Law.” No services will be performed until the cancellation period ends (15 U.S.C. § 1679d(a)(2)).

Company: ${company.name || ''} · ${(company.address || '').replace(/\n/g, ', ')}

Signed: ______________________   Date: __________`;
  }

  // Phrases that create CROA § 1679b(a) / FTC Act risk in letters or marketing.
  const RISK_PHRASES = [
    [/guarantee(d)?/i, 'Promising results is a deceptive claim (CROA § 1679b(a)(3)).'],
    [/remove (all|any|every) (negative|bad|accurate)/i, 'Accurate, current, verifiable information cannot be removed.'],
    [/(legally )?remove accurate/i, 'Accurate information cannot be removed through a dispute.'],
    [/\bCPN\b|credit privacy number|new credit (file|identity)/i, 'Creating a new credit identity is illegal (CROA § 1679b(a)(2)).'],
    [/(EIN|tax id) instead of (your )?(SSN|social)/i, 'Advising use of an EIN in place of an SSN is a misrepresentation.'],
    [/not mine|never (had|opened)/i, 'Only use if the consumer confirms the account is not theirs — otherwise this is a false statement.'],
    [/\bsue\b|lawsuit/i, 'Threats of legal action should reflect a real intention and legal review.'],
    [/e-?oscar/i, 'Letters engineered to avoid e-OSCAR do not change bureau duties and can delay results.'],
    [/(boost|raise|increase) (your )?score by \d+/i, 'Specific score promises are deceptive.']
  ];
  function lintText(text) {
    const out = [];
    RISK_PHRASES.forEach(([re, why]) => { const m = String(text || '').match(re); if (m) out.push({ phrase: m[0], why }); });
    return out;
  }

  const api = {
    iso, parse, addDays, addBusinessDays, daysBetween, federalHolidays, isBusinessDay, isCroaBusinessDay,
    croaCancelDeadline, BUREAUS, DISPUTE_TYPES, responseDue, CROA_DISCLOSURE, cancellationNotice, contractTerms, lintText, RISK_PHRASES
  };
  root.Law = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
