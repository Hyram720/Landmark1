/*
 * "Remove what isn't supposed to be there" — accuracy checks beyond Metro 2 fields.
 *
 * Personal file (per bureau report): names/AKAs, addresses, employers, DOB and SSN variations
 * (values are never echoed — staff see masked hints only), inquiries the consumer doesn't
 * recognize or that are older than 2 years, and items the consumer marks as unrecognized or
 * unverifiable (needs a written explanation). Identity theft disputes are out of scope; refer clients to IdentityTheft.gov.
 *
 * Business file (per business bureau report): name/address/phone/formation date/SIC/NAICS vs the
 * client file, stale or closed accounts reported open,
 * paid accounts with a balance, duplicate tradelines, and liens/judgments/UCCs the client's
 * documents show satisfied but the bureau still shows open.
 *
 * Accuracy-based: accurate, verified, timely negative items are never flagged, and
 * notDisputed() explains why they are left alone.
 *
 * Data the checks read (all optional):
 *   report.personal = { names:[], addresses:[], employers:[], dobs:[], ssnLast4s:[] }
 *   report.inquiries = [{ id, creditor, date, kind:'hard'|'soft', clientSays:'unrecognized'|'authorized', explanation }]
 *   tradeline.clientSays = 'unrecognized' | 'accurate'; tradeline.clientExplanation
 *   client.aka[], client.previousAddresses[], client.employers[]
 *   client.businessReports = [{ id, bureau, date, profile:{ name, address, phone, formedOn, yearsInBusiness, naics, sic },
 *     tradelines:[{ id, creditor, accountNumber, status:'open'|'closed'|'paid', balance, limit, opened, lastReported, closedOn, clientSays }],
 *     publicRecords:[{ id, type:'ucc'|'lien'|'judgment', filedOn, status:'open'|'satisfied'|'released', securedParty, amount, clientSatisfiedOn, docRef }] }]
 */
