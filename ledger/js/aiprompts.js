/*
 * Shared AI report-scan prompt, JSON schema and HTML-to-text helper. Used by the server and by
 * the browser (master file mode, where the user's own API key calls Claude directly).
 */
(function (root) {
  'use strict';
  const str = { type: 'string' };
const ACCOUNT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    creditor: str, accountNumber: str, originalCreditor: str,
    type: { type: 'string', enum: ['R', 'I', 'M', 'O', 'C', ''] },
    status: str, balance: str, pastDue: str, limit: str, highCredit: str, chargeOff: str,
    opened: str, closed: str, lastPayment: str, dofd: str, reportedDate: str,
    ecoa: str, complianceCode: str, paymentHistory: str, remarks: str
  },
  required: ['creditor', 'accountNumber', 'originalCreditor', 'type', 'status', 'balance', 'pastDue', 'limit', 'highCredit', 'chargeOff', 'opened', 'closed', 'lastPayment', 'dofd', 'reportedDate', 'ecoa', 'complianceCode', 'paymentHistory', 'remarks']
};
const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reportDate: str, source: str,
    bureaus: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { bureau: { type: 'string', enum: ['Equifax', 'Experian', 'TransUnion'] }, score: str, accounts: { type: 'array', items: ACCOUNT_SCHEMA } },
      required: ['bureau', 'score', 'accounts']
    } },
    notes: str
  },
  required: ['reportDate', 'source', 'bureaus', 'notes']
};

const SCAN_PROMPT = `Extract every tradeline (credit account and collection account) from this consumer credit report into Metro 2 terms, separately for each bureau shown (Equifax, Experian, TransUnion). A 3-bureau report lists the same account once per bureau — output it under each bureau with that bureau's own values.

Rules:
- Use only what the report shows. Use "" for anything not shown. Never guess or fill in values.
- type: R revolving/credit card, I installment/auto/student/personal loan, M mortgage, O open/collection/charge accounts, C line of credit.
- status: map the bureau's wording to the Metro 2 Account Status code: 11 current/pays as agreed, 13 paid or closed with $0, 61–65 paid after a derogatory event, 71 30 days late, 78 60, 80 90, 82 120, 83 150, 84 180+, 93 collection, 94 foreclosure, 95 voluntary surrender, 96 repossession, 97 charge-off, 05 transferred/sold. Put the bureau's own wording in remarks.
- Money as plain numbers without $ or commas. Dates as YYYY-MM-DD (use day 01 when only month/year is shown).
- paymentHistory: up to 24 characters, newest month first, using 0 (current/OK), 1–6 (30–180 days late), G collection, L charge-off, B/D for no data.
- dofd: the Date of First Delinquency if shown (also called date of first delinquency, or the delinquency date used for removal).
- accountNumber: keep the masked format shown.
- Skip inquiries, public-record summaries, addresses and employment.
- reportDate: the date the report was generated. source: the provider (e.g. MyFreeScoreNow, IdentityIQ, SmartCredit, annualcreditreport.com).
- notes: anything you could not read or were unsure about.`;

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(td|th)>/gi, ' | ').replace(/<\/(tr|p|div|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

  const SCAN_SYSTEM = 'You extract credit report data precisely. You never invent values.';
  const api = { ACCOUNT_SCHEMA, REPORT_SCHEMA, SCAN_PROMPT, SCAN_SYSTEM, htmlToText };
  root.AIPrompts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
