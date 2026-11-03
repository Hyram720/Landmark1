// Print-and-mail through Lob (lob.com): first-class or certified letters with USPS tracking.
// Test keys (test_…) create letters that are never printed; live keys (live_…) mail for real.
import crypto from 'node:crypto';

const LOB = 'https://api.lob.com/v1';

// Lob signs webhooks as HMAC-SHA256(secret, "<Lob-Signature-Timestamp>.<raw body>"), hex-encoded.
// https://help.lob.com/print-and-mail/getting-data-and-results/using-webhooks
// Reject timestamps outside this window so a captured notification cannot be replayed.
export const LOB_WEBHOOK_MAX_AGE_SEC = 5 * 60;
export const LOB_WEBHOOK_PATH = '/api/webhooks/lob';

/** 'ok' or a reason: 'missing' | 'bad' | 'stale'. Never throws. */
export function verifyLobWebhook({ secret, timestamp, signature, rawBody, nowMs = Date.now() } = {}) {
  if (!secret || timestamp === undefined || timestamp === null || String(timestamp) === '' || !signature) return { ok: false, reason: 'missing' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing' };
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const expected = crypto.createHmac('sha256', String(secret)).update(String(timestamp)).update('.').update(body).digest('hex');
  const got = Buffer.from(String(signature).trim().toLowerCase());
  const exp = Buffer.from(expected);
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return { ok: false, reason: 'bad' };
  if (Math.abs(nowMs / 1000 - ts) > LOB_WEBHOOK_MAX_AGE_SEC) return { ok: false, reason: 'stale' };
  return { ok: true };
}

// Names Lob puts on letter tracking webhooks, including certified mail.
const LETTER_EVENT_NAMES = {
  'letter.mailed': 'Mailed',
  'letter.in_transit': 'In Transit',
  'letter.in_local_area': 'In Local Area',
  'letter.processed_for_delivery': 'Processed for Delivery',
  'letter.delivered': 'Delivered',
  'letter.re-routed': 'Re-Routed',
  'letter.returned_to_sender': 'Returned to Sender',
  'letter.certified.mailed': 'Mailed',
  'letter.certified.in_transit': 'In Transit',
  'letter.certified.in_local_area': 'In Local Area',
  'letter.certified.processed_for_delivery': 'Processed for Delivery',
  'letter.certified.delivered': 'Delivered',
  'letter.certified.re-routed': 'Re-Routed',
  'letter.certified.returned_to_sender': 'Returned to Sender',
  'letter.certified.pickup_available': 'Pickup Available',
  'letter.certified.issue': 'Issue'
};

export function letterEventName(typeId) { return LETTER_EVENT_NAMES[String(typeId || '')] || ''; }

export function isReturnedLetterEvent(typeId) { return /returned_to_sender/.test(String(typeId || '')); }

/** "line1\n[line2\n]City, ST 12345" → Lob address object. Returns null if it can't be parsed. */
export function parseAddress(name, text) {
  const lines = String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const last = lines[lines.length - 1];
  const m = last.match(/^(.+?),?\s+([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/);
  if (!m) return null;
  const street = lines.slice(0, -1).filter(l => !/^attn[:\s]/i.test(l));
  const attn = lines.slice(0, -1).find(l => /^attn[:\s]/i.test(l));
  if (!street.length) return null;
  const out = { name: String(name || '').slice(0, 40), address_line1: street[0].slice(0, 64), address_city: m[1].trim(), address_state: m[2].toUpperCase(), address_zip: m[3], address_country: 'US' };
  const line2 = [street.slice(1).join(' '), attn].filter(Boolean).join(' ');
  if (line2) out.address_line2 = line2.slice(0, 64);
  return out;
}

function auth(key) { return 'Basic ' + Buffer.from(key + ':').toString('base64'); }

async function lob(key, method, path, body) {
  const r = await fetch(LOB + path, { method, headers: Object.assign({ Authorization: auth(key) }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((data.error && data.error.message) || `Lob error ${r.status}`); e.status = r.status; throw e; }
  return data;
}

/** 'ok' | 'invalid' | 'unknown' */
export async function checkLobKey(key) {
  try { await lob(key, 'GET', '/letters?limit=1'); return 'ok'; } catch (e) { return e.status === 401 || e.status === 403 ? 'invalid' : 'unknown'; }
}

/**
 * Mail a letter. `file` is an HTML string (≤ 10,000 characters) or an https URL to an HTML/PDF document.
 * extraService: 'certified' | 'certified_return_receipt' | null.
 */
export async function sendLetter({ key, to, from, file, extraService, description, metadata }) {
  const body = {
    description: String(description || 'Dispute letter').slice(0, 255), to, from, file,
    color: false, double_sided: false, address_placement: 'insert_blank_page', use_type: 'operational',
    metadata: metadata || {}
  };
  if (extraService) body.extra_service = extraService;
  return lob(key, 'POST', '/letters', body);
}

export async function getLetter(key, id) { return lob(key, 'GET', '/letters/' + encodeURIComponent(id)); }
