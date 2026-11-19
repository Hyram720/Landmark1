// Final CROA and E-SIGN texts. Served as written, with the HTML comment already removed.
// Per-client blanks are filled before the signing check. Signing is refused while a
// document still has an owner bracket, PLACEHOLDER, or PENDING COMPLIANCE REVIEW.
// The consumer's cancellation [date] and [purchaser's signature] stay blank.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cancellationWindow, formatDeadlineDateEt, formatDocumentTimeEt } from './croa-window.js';

const dir = path.resolve(new URL('../legal/', import.meta.url).pathname);

function read(name) {
  return fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, '');
}

function clientAddress(client) {
  return mailingAddress(client);
}

export function mailingAddress(client) {
  const c = client || {};
  const street = String(c.address || '').trim();
  const city = String(c.city || '').trim();
  const state = String(c.state || '').trim().toUpperCase();
  const zip = String(c.zip || '').trim();
  const zip5 = zip.slice(0, 5);
  if (!street || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(-\d{4})?$/.test(zip)) return '';
  if (state !== 'NJ') return '';
  const n = Number(zip5);
  if (n < 7001 || n > 8999) return '';
  return `${street}, ${city}, NJ ${zip}`;
}

function addressGap(client) {
  const c = client || {};
  const street = String(c.address || '').trim();
  const city = String(c.city || '').trim();
  const state = String(c.state || '').trim().toUpperCase();
  const zip = String(c.zip || '').trim();
  const zipShape = /^\d{5}(-\d{4})?$/.test(zip);
  const missing = [];
  if (!street) missing.push('street');
  if (!city) missing.push('city');
  if (!state) missing.push('state');
  if (!zipShape) missing.push('ZIP');
  if (missing.length) return { code: 'address', message: 'Your mailing address is needed: ' + missing.join(', ') + '.' };
  const n = Number(zip.slice(0, 5));
  const invalid = [];
  if (state !== 'NJ') invalid.push('state');
  if (n < 7001 || n > 8999) invalid.push('ZIP');
  if (invalid.length) return { code: 'address', message: 'Credit Ledger serves New Jersey residents. Enter a New Jersey address. Check the ' + invalid.join(' and ') + '.' };
  return null;
}

export function enrollmentStatus(client, docs, opts) {
  const c = client || {};
  const requireAddress = !opts || opts.requireAddress !== false;
  if (requireAddress && !mailingAddress(c)) {
    return addressGap(c) || { code: 'address', message: 'Your mailing address is needed' };
  }
  if (scheduleAEntries(c).length < 1 || pricePerResult(c) == null) {
    return { code: 'terms', message: 'Your Credit Ledger specialist still needs to add your items and price' };
  }
  if (enrollmentBlocksSigning(docs)) return { code: 'closed', message: 'Enrollment is not open yet' };
  const o = c.onboarding || {};
  const viewed = o.contractViewedSha256;
  const current = sha256((docs && docs.contract) || '');
  if (o.contractViewStale || (o.contractViewedAt && viewed !== current)) {
    return { code: 'review', message: 'Please read the agreement again.' };
  }
  if (!o.contractViewedAt || viewed !== current) {
    return { code: 'review', message: 'Please read the agreement before you sign.' };
  }
  return { code: '', message: '' };
}

