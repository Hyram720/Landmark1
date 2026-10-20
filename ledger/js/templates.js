/*
 * Letter templates for specific situations (judgments, evictions, student loans, collections).
 * Each template turns a few answers into a disputed item with a specific discrepancy, the
 * requested correction and the evidence, then the normal letter builder adds the client's
 * name, address and identifiers. Every statement must be confirmed true by the client.
 */
(function (root) {
  'use strict';

  const LEXIS = { name: 'LexisNexis Risk Solutions Consumer Center', address: 'P.O. Box 105108\nAtlanta, GA 30348-5108' };
  const CATS = [
    ['judgments', 'Judgments', 'Civil judgments on bureau, LexisNexis or background reports.'],
    ['evictions', 'Evictions', 'Eviction records on tenant screening reports.'],
    ['student', 'Student loans', 'Federal and private student loan reporting errors.'],
    ['collections', 'Collections', 'Collection agencies and debt buyers.'],
    ['other', 'Inquiries, personal info & authorized users', 'Hard inquiries, wrong names or addresses, and authorized-user accounts.']
  ];

  // Recipient options: 'bureaus' (Equifax, Experian, TransUnion), 'lexis', 'other' (name + address typed in).
  const F = (k, label, opts) => Object.assign({ k, label }, opts || {});
  const caseFields = [F('plaintiff', 'Plaintiff (who sued)', { required: true, help: 'e.g. Example Funding LLC' }), F('caseNumber', 'Case number', { required: true }), F('court', 'Court', { required: true, help: 'e.g. Example County District Court' })];
  const evictionFields = [F('landlord', 'Landlord / plaintiff', { required: true }), F('caseNumber', 'Case number', { required: true }), F('court', 'Court', { required: true })];
  const loanFields = [F('creditor', 'Servicer / lender as reported', { required: true, help: 'e.g. the servicer name on the report' }), F('accountNumber', 'Account number (last 4 is enough)')];
  const collFields = [F('creditor', 'Collection agency as reported', { required: true }), F('accountNumber', 'Account number (last 4 is enough)'), F('originalCreditor', 'Original creditor')];
  const fmt = d => { if (!d) return ''; const x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };
  const mon = d => { if (!d) return ''; const x = new Date((d.length === 7 ? d + '-01' : d) + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
  const caseName = v => `Civil judgment — ${v.plaintiff}, case ${v.caseNumber}, ${v.court}`;
  const evName = v => `Eviction record — ${v.landlord}, case ${v.caseNumber}, ${v.court}`;
  const plus = (base, extra) => [base, extra].filter(Boolean).join('; ');

  const TEMPLATES = [
    // ---------- Judgments ----------
    { id: 'judgment_not_mine', cat: 'judgments', title: 'Judgment is not mine', when: 'The judgment belongs to someone else (often matched by name only).',
      to: ['bureaus', 'lexis', 'other'], otherLabel: 'Background / specialty reporting company', type: 'public_record_611',
      fields: [...caseFields, F('detail', 'Why it is not the client’s (optional)', { type: 'textarea', help: 'e.g. different middle name, never lived in that county' })],
      item: v => ({ creditor: caseName(v), discrepancy: `This judgment is not mine. I was never a party to case ${v.caseNumber} in ${v.court}, and the defendant’s identifiers do not match my name, date of birth, Social Security number or address history.${v.detail ? ' ' + v.detail.trim() : ''}`,
        requested: 'Delete this public record from my file and tell me which identifiers were used to connect it to me.', evidence: plus('Copy of my photo ID and proof of my addresses', v.detail ? 'court record showing the defendant’s details, if available' : '') }) },
    { id: 'judgment_satisfied', cat: 'judgments', title: 'Judgment paid / satisfied but shows unpaid', when: 'The judgment was paid or settled and a satisfaction was filed.',
      to: ['bureaus', 'lexis', 'other'], otherLabel: 'Background / specialty reporting company', type: 'public_record_611',
      fields: [...caseFields, F('satisfiedDate', 'Date satisfied', { type: 'date', required: true })],
      item: v => ({ creditor: caseName(v), discrepancy: `This judgment was satisfied on ${fmt(v.satisfiedDate)}, as shown by the enclosed satisfaction of judgment. It is reported as unpaid or open, which is inaccurate and incomplete.`,
        requested: 'Update this record to show it was satisfied on ' + fmt(v.satisfiedDate) + ' with a $0 balance, or delete it.', evidence: 'Certified copy of the satisfaction of judgment; proof of payment' }) },
    { id: 'judgment_vacated', cat: 'judgments', title: 'Judgment vacated or case dismissed', when: 'A court set the judgment aside or dismissed the case.',
      to: ['bureaus', 'lexis', 'other'], otherLabel: 'Background / specialty reporting company', type: 'public_record_611',
      fields: [...caseFields, F('outcome', 'What happened', { type: 'select', options: ['vacated', 'set aside', 'dismissed', 'reversed on appeal'], required: true }), F('outcomeDate', 'Date of the court order', { type: 'date', required: true })],
      item: v => ({ creditor: caseName(v), discrepancy: `This judgment was ${v.outcome} by order of ${v.court} on ${fmt(v.outcomeDate)} (copy enclosed). Reporting it as a judgment against me is inaccurate.`,
        requested: 'Delete this judgment from my file.', evidence: 'Copy of the court order dated ' + fmt(v.outcomeDate) }) },
    { id: 'judgment_obsolete', cat: 'judgments', title: 'Judgment too old to report', when: 'Entered more than 7 years ago. Confirm the state’s statute of limitations first — if it is longer and still running, do not use this letter.',
      to: ['bureaus', 'lexis', 'other'], otherLabel: 'Background / specialty reporting company', type: 'obsolete_605',
      fields: [...caseFields, F('entryDate', 'Date the judgment was entered', { type: 'date', required: true })],
      item: v => ({ creditor: caseName(v), discrepancy: `This judgment was entered on ${fmt(v.entryDate)}, more than seven years ago, and the governing statute of limitations has expired. Under FCRA § 605(a)(2) (15 U.S.C. § 1681c(a)(2)) it may no longer be reported.`,
        requested: 'Delete this obsolete judgment from my file.', evidence: 'Court docket showing the entry date' }) },

    // ---------- Evictions ----------
    { id: 'eviction_outcome', cat: 'evictions', title: 'Eviction dismissed or tenant won', when: 'The report shows the filing but not that the case was dismissed or decided for the tenant.',
      to: ['lexis', 'other'], otherLabel: 'Tenant screening company (from the landlord’s denial notice)', otherRequired: true, type: 'tenant_screening_611',
      fields: [...evictionFields, F('outcome', 'Outcome', { type: 'select', options: ['dismissed', 'decided in my favor', 'withdrawn by the landlord', 'settled and dismissed'], required: true }), F('outcomeDate', 'Date of the outcome', { type: 'date', required: true })],
      item: v => ({ creditor: evName(v), discrepancy: `This eviction case was ${v.outcome} on ${fmt(v.outcomeDate)} (court record enclosed). Reporting the filing without that outcome is incomplete and misleading, and no eviction judgment was entered against me.`,
        requested: 'Delete this record, or at minimum report the correct outcome.', evidence: 'Court docket or order showing the outcome dated ' + fmt(v.outcomeDate) }) },
    { id: 'eviction_sealed', cat: 'evictions', title: 'Eviction record was sealed', when: 'A court order or state law sealed or masked the case.',
      to: ['lexis', 'other'], otherLabel: 'Tenant screening company (from the landlord’s denial notice)', otherRequired: true, type: 'tenant_screening_611',
      fields: [...evictionFields, F('sealedDate', 'Date sealed', { type: 'date', required: true }), F('sealedBy', 'Sealed by', { type: 'select', options: ['court order', 'state law'], required: true })],
      item: v => ({ creditor: evName(v), discrepancy: `This eviction case was sealed by ${v.sealedBy} effective ${fmt(v.sealedDate)}. A sealed record is not public and should not appear in my consumer file; reporting it does not meet the accuracy requirement of FCRA § 607(b).`,
        requested: 'Delete this sealed record and do not report it again.', evidence: v.sealedBy === 'court order' ? 'Copy of the sealing order' : 'Court record showing the case is sealed' }) },
    { id: 'eviction_not_mine', cat: 'evictions', title: 'Eviction is not mine', when: 'The client was never a tenant in that case.',
      to: ['lexis', 'other'], otherLabel: 'Tenant screening company (from the landlord’s denial notice)', otherRequired: true, type: 'tenant_screening_611',
      fields: [...evictionFields, F('property', 'Property address in the case', { required: true })],
      item: v => ({ creditor: evName(v), discrepancy: `This eviction case is not mine. I never rented or lived at ${v.property} and was not a party to case ${v.caseNumber}. Matching a record to me by name alone is not a reasonable procedure under FCRA § 607(b).`,
        requested: 'Delete this record and tell me which identifiers were used to match it to me.', evidence: 'Photo ID and proof of my addresses during that period' }) },
    { id: 'eviction_duplicate', cat: 'evictions', title: 'Eviction listed twice or wrong amount', when: 'One case appears more than once, or the amount shown is not the final judgment.',
      to: ['lexis', 'other'], otherLabel: 'Tenant screening company (from the landlord’s denial notice)', otherRequired: true, type: 'tenant_screening_611',
      fields: [...evictionFields, F('problem', 'Problem', { type: 'select', options: ['listed more than once', 'wrong amount'], required: true }), F('reportedAmount', 'Amount reported ($)', { help: 'Wrong amount only' }), F('correctAmount', 'Correct final judgment amount ($)', { help: 'Wrong amount only — 0 if none' })],
      item: v => ({ creditor: evName(v), discrepancy: v.problem === 'wrong amount'
          ? `This record reports $${v.reportedAmount || '[amount]'}, which is not the final judgment amount. The final amount was $${v.correctAmount || '0'} (court record enclosed).`
          : `This single eviction case (${v.caseNumber}) is listed more than once in my file, which overstates my record.`,
        requested: v.problem === 'wrong amount' ? 'Correct the amount to the final judgment shown in the court record.' : 'Remove the duplicate entries so the case appears no more than once.', evidence: 'Court docket for case ' + v.caseNumber }) },
    { id: 'eviction_obsolete', cat: 'evictions', title: 'Eviction older than 7 years', when: 'The case was filed or entered more than 7 years ago.',
      to: ['lexis', 'other'], otherLabel: 'Tenant screening company (from the landlord’s denial notice)', otherRequired: true, type: 'obsolete_605',
      fields: [...evictionFields, F('entryDate', 'Date filed / entered', { type: 'date', required: true })],
      item: v => ({ creditor: evName(v), discrepancy: `This eviction record dates from ${fmt(v.entryDate)}, more than seven years ago, and may no longer be reported under FCRA § 605(a).`,
        requested: 'Delete this obsolete record.', evidence: 'Court docket showing the date' }) },

    // ---------- Student loans ----------
    { id: 'student_deferment', cat: 'student', title: 'Late during deferment, forbearance or $0 IDR payment', when: 'Months are reported late when no payment was due.',
      to: ['other', 'bureaus'], otherLabel: 'Loan servicer', type: 'student_loan_623', bureauType: 'cra_611',
      fields: [...loanFields, F('status', 'Status at the time', { type: 'select', options: ['deferment', 'forbearance', 'an income-driven repayment plan with a $0 payment', 'in-school or grace status'], required: true }), F('from', 'From (month)', { type: 'month', required: true }), F('through', 'Through (month)', { type: 'month', required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Payment History Profile', 'Account Status'], discrepancy: `My loan was in ${v.status} from ${mon(v.from)} through ${mon(v.through)}, so no payment was due. Those months are reported as late, which is inaccurate.`,
        requested: `Report ${mon(v.from)} through ${mon(v.through)} as current / no payment due and remove the late payment history for those months.`, evidence: 'Servicer approval letter for the ' + v.status.split(' ')[0] + ' period' }) },
    { id: 'student_onramp', cat: 'student', title: 'Federal loan reported late during the on-ramp (Oct 2023 – Sep 2024)', when: 'Federal student loans: missed payments in the 12-month on-ramp after the payment pause were not to be reported as delinquent.',
      to: ['other', 'bureaus'], otherLabel: 'Loan servicer', type: 'student_loan_623', bureauType: 'cra_611',
      fields: [...loanFields, F('months', 'Months reported late', { required: true, help: 'e.g. November 2023, December 2023' })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Payment History Profile', 'Account Status'], discrepancy: `This federal student loan is reported late for ${v.months}. Under the U.S. Department of Education’s on-ramp period (October 1, 2023 through September 30, 2024), missed payments during that time were not to be reported to the credit bureaus as delinquent.`,
        requested: 'Remove the late payment reporting for those months.', evidence: 'Copy of the report showing the months; servicer statements for the period' }) },
    { id: 'student_rehab', cat: 'student', title: 'Rehabilitated loan still shows default', when: 'The client completed loan rehabilitation, but the default is still reported.',
      to: ['other', 'bureaus'], otherLabel: 'Loan servicer / guaranty agency', type: 'student_loan_623', bureauType: 'cra_611',
      fields: [...loanFields, F('rehabDate', 'Rehabilitation completed', { type: 'date', required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Account Status', 'Special Comment'], discrepancy: `I successfully rehabilitated this loan on ${fmt(v.rehabDate)}. After rehabilitation the record of default must be removed from my credit history (20 U.S.C. § 1078-6(a)(1)(A); 34 C.F.R. § 685.211(f)). It is still reported as defaulted.`,
        requested: 'Remove the record of default. Late payments reported before the default may remain, but the default itself must be removed.', evidence: 'Rehabilitation completion letter dated ' + fmt(v.rehabDate) }) },
    { id: 'student_discharged', cat: 'student', title: 'Discharged loan still shows a balance', when: 'The loan was discharged or forgiven but still reports a balance or late status.',
      to: ['other', 'bureaus'], otherLabel: 'Loan servicer', type: 'student_loan_623', bureauType: 'cra_611',
      fields: [...loanFields, F('discharge', 'Discharge type', { type: 'select', options: ['Public Service Loan Forgiveness', 'total and permanent disability discharge', 'closed school discharge', 'borrower defense discharge', 'false certification discharge', 'bankruptcy discharge', 'income-driven repayment forgiveness'], required: true }), F('dischargeDate', 'Date discharged', { type: 'date', required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Current Balance', 'Account Status'], discrepancy: `This loan was discharged through ${v.discharge} on ${fmt(v.dischargeDate)} (letter enclosed). It still reports a balance and/or a delinquent status, which is inaccurate.`,
        requested: 'Report a $0 balance and a status showing the loan was discharged.', evidence: 'Discharge approval letter dated ' + fmt(v.dischargeDate) }) },
    { id: 'student_transferred', cat: 'student', title: 'Consolidated or transferred loan still shows a balance', when: 'The old servicer or old loans still report a balance after consolidation or transfer.',
      to: ['other', 'bureaus'], otherLabel: 'Former loan servicer', type: 'student_loan_623', bureauType: 'cra_611',
      fields: [...loanFields, F('event', 'What happened', { type: 'select', options: ['consolidated', 'transferred to a new servicer'], required: true }), F('eventDate', 'Date', { type: 'date', required: true }), F('newHolder', 'New servicer / consolidation loan', { required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Current Balance', 'Account Status'], discrepancy: `This loan was ${v.event} on ${fmt(v.eventDate)} and is now held by ${v.newHolder}, which reports the balance. This account still reports a balance, so the same debt is counted twice.`,
        requested: 'Report this account as paid/transferred with a $0 balance.', evidence: 'Consolidation or transfer notice dated ' + fmt(v.eventDate) }) },
    { id: 'student_paid_on_time', cat: 'student', title: 'Payment made on time but reported late', when: 'The payment was made on time (often during a servicer transfer) but shows late.',
      to: ['other', 'bureaus'], otherLabel: 'Loan servicer', type: 'student_loan_623', bureauType: 'cra_611',
      fields: [...loanFields, F('month', 'Month reported late', { type: 'month', required: true }), F('paidDate', 'Date the payment was made', { type: 'date', required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Payment History Profile'], discrepancy: `My payment for ${mon(v.month)} was made on ${fmt(v.paidDate)}, on time (bank record enclosed), but ${mon(v.month)} is reported as late.`,
        requested: `Report ${mon(v.month)} as paid on time.`, evidence: 'Bank statement or payment confirmation dated ' + fmt(v.paidDate) }) },

    // ---------- Collections ----------
    { id: 'coll_validation', cat: 'collections', title: 'Debt validation request', when: 'Send to the collector, ideally within 30 days of receiving its validation notice.',
      to: ['other'], otherLabel: 'Collection agency', otherRequired: true, type: 'validation_809',
      fields: [...collFields, F('noticeDate', 'Date the client received the collector’s notice', { type: 'date' })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, discrepancy: `I dispute this debt${v.originalCreditor ? ' (original creditor: ' + v.originalCreditor + ')' : ''}${v.noticeDate ? ', which you first notified me about in a notice I received on ' + fmt(v.noticeDate) : ''}, and request validation under 15 U.S.C. § 1692g(b).`,
        requested: 'Provide the original creditor’s name and address, an itemization of the amount, and proof that you own or may collect this debt; stop collection until you do; and report the account as disputed.', evidence: v.noticeDate ? 'Copy of your notice' : '' }) },
    { id: 'coll_reaged', cat: 'collections', title: 'Re-aged collection (wrong first delinquency date)', when: 'The collection shows a later DOFD than the original account.',
      to: ['bureaus', 'other'], otherLabel: 'Collection agency', type: 'cra_611', otherType: 'furnisher_623',
      fields: [...collFields, F('reportedDofd', 'DOFD reported by the collector', { type: 'month', required: true }), F('actualDofd', 'Original first delinquency', { type: 'month', required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['FCRA Compliance / Date of First Delinquency'], discrepancy: `This collection reports a date of first delinquency of ${mon(v.reportedDofd)}. The original account${v.originalCreditor ? ' with ' + v.originalCreditor : ''} first became delinquent in ${mon(v.actualDofd)} and never became current again. The date of first delinquency must match the original delinquency (15 U.S.C. § 1681s-2(a)(5)).`,
        requested: `Correct the date of first delinquency to ${mon(v.actualDofd)}, or delete the account if it is past the reporting period.`, evidence: 'Original creditor’s statement or report entry showing the first delinquency' }) },
    { id: 'coll_duplicate', cat: 'collections', title: 'Same debt reported twice', when: 'The original creditor and collector (or two collectors) both report a balance.',
      to: ['bureaus', 'other'], otherLabel: 'Collection agency', type: 'cra_611', otherType: 'furnisher_623',
      fields: [...collFields, F('amount', 'Balance reported twice ($)', { required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Current Balance'], discrepancy: `${v.originalCreditor || 'The original creditor'} and ${v.creditor} both report a balance of $${v.amount} for the same debt. Only the current owner may report a balance, so this debt is counted twice.`,
        requested: 'Correct the reporting so only the current owner reports a balance and the other account shows $0 / transferred.', evidence: 'Report pages showing both accounts' }) },
    { id: 'coll_paid', cat: 'collections', title: 'Paid or settled collection still shows a balance', when: 'The client paid or settled but the balance is still reported.',
      to: ['bureaus', 'other'], otherLabel: 'Collection agency', type: 'cra_611', otherType: 'furnisher_623',
      fields: [...collFields, F('how', 'Paid how', { type: 'select', options: ['paid in full', 'settled'], required: true }), F('paidDate', 'Date paid', { type: 'date', required: true }), F('balance', 'Balance still reported ($)', { required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Current Balance', 'Account Status'], discrepancy: `I ${v.how === 'settled' ? 'settled' : 'paid'} this account ${v.how === 'settled' ? 'in full under a settlement agreement' : 'in full'} on ${fmt(v.paidDate)} (proof enclosed). It still reports a balance of $${v.balance}.`,
        requested: 'Report a $0 balance and a paid status' + (v.how === 'settled' ? ' (settled).' : '.'), evidence: 'Proof of payment' + (v.how === 'settled' ? ' and the settlement letter' : '') }) },
    { id: 'coll_not_disputed', cat: 'collections', title: 'Disputed debt not marked as disputed', when: 'The client disputed with the collector, but the report does not show it as disputed.',
      to: ['other', 'bureaus'], otherLabel: 'Collection agency', type: 'furnisher_623', bureauType: 'cra_611',
      fields: [...collFields, F('disputeDate', 'Date the client disputed with the collector', { type: 'date', required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, fields: ['Compliance Condition Code'], discrepancy: `I disputed this debt with ${v.creditor} in writing on ${fmt(v.disputeDate)}. The account is not reported as disputed, as required by 15 U.S.C. § 1681s-2(a)(3) and § 1692e(8).`,
        requested: 'Report the account as disputed (compliance condition code XB).', evidence: 'Copy of my dispute letter and proof of mailing' }) },
    { id: 'coll_medical', cat: 'collections', title: 'Medical collection that should not report', when: 'Paid medical collection, under $500, or less than a year old (bureau policy).',
      to: ['bureaus'], type: 'cra_611',
      fields: [...collFields, F('reason', 'Why it should not report', { type: 'select', options: ['it has been paid', 'its original balance was under $500', 'it was less than one year past due when reported'], required: true }), F('detail', 'Date paid / amount / dates', { required: true })],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, discrepancy: `This is a medical collection, and ${v.reason} (${v.detail}). Under the credit bureaus’ medical debt reporting policy, it should not appear on my report.`,
        requested: 'Delete this medical collection.', evidence: v.reason === 'it has been paid' ? 'Proof of payment' : 'Bill or statement showing the amount and dates' }) },

    // ---------- Inquiries, personal information, authorized users ----------
    { id: 'inquiry_unauthorized', cat: 'other', title: 'Hard inquiry I did not authorize', when: 'The client did not apply for credit with this company. Identity theft disputes are out of scope; refer clients to IdentityTheft.gov.',
      to: ['bureaus'], type: 'inquiry_604',
      fields: [F('creditor', 'Company that made the inquiry', { required: true }), F('inquiryDate', 'Inquiry date', { type: 'date', required: true })],
      item: v => ({ creditor: v.creditor, discrepancy: `Hard inquiry by ${v.creditor} dated ${fmt(v.inquiryDate)}. I did not apply for credit with ${v.creditor} or authorize this inquiry.`,
        requested: 'Verify the permissible purpose for this inquiry, or delete it.', evidence: '' }) },
    { id: 'pii_wrong', cat: 'other', title: 'Wrong name, address or other personal info', when: 'Old or wrong names, addresses, employers, SSN or birth-date variations on the report.',
      to: ['bureaus'], type: 'pii_611',
      fields: [F('wrongNames', 'Names that are not mine (one per line)', { type: 'textarea' }), F('wrongAddresses', 'Addresses where I never lived (one per line)', { type: 'textarea' }), F('wrongOther', 'Other wrong info (employers, SSN or DOB variations)', { type: 'textarea' })],
      item: v => {
        const parts = [['Names', v.wrongNames], ['Addresses', v.wrongAddresses], ['Other', v.wrongOther]].filter(p => String(p[1] || '').trim()).map(p => `${p[0]}: ${String(p[1]).trim().split(/\n+/).join('; ')}`);
        return { creditor: 'Personal information', discrepancy: `The following personal information in my file is not mine or is inaccurate — ${parts.join(' | ') || '[list the wrong information]'}.`, requested: 'Delete the inaccurate personal information listed.', evidence: 'Photo ID and proof of current address' };
      } },
    { id: 'au_remove', cat: 'other', title: 'Remove me as an authorized user', when: 'A card the client is only an authorized user on is hurting their report. This is not a dispute.',
      to: ['other'], otherLabel: 'Card issuer', otherRequired: true, type: 'au_removal',
      fields: [F('creditor', 'Card issuer as reported', { required: true }), F('accountNumber', 'Account number (last 4 is enough)'), F('owner', 'Primary cardholder (optional)')],
      item: v => ({ creditor: v.creditor, accountNumber: v.accountNumber, discrepancy: `I am listed as an authorized user on this account${v.owner ? ' (primary cardholder: ' + v.owner + ')' : ''}. I am not the account holder and I ask to be removed.`, requested: 'Remove me as an authorized user and have the account deleted from my credit file.', evidence: '' }) }
  ];

  const byId = id => TEMPLATES.find(t => t.id === id);

  /** Fill a template. Returns { ok, item, errors }. */
  function fill(id, values) {
    const t = byId(id);
    if (!t) return { ok: false, errors: ['Unknown template.'] };
    const v = Object.assign({}, values);
    const errors = t.fields.filter(f => f.required && !String(v[f.k] || '').trim()).map(f => `Fill in “${f.label}”.`);
    if (errors.length) return { ok: false, errors };
    const item = t.item(v);
    Object.keys(item).forEach(k => { if (item[k] === '' || item[k] === undefined) delete item[k]; });
    return { ok: true, item };
  }

  /** Letter type for a recipient kind ('bureaus', 'lexis', 'other'). */
  function typeFor(t, kind) {
    if (kind === 'bureaus' && t.bureauType) return t.bureauType;
    if (kind === 'other' && t.otherType) return t.otherType;
    return t.type;
  }

  const api = { CATS, TEMPLATES, LEXIS, byId, fill, typeFor };
  root.Templates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
