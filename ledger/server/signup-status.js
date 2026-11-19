// Self-signup stays pending until the contract is signed, then contract-signed
// until the CROA cancellation window ends. Staff service work waits for active.
// TODO(billing): do not charge from this path. Credit Ledger does not charge a
// client until results show on the client's credit report. Do not import
// ledger/js/billing.js or any payment provider here.
import { cancellationWindow } from './croa-window.js';
import { Store } from './shared.js';

const MOVABLE = new Set(['pending', 'contract-signed', 'contract_signed']);

function asOf(onDate) {
  if (!onDate) return new Date();
  if (onDate instanceof Date) return onDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(onDate))) return new Date(onDate + 'T17:00:00.000Z');
  return new Date(onDate);
}

function signedValue(o) {
  return o.contractSignedAtTs || o.contractSignedAt;
}

/** Disclosure acknowledged, contract signed, and the Eastern cancellation instant has passed. */
export function selfSignupCleared(c, onDate) {
  const o = (c && c.onboarding) || {};
  if (!o.disclosureAcknowledgedAt || !signedValue(o) || o.cancelledAt) return false;
  const now = asOf(onDate);
  const win = cancellationWindow(signedValue(o), now);
  return !win.open;
}

export function applySignupStatus(c, onDate) {
  if (!c || c.signupSource !== 'self') return false;
  if (!MOVABLE.has(c.status)) return false;
  const o = c.onboarding = c.onboarding || {};
  const beforeStatus = c.status;
  const beforeEnd = o.cancellationWindowEndsAtTs || null;
  if (o.cancelledAt) {
    c.status = 'cancelled';
  } else if (!signedValue(o)) {
    if (c.status === 'contract_signed') c.status = 'contract-signed';
  } else {
    const now = asOf(onDate);
    const win = cancellationWindow(signedValue(o), now);
    o.cancellationWindowEndsAtTs = win.deadlineInstant.toISOString();
    o.cancellationWindowEndsAt = win.deadlineDateEt;
    if (o.disclosureAcknowledgedAt && !win.open) c.status = 'active';
    else if (c.status === 'pending' || win.open) c.status = 'contract-signed';
  }
  return c.status !== beforeStatus || (o.cancellationWindowEndsAtTs || null) !== beforeEnd;
}

function hasServerSignatures(c, signatures) {
  const rows = (signatures || []).filter(s => s && c && s.clientId === c.id);
  return rows.some(s => s.doc === 'disclosure') && rows.some(s => s.doc === 'contract');
}

/** Self-signup uses the Eastern instant. Every other personal client is held until both server-written signature rows exist and CROA is cleared. onDate is the moment used for the window. */
export function clientServiceOnHold(c, onDate, signatures) {
  if (!c || c.kind === 'business') return false;
  if (c.signupSource === 'self') return !selfSignupCleared(c, onDate);
  if (!hasServerSignatures(c, signatures)) return true;
  const o = c.onboarding || {};
  if (o.cancelledAt) return true;
  const now = asOf(onDate);
  if (o.cancellationWindowEndsAtTs) {
    const open = now.getTime() <= Date.parse(o.cancellationWindowEndsAtTs);
    const order = !o.disclosureSignedAt || !o.contractSignedAt || String(o.disclosureSignedAt) <= String(o.contractSignedAt);
    const done = !!(o.disclosureSignedAt && o.contractSignedAt && order && !open && !o.cancelledAt);
    return !done;
  }
  const when = typeof onDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : undefined;
  const cs = Store.croaStatus(c, when);
  return !!(cs.required && !cs.cleared);
}

/** New letters or disputes for a personal client who is still inside CROA onboarding. */
export function serviceWorkBlocked(before, after) {
  const priorDisputes = (before && before.disputes) || [];
  const priorLetters = (before && before.letters) || [];
  const signatures = (after && after.signatures) || [];
  for (const c of (after && after.clients) || []) {
    if (!clientServiceOnHold(c, undefined, signatures)) continue;
    const id = c.id;
    const count = (list) => (list || []).filter(d => d && d.clientId === id).length;
    const held = `${c.name || 'This client'} is not active for service work until the written contract is signed and the 3-business-day cancellation window ends without a cancellation.`;
    if (count(after.disputes) > count(priorDisputes)) return held;
    if (count(after.letters) > count(priorLetters)) return held;
  }
  return null;
}
