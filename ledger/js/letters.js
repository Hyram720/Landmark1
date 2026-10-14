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

    block_605b: (c, items) => `Re: Request to block information resulting from identity theft — FCRA § 605B

I am a victim of identity theft. The information listed below does not relate to any transaction that I made or authorized.

${items.map(itemBlock).join('\n\n')}

Enclosed are proof of my identity, a copy of my identity theft report (FTC IdentityTheft.gov report and/or police report), and this statement identifying the information. Please block this information from my file within four business days and notify the furnisher(s) as required by law.`,

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

Supporting documents are enclosed. Please correct the file and confirm the update in writing.`,

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
    if (type === 'block_605b') e.push('Identity theft report (IdentityTheft.gov / police report)');
    if (type === 'disclosure_609') return e;
    if (items.some(i => i.evidence)) e.push('Supporting documents referenced above');
    if (type === 'cra_611' || type === 'obsolete_605') e.push('Copy of the credit report page with the disputed items marked');
    return e;
  }

  const api = { build, validate, BODIES };
  root.Letters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