(function (root) {
  'use strict';
  const norm = s => String(s || '').toLowerCase().replace(/[.,#'’]/g, '').replace(/\b(street|st|avenue|ave|road|rd|suite|ste|apartment|apt|unit|boulevard|blvd|drive|dr|lane|ln|court|ct)\b/g, m => m.slice(0, 2)).replace(/\s+/g, ' ').trim();
  const bizNorm = s => norm(s).replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pllc|the)\b/g, '').replace(/\s+/g, ' ').trim();
  const digits = s => String(s || '').replace(/\D/g, '');
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86400000);
  const streetKey = s => { const n = norm(s); const m = n.match(/^(\d+)\s+(\S+)/); return m ? m[1] + ' ' + m[2] : n.slice(0, 18); };

  const BIZ_BUREAUS = {
    'Dun & Bradstreet': { name: 'Dun & Bradstreet — Customer Service / Data Disputes', address: '[Business files are corrected through D&B’s D-U-N-S Manager / iUpdate online — confirm the current mailing address before mailing]' },
    'Experian Business': { name: 'Experian Business Information Services — Business Disputes', address: '[Experian business disputes: “Submit Data Dispute” online or BusinessDisputes@Experian.com — confirm the current mailing address before mailing]' },
    'Equifax Business': { name: 'Equifax Commercial Services — Business Support', address: '[Equifax business support portal — confirm the current mailing address before mailing]' }
  };

  function f(code, severity, title, detail, extra) { return Object.assign({ code, severity, title, detail }, extra || {}); }

  // ---------------- personal ----------------
  function personalChecks(report, client, opts) {
    const today = (opts && opts.today) || todayIso();
    const out = [];
    const c = client || {};
    const P = report.personal || {};
    const base = { bureau: report.bureau, reportId: report.id };
    const knownNames = [c.name, [c.firstName, c.lastName].filter(Boolean).join(' ')].concat(c.aka || []).filter(Boolean).map(norm);
    (P.names || []).forEach((n, i) => {
      const k = norm(n);
      if (!k || knownNames.some(x => x === k || (x.split(' ')[0] === k.split(' ')[0] && x.split(' ').pop() === k.split(' ').pop()))) return;
      out.push(f('PII-NAME-VARIANT', 'medium', 'Name variant the client hasn’t confirmed', `The report lists the name “${n}”, which is not the client’s name or a known AKA.`, Object.assign({ accountId: `pii:name:${i}`, creditor: 'Personal information: name', fields: ['Name'], basis: 'FCRA §§ 607(b), 611' }, base)));
    });
    const knownAddr = [c.address].concat(c.previousAddresses || []).filter(Boolean).map(streetKey);
    (P.addresses || []).forEach((a, i) => {
      if (!a || knownAddr.includes(streetKey(a))) return;
      out.push(f('PII-ADDRESS-UNKNOWN', 'medium', 'Address the client hasn’t lived at (or outdated)', `The report lists the address “${a}”, which is not the client’s current or a known previous address. Bureaus may keep a current address they can verify.`, Object.assign({ accountId: `pii:addr:${i}`, creditor: 'Personal information: address', fields: ['Address'], basis: 'FCRA §§ 607(b), 611' }, base)));
    });
    const knownEmp = (c.employers || []).map(norm);
    (P.employers || []).forEach((e, i) => {
      if (!e || knownEmp.includes(norm(e)) || !(c.employers || []).length && !(opts && opts.strictEmployers)) return;
      out.push(f('PII-EMPLOYER-UNKNOWN', 'low', 'Employer the client doesn’t recognize', `The report lists the employer “${e}”, which is not on the client’s employment history.`, Object.assign({ accountId: `pii:emp:${i}`, creditor: 'Personal information: employer', fields: ['Employer'], basis: 'FCRA §§ 607(b), 611' }, base)));
    });
    if (c.dob) (P.dobs || []).forEach((d, i) => {
      if (!d || String(d).slice(0, 10) === String(c.dob).slice(0, 10)) return;
      out.push(f('PII-DOB-VARIATION', 'high', 'A different date of birth is on file', 'The report shows a date of birth that does not match the client’s (value hidden). It is inaccurate personal information and can be corrected with the bureau.', Object.assign({ accountId: `pii:dob:${i}`, creditor: 'Personal information: date of birth', fields: ['Date of birth'], basis: 'FCRA §§ 607(b), 611', staffOnly: true }, base)));
    });
    if (c.ssnLast4) (P.ssnLast4s || []).forEach((s, i) => {
      if (!s || digits(s).slice(-4) === digits(c.ssnLast4).slice(-4)) return;
      out.push(f('PII-SSN-VARIATION', 'high', 'An SSN variation is on file', 'The report shows a Social Security number variation that does not match the client’s (value hidden). It is inaccurate personal information and can be corrected with the bureau.', Object.assign({ accountId: `pii:ssn:${i}`, creditor: 'Personal information: SSN variation', fields: ['SSN'], basis: 'FCRA §§ 607(b), 611', staffOnly: true }, base)));
    });
    (report.inquiries || []).forEach((q, i) => {
      if ((q.kind || 'hard') !== 'hard') return;
      const id = q.id || `inq:${i}`;
      if (q.clientSays === 'unrecognized') out.push(f('INQ-UNRECOGNIZED', 'medium', 'Hard inquiry the client doesn’t recognize', `Inquiry by ${q.creditor || 'an unknown company'} on ${q.date || 'an unknown date'}. The client says they did not apply or authorize it.`, Object.assign({ accountId: id, creditor: q.creditor || 'Inquiry', fields: ['Inquiry'], basis: 'FCRA §§ 604, 611', explanation: q.explanation || '' }, base)));
      else if (q.date && days(q.date, today) > 730) out.push(f('INQ-OVER-2Y', 'low', 'Hard inquiry older than 2 years', `Inquiry by ${q.creditor || 'a company'} on ${q.date} is more than 2 years old; bureaus generally display hard inquiries for about 2 years.`, Object.assign({ accountId: id, creditor: q.creditor || 'Inquiry', fields: ['Inquiry date'], basis: 'Bureau inquiry retention; FCRA § 609(a)(3)' }, base)));
    });
    (report.accounts || []).forEach(t => {
      const tb = Object.assign({ accountId: t.id, creditor: t.creditor }, base);
      if (t.clientSays === 'unrecognized') {
        if (String(t.clientExplanation || '').trim().length >= 12) out.push(f('CONSUMER-ASSERTED', 'medium', 'Client disputes this item as inaccurate or unverifiable', `The client states: ${String(t.clientExplanation).trim()}`, Object.assign({ fields: ['Tradeline'], basis: 'FCRA § 611(a)(1), (a)(5)(A)' }, tb)));
        else out.push(f('CONSUMER-ASSERTED-NEEDS-REASON', 'low', 'Client marked this unrecognized — explanation needed', 'Record specifically what the client says is wrong before it can be disputed.', Object.assign({ fields: ['Tradeline'], basis: 'FCRA § 611(a)(1)', actionOnly: true }, tb)));
      }
    });
    return out;
  }

  // ---------------- business ----------------
  function bizProfileOf(c) {
    const b = c.business || {};
    const addr = b.address || [c.address, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ');
    return { names: [b.legalName, b.dba].filter(Boolean), address: addr, phone: b.phone || '', formedOn: b.formedOn || '', naics: b.naics || '', sic: b.sic || '' };
  }

  function businessChecks(br, client, opts) {
    const today = (opts && opts.today) || todayIso();
    const c = client || {};
    const me = bizProfileOf(c);
    const p = br.profile || {};
    const out = [];
    const base = { bureau: br.bureau, reportId: br.id, business: true };
    const pf = (code, sev, title, detail, field) => out.push(f(code, sev, title, detail, Object.assign({ accountId: `biz:${code}`, creditor: 'Business profile: ' + field, fields: [field], basis: 'Business bureau correction process' }, base)));
    if (p.name && me.names.length && !me.names.some(n => bizNorm(n) === bizNorm(p.name))) pf('BIZ-NAME-MISMATCH', 'high', 'Business name doesn’t match the client file', `The bureau lists “${p.name}”; the client file shows ${me.names.map(n => '“' + n + '”').join(' / ')}.`, 'Business name');
    if (p.address && me.address && streetKey(p.address) !== streetKey(me.address)) pf('BIZ-ADDRESS-MISMATCH', 'medium', 'Business address doesn’t match the client file', `The bureau lists “${p.address}”; the client file shows “${me.address}”.`, 'Business address');
    if (p.phone && me.phone && digits(p.phone).slice(-10) !== digits(me.phone).slice(-10)) pf('BIZ-PHONE-MISMATCH', 'low', 'Business phone doesn’t match the client file', `The bureau lists ${p.phone}; the client file shows ${me.phone}.`, 'Business phone');
    if (me.formedOn) {
      if (p.formedOn && Math.abs(days(p.formedOn, me.formedOn)) > 31) pf('BIZ-FORMED-MISMATCH', 'medium', 'Formation date doesn’t match state records', `The bureau lists ${p.formedOn}; the client file (state filing) shows ${me.formedOn}.`, 'Date of formation');
      else if (!p.formedOn && p.yearsInBusiness !== undefined && p.yearsInBusiness !== '' && Math.abs(Number(p.yearsInBusiness) - yearsBetween(me.formedOn, today)) >= 1) pf('BIZ-YEARS-MISMATCH', 'medium', 'Years in business looks wrong', `The bureau shows ${p.yearsInBusiness} years in business; the formation date ${me.formedOn} implies about ${Math.floor(yearsBetween(me.formedOn, today))}.`, 'Years in business');
    }
    if (p.naics && me.naics && digits(p.naics) !== digits(me.naics)) pf('BIZ-NAICS-MISMATCH', 'low', 'NAICS code doesn’t match', `The bureau lists NAICS ${p.naics}; the client file shows ${me.naics}. Some industries are treated as higher risk.`, 'NAICS code');
    if (p.sic && me.sic && digits(p.sic) !== digits(me.sic)) pf('BIZ-SIC-MISMATCH', 'low', 'SIC code doesn’t match', `The bureau lists SIC ${p.sic}; the client file shows ${me.sic}.`, 'SIC code');
    const vendors = c.vendorAccounts || [];
    const tls = br.tradelines || [];
    tls.forEach(t => {
      const tb = Object.assign({ accountId: t.id, creditor: t.creditor, accountNumber: t.accountNumber || '' }, base);
      const v = vendors.find(x => bizNorm(x.vendor) === bizNorm(t.creditor));
      const st = String(t.status || '').toLowerCase();
      if (st === 'open' && (t.closedOn || (v && /closed/i.test(v.status || '')))) out.push(f('BIZ-TL-CLOSED-OPEN', 'medium', 'Closed account reported as open', `${t.creditor} is reported open, but ${t.closedOn ? 'it was closed on ' + t.closedOn : 'the client’s records show it closed'}.`, Object.assign({ fields: ['Account status'], basis: 'Business bureau correction process' }, tb)));
      else if (st === 'open' && t.lastReported && days(t.lastReported, today) > 365 && Number(t.balance) > 0) out.push(f('BIZ-TL-STALE', 'low', 'Stale tradeline still showing a balance', `${t.creditor} was last reported on ${t.lastReported} (over a year ago) and still shows a $${Number(t.balance).toLocaleString()} balance.`, Object.assign({ fields: ['Last reported', 'Balance'], basis: 'Business bureau correction process' }, tb)));
      if (['paid', 'closed'].includes(st) && Number(t.balance) > 0) out.push(f('BIZ-TL-PAID-BALANCE', 'high', 'Paid/closed account still shows a balance', `${t.creditor} is reported ${st} with a $${Number(t.balance).toLocaleString()} balance.`, Object.assign({ fields: ['Balance', 'Account status'], basis: 'Business bureau correction process' }, tb)));
    });
    tls.forEach((t, i) => tls.slice(i + 1).forEach(u => {
      const same = bizNorm(t.creditor) === bizNorm(u.creditor) && ((digits(t.accountNumber) && digits(t.accountNumber).slice(-4) === digits(u.accountNumber).slice(-4)) || (t.opened && t.opened === u.opened && Number(t.balance) === Number(u.balance)));
      if (same) out.push(f('BIZ-TL-DUPLICATE', 'medium', 'Same tradeline reported twice', `${u.creditor} appears twice on the ${br.bureau} file.`, Object.assign({ accountId: u.id, creditor: u.creditor, accountNumber: u.accountNumber || '', fields: ['Tradeline'], basis: 'Business bureau correction process' }, base)));
    }));
    (br.publicRecords || []).forEach(pr => {
      if (/open|active|unsatisfied/i.test(pr.status || '') && pr.clientSatisfiedOn) out.push(f('BIZ-PR-SATISFIED-OPEN', 'high', `${String(pr.type || 'Public record').toUpperCase()} satisfied but shown open`, `The ${pr.type || 'filing'} filed ${pr.filedOn || ''}${pr.securedParty ? ' by ' + pr.securedParty : ''} is shown open, but the client’s documents show it ${pr.type === 'ucc' ? 'terminated' : 'satisfied/released'} on ${pr.clientSatisfiedOn}${pr.docRef ? ' (' + pr.docRef + ')' : ''}.`, Object.assign({ accountId: pr.id, creditor: `${String(pr.type || 'Filing').toUpperCase()}${pr.securedParty ? ' — ' + pr.securedParty : ''}`, fields: ['Public record status'], basis: 'Business bureau correction process' }, base)));
    });
    return out;
  }

  /** Negative tradelines left alone because nothing shows they're inaccurate (UI explanation). */
  function notDisputed(report, findings) {
    const flagged = new Set((findings || []).map(x => x.accountId));
    const neg = /^(7\d|8\d|9[3-7]|6[1-5])$/;
    return (report.accounts || []).filter(t => neg.test(String(t.status || '')) && !flagged.has(t.id) && t.clientSays !== 'unrecognized')
      .map(t => ({ accountId: t.id, creditor: t.creditor, bureau: report.bureau, why: 'Negative but no inaccuracy found in the data, and the client hasn’t said it’s wrong. Accurate, current, verifiable information can’t be removed by disputing it; it ages off under FCRA § 605.' }));
  }

  root.FileCheck = { personalChecks, businessChecks, notDisputed, bizProfileOf, BIZ_BUREAUS, norm, bizNorm };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FileCheck;
})(typeof window !== 'undefined' ? window : globalThis);
