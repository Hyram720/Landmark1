// Final CROA and E-SIGN texts. Served as written, with the HTML comment already removed.
// Per-client blanks are filled before the signing check. Signing is refused while a
// document still has an owner bracket, PLACEHOLDER, or PENDING COMPLIANCE REVIEW.
// The consumer's cancellation [date] and [purchaser's signature] stay blank.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cancellationWindow, etYmd } from './croa-window.js';

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
  const c = client || {};
  const cityLine = [c.city, c.state, c.zip].filter(Boolean).join(' ');
  const line = [c.address, cityLine].filter(Boolean).join(', ');
  return line || 'New Jersey';
}

function scheduleA(client) {
  const rows = client && client.scheduleA;
  if (typeof rows === 'string' && rows.trim() && !/\[[^\]]+\]/.test(rows)) return rows.trim();
  if (Array.isArray(rows) && rows.length) {
    return rows.map(r => [r.item || r.creditor, r.last4 ? 'ending ' + r.last4 : '', r.bureau].filter(Boolean).join(' / ')).join('\n');
  }
  return 'None listed yet.';
}

/** Replace blanks that belong to this client. Owner blanks are left in place. */
export function fillPerClientText(text, client, now = new Date()) {
  const c = client || {};
  const signedAt = (c.onboarding && (c.onboarding.contractSignedAtTs || c.onboarding.contractSignedAt)) || now;
  const win = cancellationWindow(signedAt, now instanceof Date ? now : new Date(now));
  const name = String(c.name || '').trim() || 'Client';
  return String(text || '')
    .replace(/\[CLIENT FULL NAME\]/g, name)
    .replace(/\[CLIENT ADDRESS\]/g, clientAddress(c))
    .replace(/\[DATE SIGNED[^\]]*\]/g, etLongDate(signedAt))
    .replace(/\[ITEM \/ CREDITOR NAME \/ ACCOUNT ENDING IN LAST 4 ONLY \/ BUREAU\(S\)\]/g, scheduleA(c))
    .replace(/\[DATE:[^\]]*\]/g, etLongDate(win.deadlineInstant))
    .replace(/\[LINK TO SAMPLE PDF\]/g, '/api/portal/esign/sample')
    .replace(/\[______\]/g, 'the 6-character code from the sample PDF')
    .replace(/\[ \]/g, '');
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
