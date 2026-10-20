// The ONE redaction module for every outbound AI call (Anthropic: server/ai.js, server/assistant.js;
// OpenAI: server/ledger-assistant.js, server/coach.js). Two layers:
//   1. redact(text) / redactObject(v) / redactPayload(p): mask identifiers before anything leaves.
//   2. assertNoSensitive(payload): a final guard run on the exact request body; it refuses to send
//      if an SSN/ITIN-shaped number or a Luhn-valid 13–19 digit card number is still present.
// Account and card numbers keep their last 4 digits (****1234) so tradelines still match across bureaus.
// Dates that aren't labelled as a date of birth are kept (open dates, DOFD, etc. are needed for disputes).

const SUFFIXES = ['St', 'Street', 'Ave', 'Avenue', 'Rd', 'Road', 'Blvd', 'Boulevard', 'Dr', 'Drive', 'Ln', 'Lane', 'Ct', 'Pl', 'Place', 'Way', 'Ter', 'Terrace', 'Pkwy', 'Parkway', 'Cir', 'Circle', 'Hwy', 'Highway', 'Trl', 'Trail', 'Sq', 'Square'];
const STREET = '(?:' + SUFFIXES.flatMap(x => [x, x.toUpperCase()]).join('|') + ')';
const RULES = [
  // SSN / ITIN (ITINs are 9xx-xx-xxxx, same shape): labelled, dashed, spaced or dotted.
  [/\b(?:ssn|ss#|soc(?:ial)?\.? ?sec(?:urity)?\.?(?: ?(?:number|no\.?|#))?|itin|tax ?id(?:entification)?(?: number)?|tin)\s*[:#]?\s*\d{3}[- .]?\d{2}[- .]?\d{4}\b/gi, '[SSN REDACTED]'],
  [/\b\d{3}[- .]\d{2}[- .]\d{4}\b/g, '[SSN REDACTED]'],
  // EIN: 12-3456789, or labelled 123456789
  [/\b(?:ein|fein|employer id(?:entification)?(?: number)?|federal tax id)\s*[:#]?\s*\d{2}-?\d{7}\b/gi, '[EIN REDACTED]'],
  [/\b\d{2}-\d{7}\b/g, '[EIN REDACTED]'],
  // Dates of birth when labelled (numeric or "January 5, 1980")
  [/\b(?:dob|d\.o\.b\.?|date of birth|birth ?date|birthday|born(?: on)?)\s*[:#-]?\s*(?:\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9} \d{4})/gi, '[DOB REDACTED]'],
  // Routing numbers when labelled
  [/\b(?:routing|aba|rtn)\s*(?:number|no\.?|#)?\s*[:#]?\s*\d{9}\b/gi, '[ROUTING REDACTED]'],
  // Labelled account numbers, including letters (ACCT# AB12345678 → ****5678)
  [/\b(?:account|acct|card|loan)\s*(?:number|no\.?|#)?\s*[:#]\s*([A-Za-z0-9*Xx-]{5,})/gi, (m, n) => m.slice(0, m.length - n.length) + '****' + n.replace(/[^A-Za-z0-9]/g, '').slice(-4)],
  // Emails and US phone numbers
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]'],
  [/(?:\+?1[ .-]?)?(?:\(\d{3}\)\s?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/g, '[PHONE]'],
  // Street addresses (number + street name + suffix). City/state are kept; they aren't identifying alone.
  // Words must be capitalised (as on reports), so "2 weeks on the way" is left alone.
  [new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:[NSEW]\\.?\\s+)?(?:[A-Z0-9][A-Za-z0-9.'-]*\\s+){0,4}${STREET}\\b\\.?(?:,?\\s*(?:#|[Aa]pt\\.?|APT|[Uu]nit|UNIT|[Ss]uite|SUITE|[Ss]te\\.?|STE)\\s*[A-Za-z0-9-]+)?`, 'g'), '[ADDRESS]'],
  [/\b(?:p\.?\s?o\.?\s?box|post office box)\s*\d+\b/gi, '[ADDRESS]']
];

const tail = m => '****' + String(m).replace(/\D/g, '').slice(-4);
/** Card and account numbers → ****1234. ISO dates (2024-01-15) are left alone. */
function maskLongNumbers(s) {
  return s
    .replace(/\b\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,4})?\b/g, tail) // 4111 1111 1111 1111, 3782 822463 10005 is caught below
    .replace(/\b\d{4}[ -]\d{6}[ -]\d{5}\b/g, tail)              // Amex layout
    .replace(/\b[Xx*]{2,}[ -]?[Xx*\d -]*\d{4}\b/g, tail)        // XXXX-XXXX-1234
    .replace(/\b\d{8,19}\b/g, tail);                             // 123456789012, unlabelled 9-digit SSN/routing
}

const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Names of the client/business we already know (scan text), masked wherever they appear. */
export function nameTerms(c) {
  if (!c) return [];
  const b = c.business || {};
  return [c.name, c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : '', c.lastName, ...(c.aka || []), b.legalName, b.dba].filter(t => t && String(t).trim().length >= 3);
}
/** opts.terms: extra exact strings (e.g. the client's name) to mask as [NAME]. */
export function redact(text, opts = {}) {
  let s = String(text == null ? '' : text);
  // Labelled names on a report ("Name: Jordan Sample", "Also known as …") — up to 4 words.
  s = s.replace(/\b((?:consumer |full |your )?name|also known as|aka|formerly known as)(\s*[:#-]\s*)([A-Z][A-Za-z.'-]*(?:[ ,]+[A-Z][A-Za-z.'-]*){0,3})/gi, (m, l, sep) => `${l}${sep}[NAME]`);
  for (const t of (opts.terms || []).slice().sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(`\\b${esc(String(t).trim())}\\b`, 'gi'), '[NAME]');
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  return maskLongNumbers(s);
}

/** Deep-redacts strings in an object. Drops fields that never need to leave the server. */
const DROP = new Set(['ssn', 'ssnLast4', 'ssnLast4s', 'dob', 'dobs', 'ein', 'einLast4', 'itin', 'password', 'email', 'phone', 'address', 'addresses', 'street', 'zip', 'consentRecord', 'ip', 'userAgent', 'routingNumber']);
export function redactObject(v) {
  if (Array.isArray(v)) return v.map(redactObject);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (DROP.has(k)) continue;
      out[k] = /^(accountNumber|cardNumber|acct)$/i.test(k) ? lastFour(x) : redactObject(x);
    }
    return out;
  }
  return typeof v === 'string' ? redact(v) : v;
}

export function lastFour(acct) {
  const d = String(acct || '').replace(/[^A-Za-z0-9]/g, '');
  return d ? '****' + d.slice(-4) : '';
}

/**
 * Redacts the user-controlled parts of a model request: every message's text content and the system
 * prompt text. Binary parts (image/document) are refused: they can't be redacted.
 */
export function redactPayload(p) {
  const out = Object.assign({}, p);
  const part = c => {
    if (typeof c === 'string') return redact(c);
    if (c && c.type === 'text') return Object.assign({}, c, { text: redact(c.text) });
    if (c && (c.type === 'image' || c.type === 'document' || c.type === 'image_url' || c.type === 'file' || c.type === 'input_file')) throw blocked('This file is an image or PDF without readable text, so it can’t be redacted before AI scanning. Nothing was sent. Upload the bureau’s text/HTML version, or enter the tradelines by hand.');
    return c;
  };
  if (Array.isArray(out.messages)) out.messages = out.messages.map(m => Object.assign({}, m, { content: Array.isArray(m.content) ? m.content.map(part) : part(m.content) }));
  if (typeof out.system === 'string') out.system = redact(out.system);
  else if (Array.isArray(out.system)) out.system = out.system.map(part);
  return out;
}

function luhn(d) {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
/** What a final scan finds in a request body. Exposed for tests and the guard. */
export function findSensitive(s) {
  const text = typeof s === 'string' ? s : JSON.stringify(s);
  const hits = [];
  if (/\b\d{3}[- .]\d{2}[- .]\d{4}\b/.test(text) || /\b(?:ssn|social security|itin)\W{0,4}\d{9}\b/i.test(text)) hits.push('SSN/ITIN');
  const re = /\b\d(?:[ -]?\d){12,18}\b/g; let m;
  while ((m = re.exec(text))) { const d = m[0].replace(/\D/g, ''); if (d.length >= 13 && d.length <= 19 && luhn(d)) { hits.push('card number'); break; } }
  return hits;
}
/** Final guard on the exact outbound body. Throws (nothing is sent) if anything still looks sensitive. */
export function assertNoSensitive(payload) {
  const hits = findSensitive(payload);
  if (hits.length) throw blocked(`Blocked before sending to the AI service: the request still contained a possible ${hits.join(' and ')}. Nothing was sent.`);
  return payload;
}
function blocked(msg) { return Object.assign(new Error(msg), { status: 422, privacyBlock: true }); }