function money(n) {
  const rounded = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** One row per item and bureau. A string is not a Schedule A record. */
export function scheduleAEntries(client) {
  const rows = client && client.scheduleA;
  if (!Array.isArray(rows)) return [];
  const entries = [];
  rows.forEach(row => {
    if (!row || typeof row !== 'object') return;
    const creditor = String(row.creditor || row.item || '').trim();
    if (!creditor) return;
    const last4 = String(row.last4 || '').replace(/\D/g, '').slice(-4);
    const listed = Array.isArray(row.bureaus) ? row.bureaus : String(row.bureau || '').split(/[,/]/);
    const item = String(row.item || '').trim();
    listed.map(b => String(b || '').trim()).filter(Boolean).forEach(bureau => {
      entries.push({ item, creditor, last4, bureau });
    });
  });
  return entries;
}

/** Dollars per result, per item, per bureau. Missing or non-positive stays unset. */
export function pricePerResult(client) {
  const n = Number(client && client.pricePerResult);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function maximumTotal(client) {
  const price = pricePerResult(client);
  const count = scheduleAEntries(client).length;
  if (price == null || count < 1) return null;
  return Math.round(price * count * 100) / 100;
}

function scheduleAText(client) {
  const entries = scheduleAEntries(client);
  if (!entries.length) return 'None listed yet.';
  return entries.map(e => [e.item, e.creditor, e.last4 ? 'ending ' + e.last4 : '', e.bureau].filter(Boolean).join(' / ')).join('\n');
}

/** Stable lines in the text the client views. The signed PDF stamps the real values. */
export const UNSIGNED_DATE_SIGNED = 'the date and time you sign';
export const UNSIGNED_CANCEL_DEADLINE = 'the cancellation deadline, filled when you sign';

/** Signing time for the Date of this agreement and Date signed lines. Does not change the viewed text. */
export function stampContractSignedAt(text, instant) {
  const label = formatDocumentTimeEt(instant);
  return String(text || '').replaceAll(UNSIGNED_DATE_SIGNED, label).replace(/\[DATE SIGNED[^\]]*\]/g, label);
}

/** Cancellation deadline from the signing instant. Does not change the viewed text. */
export function stampCancellationDeadline(text, instant) {
  const when = instant instanceof Date ? instant : new Date(instant);
  const win = cancellationWindow(when, when);
  const label = formatDeadlineDateEt(win.deadlineInstant);
  return String(text || '').replaceAll(UNSIGNED_CANCEL_DEADLINE, label).replace(/\[DATE:[^\]]*\]/g, label);
}

/** Replace blanks that belong to this client. Owner blanks are left in place. The clock is not used here. */
export function fillPerClientText(text, client) {
  const c = client || {};
  const name = String(c.name || '').trim() || 'Client';
  let out = String(text || '')
    .replace(/\[CLIENT FULL NAME\]/g, name)
    .replace(/\[CLIENT ADDRESS\]/g, clientAddress(c) || '[CLIENT ADDRESS]')
    .replace(/\[DATE SIGNED[^\]]*\]/g, UNSIGNED_DATE_SIGNED)
    .replace(/\[ITEM \/ CREDITOR NAME \/ ACCOUNT ENDING IN LAST 4 ONLY \/ BUREAU\(S\)\]/g, scheduleAText(c))
    .replace(/\[DATE:[^\]]*\]/g, UNSIGNED_CANCEL_DEADLINE)
    .replace(/\[LINK TO SAMPLE PDF\]/g, '/api/portal/esign/sample')
    .replace(/\[______\]/g, 'the 6-character code from the sample PDF')
    .replace(/\[ \]/g, '');
  const total = maximumTotal(c);
  const price = pricePerResult(c);
  if (total != null && price != null) {
    const count = scheduleAEntries(c).length;
    out = out
      .replace(/\[PRICE PER RESULT:[^\]]*\]/g, money(price))
      .replace(/\[NUMBER OF ITEM AND BUREAU ENTRIES IN SCHEDULE A\]/g, String(count))
      .replace(/\[MAXIMUM TOTAL\]/g, money(total))
      .replace(/\[PRICE\]/g, money(price));
  }
  return out;
}

export function personalizeCroaDocs(docs, client, now = new Date()) {
  const src = docs || {};
  return {
    disclosure: fillPerClientText(src.disclosure, client, now),
    contract: fillPerClientText(src.contract, client, now),
    cancellation: fillPerClientText(src.cancellation, client, now),
    esign: fillPerClientText(src.esign, client, now)
  };
}

export function documentBlocksSigning(text) {
  const s = String(text || '');
  if (/PLACEHOLDER/i.test(s)) return true;
  if (/PENDING COMPLIANCE REVIEW/.test(s)) return true;
  const withoutConsumerBlanks = s.replace(/\[date\]|\[purchaser's signature\]/g, '');
  if (/\[[^\]]+\]/.test(withoutConsumerBlanks)) return true;
  return false;
}

export function enrollmentBlocksSigning(docs) {
  const set = docs || {};
  if (set.contract && /None listed yet\./.test(set.contract)) return true;
  return ['disclosure', 'contract', 'cancellation', 'esign'].some(key => documentBlocksSigning(set[key]));
}

export function croaSetIsPlaceholder(docs) {
  return enrollmentBlocksSigning(docs);
}

let cache = null;
export function croaDocs() {
  if (!cache) {
    cache = {
      disclosure: read('croa-disclosure-1679c.md'),
      contract: read('croa-contract-1679d.md'),
      cancellation: read('croa-cancellation-1679e.md'),
      esign: read('esign-consent-7001c.md')
    };
  }
  return cache;
}

export function croaPlaceholderDocs() {
  return croaDocs();
}

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}
