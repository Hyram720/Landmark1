// Minimal Kit (ConvertKit) hook for marketing signups.
// Form 10172923 is the Credit Report Error Checklist form. Kit's own double
// opt-in sends the confirmation. This module does not keep a subscriber table.
//
// The unmerged Kit client lives on ledger-private (PR #6, branch
// preview/blog-newsletter-2026-11). This repo does not contain that branch
// (staging/newsletter-signup-2026-11-13 is not here). When KIT_API_KEY is
// already set in the process environment, this posts to the same form path
// that client uses. No key is added by this change, and with no key there is
// no HTTP call.

export const KIT_FORM_ID = '10172923';
export const KIT_FORM_PATH = `/v4/forms/${KIT_FORM_ID}/subscribers`;

const calls = [];
let fetchOverride = null;

export function kitCalls() { return calls.slice(); }
export function resetKitCalls() { calls.length = 0; }
export function setKitFetch(fn) { fetchOverride = fn; }

export async function postKitForm({ email, firstName, source } = {}, env = process.env) {
  const record = {
    op: 'subscribe',
    email: String(email || '').trim().toLowerCase(),
    firstName: firstName ? String(firstName).slice(0, 80) : '',
    source: source ? String(source).slice(0, 80) : '',
    formId: KIT_FORM_ID,
    path: KIT_FORM_PATH,
    at: new Date().toISOString(),
    doubleOptIn: 'kit'
  };
  const key = String(env.KIT_API_KEY || '').trim();
  if (!key) {
    record.mode = 'stub';
    calls.push(record);
    console.info(`[kit] stub ${KIT_FORM_PATH} (no HTTP request)`);
    return record;
  }
  const doFetch = fetchOverride || globalThis.fetch;
  const res = await doFetch('https://api.kit.com' + KIT_FORM_PATH, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Kit-Api-Key': key },
    body: JSON.stringify({ email_address: record.email, first_name: record.firstName || undefined })
  });
  record.mode = 'kit';
  record.status = res.status;
  calls.push(record);
  if (res.status < 200 || res.status >= 300) throw new Error(`Kit form post failed (${res.status})`);
  return record;
}

export function noteKitEvent(op, email) {
  const record = { op, email: String(email || '').trim().toLowerCase(), formId: KIT_FORM_ID, path: KIT_FORM_PATH, at: new Date().toISOString(), mode: 'stub' };
  calls.push(record);
  return record;
}
