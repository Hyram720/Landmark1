// Final CROA and E-SIGN texts. Served as written, with the HTML comment already removed.
// Per-client blanks are filled before the signing check. Signing is refused while a
// document still has an owner bracket, PLACEHOLDER, or PENDING COMPLIANCE REVIEW.
// The consumer's cancellation [date] and [purchaser's signature] stay blank.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cancellationWindow, etYmd, formatDocumentTimeEt } from './croa-window.js';

const dir = path.resolve(new URL('../legal/', import.meta.url).pathname);
const TZ = 'America/New_York';

function read(name) {
  return fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, '');
}

function etLongDate(instant) {
  const when = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(when.getTime())) return etYmd(new Date());
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(when);
}

function clientAddress(client) {
  return mailingAddress(client);
}

export function mailingAddress(client) {
  const c = client || {};
  const street = String(c.address || '').trim();
  const city = String(c.city || '').trim();
  const state = String(c.state || '').trim();
  const zip = String(c.zip || '').trim();
  if (!street || !city || !/^[A-Za-z]{2}$/.test(state) || !/^\d{5}(-\d{4})?$/.test(zip)) return '';
  return `${street}, ${city}, ${state.toUpperCase()} ${zip}`;
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

/** Replace blanks that belong to this client. Owner blanks are left in place. */
export function fillPerClientText(text, client, now = new Date()) {
  const c = client || {};
  const signedAt = (c.onboarding && (c.onboarding.contractSignedAtTs || c.onboarding.contractSignedAt)) || now;
  const win = cancellationWindow(signedAt, now instanceof Date ? now : new Date(now));
  const name = String(c.name || '').trim() || 'Client';
  let out = String(text || '')
    .replace(/\[CLIENT FULL NAME\]/g, name)
    .replace(/\[CLIENT ADDRESS\]/g, clientAddress(c) || '[CLIENT ADDRESS]')
    .replace(/\[DATE SIGNED[^\]]*\]/g, formatDocumentTimeEt(signedAt))
    .replace(/\[ITEM \/ CREDITOR NAME \/ ACCOUNT ENDING IN LAST 4 ONLY \/ BUREAU\(S\)\]/g, scheduleAText(c))
    .replace(/\[DATE:[^\]]*\]/g, etLongDate(win.deadlineInstant))
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
