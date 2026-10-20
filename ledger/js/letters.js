/*
 * Dispute letter builder. Every letter is in the consumer's voice, names the specific
 * information disputed and why, and lists enclosures — the elements 12 C.F.R. § 1022.43(d)
 * and FCRA § 611 rely on. Letters without a specific discrepancy are refused.
 */
(function (root) {
  'use strict';
  const Law = root.Law;

  function header(client, recipient, today) {
    const lines = [client.name];
    if (client.address) lines.push(client.address);
    const cityLine = [client.city, client.state].filter(Boolean).join(', ') + (client.zip ? ' ' + client.zip : '');
    if (cityLine.trim()) lines.push(cityLine.trim());
    const ids = [];
    if (client.dob) ids.push('Date of birth: ' + client.dob);
    if (client.ssnLast4) ids.push('SSN (last 4): ' + client.ssnLast4);
    return lines.join('\n') + (ids.length ? '\n' + ids.join(' · ') : '') +
      '\n\n' + today + '\n\n' + recipient.name + '\n' + (recipient.address || '[recipient address]') + '\n';
  }

  function itemBlock(it, i) {
    const lines = [`${i + 1}. ${it.creditor}${it.accountNumber ? ' — account ending ' + String(it.accountNumber).replace(/\D/g, '').slice(-4) : ''}${it.bureau ? ' (as reported by ' + it.bureau + ')' : ''}`];
    lines.push('   What is inaccurate: ' + it.discrepancy);
    if (it.fields && it.fields.length) lines.push('   Data fields affected: ' + it.fields.join('; '));
    if (it.requested) lines.push('   Correction requested: ' + it.requested);
    if (it.evidence) lines.push('   Supporting evidence: ' + it.evidence);
    return lines.join('\n');
  }

  const BODIES = {
    cra_611: (c, items, ctx) => `Re: Request for reinvestigation of disputed information — FCRA § 611

I am writing to dispute the following information in my credit file${ctx.report ? ' (report dated ' + ctx.report.date + ')' : ''}. I have reviewed it carefully and believe each item below is inaccurate or incomplete for the reason stated.

${items.map(itemBlock).join('\n\n')}

Please conduct a reasonable reinvestigation, forward all relevant information I have provided to the furnisher, and correct or delete any information that is inaccurate, incomplete or cannot be verified. Please send me written results and an updated copy of my report when the reinvestigation is complete.`,

    furnisher_623: (c, items) => `Re: Direct dispute of information you furnish to consumer reporting agencies — 12 C.F.R. § 1022.43

I am disputing the accuracy of information your company reports about me. The specific information and the basis for my dispute are below, with copies of supporting documents enclosed.

${items.map(itemBlock).join('\n\n')}

Please investigate, review the enclosed documents, and report the results to me within the period required by law. If the information is inaccurate, please notify every consumer reporting agency to which you furnished it so it can be corrected. While the investigation is pending, please report the account as disputed.`,

    mov_611a7: (c, items, ctx) => `Re: Request for description of reinvestigation procedure — FCRA § 611(a)(7)

You recently notified me that the following item${items.length > 1 ? 's were' : ' was'} verified after my dispute${ctx.priorSentAt ? ' sent on ' + ctx.priorSentAt : ''}:

${items.map(itemBlock).join('\n\n')}

Please provide a description of the procedure used to determine the accuracy and completeness of the information, including the business name, address and telephone number of any furnisher contacted, as required by FCRA § 611(a)(6)(B)(iii) and (a)(7).`,

    validation_809: (c, items) => `Re: Request for validation of debt — FDCPA § 809(b)

I received your notice about the debt identified below and am requesting validation within the validation period.

${items.map(itemBlock).join('\n\n')}

Please provide the name of the original creditor, an itemization of the amount claimed, and verification of the debt. Please cease collection of this debt until you mail the requested validation to me.`,

    obsolete_605: (c, items) => `Re: Removal of obsolete information — FCRA § 605

The following item${items.length > 1 ? 's are' : ' is'} beyond the period during which it may be reported:

${items.map(itemBlock).join('\n\n')}

Please delete the obsolete information and send me an updated copy of my report.`,

    disclosure_609: () => `Re: Request for file disclosure — FCRA § 609

Please send me a copy of all information in my consumer file, including the sources of the information and the identity of everyone who has obtained my report during the period the law requires. Copies of my proof of identity and address are enclosed.`,

    reinsertion_611: (c, items) => `Re: Information reinserted after deletion — FCRA § 611(a)(5)(B)

The following information was previously deleted after my dispute and now appears in my file again:

${items.map(itemBlock).join('\n\n')}

I did not receive the written notice of reinsertion required within five business days. Please provide the furnisher’s certification of accuracy and the notice required by law, or delete the reinserted information.`,

    business_correction: (c, items, ctx) => `Re: Request to correct business credit file${ctx.business && ctx.business.legalName ? ' — ' + ctx.business.legalName : ''}${ctx.business && ctx.business.duns ? ' (D-U-N-S ' + ctx.business.duns + ')' : ''}

I am an authorized representative of ${ctx.business && ctx.business.legalName ? ctx.business.legalName : 'the business named above'}. The following information in our business credit file is inaccurate:

${items.map(itemBlock).join('\n\n')}

We understand business credit files are generally not covered by the Fair Credit Reporting Act, and we are asking you to correct them under your published dispute and data-correction process. Supporting documents are enclosed. Please correct the file and confirm the update in writing.`,

    furnisher_final: (c, items, ctx) => `Re: Final notice of inaccurate reporting — FCRA § 623

I previously disputed the information below${ctx.priorSentAt ? ' (dispute sent ' + ctx.priorSentAt + ')' : ''}, and it continues to be reported inaccurately. I am providing the specific inaccuracy and my supporting documents again:

${items.map(itemBlock).join('\n\n')}

As a furnisher you must not report information you know or have reasonable cause to believe is inaccurate, must correct and update information you determine is incomplete or inaccurate, must report the account as disputed while it is disputed, and must conduct a reasonable investigation of disputes (15 U.S.C. § 1681s-2(a)(1)–(3), (a)(8), (b)). Please correct the reporting with every consumer reporting agency you furnished it to and confirm in writing. I am keeping copies of this correspondence.`,

    cfpb_complaint: (c, items, ctx) => `CFPB COMPLAINT NARRATIVE — for ${c.name} to review and submit at consumerfinance.gov/complaint

Company: ${ctx.recipientName || '[company name]'}
Product: Credit reporting

What happened:
I disputed inaccurate information in my credit file. The information was verified without a reasonable investigation and is still reported inaccurately:

${items.map(itemBlock).join('\n\n')}

What I want the company to do:
Conduct a reasonable investigation of the documents I provided, correct or delete the inaccurate information, and confirm the correction in writing.

[Attach copies of the dispute letters, mailing receipts, the bureau's results and the supporting documents listed above. Read every statement before submitting — it must be true and complete.]`,

    public_record_611: (c, items) => `Re: Dispute of public record information — FCRA §§ 607(b) and 611

I am disputing the following public record information in my consumer file. Court records show it is inaccurate or incomplete for the reason stated, and copies are enclosed.

${items.map(itemBlock).join('\n\n')}

You must follow reasonable procedures to assure maximum possible accuracy (15 U.S.C. § 1681e(b)) and conduct a reasonable reinvestigation of my dispute (15 U.S.C. § 1681i). Please review the enclosed court documents rather than relying only on a data vendor, delete or correct the information, and send me the results, the source of this record, and an updated copy of my file.`,

    tenant_screening_611: (c, items) => `Re: Dispute of eviction record in my tenant screening file — FCRA §§ 607(b), 609 and 611

You prepared a tenant screening report about me that includes the eviction information below. It is inaccurate or incomplete for the reason stated, and court records are enclosed.

${items.map(itemBlock).join('\n\n')}

As a consumer reporting agency you must use reasonable procedures to assure maximum possible accuracy (15 U.S.C. § 1681e(b)) and reinvestigate within 30 days (15 U.S.C. § 1681i). Please delete or correct this record, tell me the source of the information (15 U.S.C. § 1681g), send me the results in writing, and send a corrected report to anyone who received my report in the past six months if I request it.`,

    student_loan_623: (c, items) => `Re: Direct dispute of student loan reporting — 12 C.F.R. § 1022.43

I am disputing information you report to the consumer reporting agencies about my student loan. The specific information, the reason it is inaccurate, and supporting documents are below.

${items.map(itemBlock).join('\n\n')}

Please investigate, review the enclosed documents (several are your own records), and send me the results within 30 days. If the information is inaccurate, please correct it with every consumer reporting agency you report to (15 U.S.C. § 1681s-2(a)(2), (a)(8)). While the investigation is pending, please report the account as disputed.`,

    inquiry_604: (c, items) => `Re: Dispute of unauthorized inquiries — FCRA §§ 604 and 611

The following inquiries in my file were made without my authorization. I did not apply for credit with these companies and did not give them permission to obtain my report.

${items.map(itemBlock).join('\n\n')}

A consumer report may be furnished only for a permissible purpose (15 U.S.C. § 1681b). Please reinvestigate, confirm that each company had a permissible purpose, delete any inquiry that cannot be verified, and send me the results and an updated copy of my report.`,

    pii_611: (c, items) => `Re: Correction of personal information — FCRA §§ 607(b) and 611

My file contains personal identifying information that is not mine or is out of date. Inaccurate identifiers can lead to errors in my file.

${items.map(itemBlock).join('\n\n')}

My correct information is shown at the top of this letter, and copies of my photo ID and proof of address are enclosed. Please remove the inaccurate information listed above and send me an updated copy of my report.`,

    au_removal: (c, items) => `Re: Request to remove me as an authorized user

I am listed as an authorized user on the account(s) below. I am not the account owner and am not liable for this debt.

${items.map(itemBlock).join('\n\n')}

Please remove me as an authorized user and ask every credit bureau to which you report this account to delete it from my credit file. Please confirm in writing when this is done.`,

    goodwill: (c, items) => `Re: Request for a goodwill adjustment

I am writing about my account(s) listed below. I am not disputing the accuracy of this information. I am asking you to consider a courtesy adjustment of the late payment reporting in light of my payment history since then.

${items.map(itemBlock).join('\n\n')}

Thank you for considering this request.`
  };

  /** Throws when the letter would not meet the specificity requirements. */
  function validate(type, items) {
    const errs = [];
    if (!BODIES[type]) errs.push('Unknown letter type.');
    if (type !== 'disclosure_609') {
      if (!items.length) errs.push('Add at least one item.');
      items.forEach((it, i) => { if (!it.discrepancy || it.discrepancy.trim().length < 12) errs.push(`Item ${i + 1}: state specifically what is inaccurate.`); });
    }
    return errs;
  }

  function build(type, ctx) {
    const { client, recipient, items = [], today, enclosures = [] } = ctx;
    const errs = validate(type, items);
    if (errs.length) return { ok: false, errors: errs };
    const encl = enclosures.length ? enclosures : defaultEnclosures(type, items);
    const text = header(client, recipient, today) + '\n' + BODIES[type](client, items, ctx) +
      '\n\nSincerely,\n\n\n' + client.name +
      (encl.length ? '\n\nEnclosures:\n' + encl.map(e => '• ' + e).join('\n') : '') +
      '\n\n[Review recipient address, account identifiers, attachments and every statement with the consumer before sending. The consumer must confirm each statement is true.]';
    return { ok: true, text, lint: Law.lintText(text) };
  }

  function defaultEnclosures(type, items) {
    const e = ['Copy of government-issued photo ID', 'Proof of current address (utility bill or bank statement)'];
    if (type === 'disclosure_609') return e;
    if (items.some(i => i.evidence)) e.push('Supporting documents referenced above');
    if (['cra_611', 'obsolete_605', 'public_record_611', 'tenant_screening_611', 'inquiry_604', 'pii_611'].includes(type)) e.push('Copy of the credit report page with the disputed items marked');
    return e;
  }

  const api = { build, validate, BODIES };
  root.Letters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
