// Print-and-mail through Lob (lob.com): first-class or certified letters with USPS tracking.
// Test keys (test_…) create letters that are never printed; live keys (live_…) mail for real.
const LOB = 'https://api.lob.com/v1';

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
