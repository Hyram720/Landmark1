// Redaction applied to every piece of text before it is sent to an outside AI service.
// Full SSNs, EINs, dates of birth, card/account numbers, routing numbers, emails and phone numbers
// are masked; account numbers keep only their last 4 digits so staff can still tell accounts apart.

const RULES = [
  // SSN / ITIN: 123-45-6789, 123 45 6789, 123456789 next to "SSN"
  [/\b(?:ssn|social security(?: number)?|itin)\s*[:#]?\s*\d{3}[- ]?\d{2}[- ]?\d{4}\b/gi, '[SSN REDACTED]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]'],
  [/\b\d{3} \d{2} \d{4}\b/g, '[SSN REDACTED]'],
  // EIN: 12-3456789
  [/\b\d{2}-\d{7}\b/g, '[EIN REDACTED]'],
  // Dates of birth when labelled
  [/\b(?:dob|d\.o\.b\.|date of birth|birth ?date|born)\s*[:#]?\s*[\d/.-]{6,10}\b/gi, '[DOB REDACTED]'],
  // Emails and US phone numbers
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]'],
  [/(?:\+?1[ .-]?)?\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, '[PHONE]'],
  // Routing numbers when labelled
  [/\b(?:routing|aba)\s*(?:number|no\.?|#)?\s*[:#]?\s*\d{9}\b/gi, '[ROUTING REDACTED]']
];

/** Card and account numbers → ****1234. Dates (2024-01-15) are left alone. */
function maskLongNumbers(s) {
  const tail = m => '****' + m.replace(/\D/g, '').slice(-4);
  return s
    .replace(/\b\d{4}(?:[ -]\d{4}){2,4}\b/g, tail)       // 4111 1111 1111 1234
    .replace(/\b[Xx*]{2,}[ -]?[Xx*\d -]*\d{4}\b/g, tail) // XXXX-XXXX-1234
    .replace(/\b\d{8,19}\b/g, tail);                      // 123456789012
}

export function redact(text) {
  let s = String(text == null ? '' : text);
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  return maskLongNumbers(s);
}

/** Deep-redacts strings in an object (for structured context). Drops fields that never need to leave. */
const DROP = new Set(['ssn', 'ssnLast4', 'dob', 'ein', 'password', 'email', 'phone', 'address', 'zip', 'consentRecord', 'ip', 'userAgent']);
export function redactObject(v) {
  if (Array.isArray(v)) return v.map(redactObject);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (DROP.has(k)) continue;
      out[k] = k === 'accountNumber' ? lastFour(x) : redactObject(x);
    }
    return out;
  }
  return typeof v === 'string' ? redact(v) : v;
}

export function lastFour(acct) {
  const d = String(acct || '').replace(/\D/g, '');
  return d ? '****' + d.slice(-4) : '';
}
