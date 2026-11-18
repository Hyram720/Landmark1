// Self-signup stays pending until the contract is signed, then contract-signed
// until the CROA cancellation window ends. Staff service work waits for active.
// TODO(billing): do not charge from this path. Credit Ledger does not charge a
// client until results show on the client's credit report. Do not import
// ledger/js/billing.js or any payment provider here.
import { Law, Store } from './shared.js';

export function applySignupStatus(c, onDate) {
  if (!c || c.signupSource !== 'self') return false;
  const o = c.onboarding = c.onboarding || {};
  const beforeStatus = c.status;
  const beforeEnd = o.cancellationWindowEndsAt || null;
  if (o.cancelledAt) {
    c.status = 'cancelled';
  } else if (!o.contractSignedAt) {
    c.status = 'pending';
  } else {
    const deadline = Law.croaCancelDeadline(o.contractSignedAt);
    o.cancellationWindowEndsAt = deadline;
    const cs = Store.croaStatus(c, onDate);
    c.status = cs.cleared && !cs.cancelled ? 'active' : 'contract-signed';
  }
  return c.status !== beforeStatus || (o.cancellationWindowEndsAt || null) !== beforeEnd;
}

/** New disputes for a self-signup client who is not active yet. */
export function serviceWorkBlocked(before, after) {
  const priorDisputes = (before && before.disputes) || [];
  for (const c of (after && after.clients) || []) {
    if (c.signupSource !== 'self') continue;
    const o = c.onboarding || {};
    if (o.cancelledAt) continue;
    const cs = Store.croaStatus(c);
    if (cs.cleared && !cs.cancelled) continue;
    const id = c.id;
    const count = list => (list || []).filter(d => d && d.clientId === id).length;
    if (count(after.disputes) > count(priorDisputes)) {
      return `${c.name || 'This client'} is not active for service work until the written contract is signed and the 3-business-day cancellation window ends without a cancellation.`;
    }
  }
  return null;
}
