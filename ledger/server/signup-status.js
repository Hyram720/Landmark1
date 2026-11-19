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

function valueChanged(before, after) {
  const beforeObject = before && typeof before === 'object';
  const afterObject = after && typeof after === 'object';
  if (beforeObject || afterObject) return JSON.stringify(before == null ? null : before) !== JSON.stringify(after == null ? null : after);
  return String(before == null ? '' : before) !== String(after == null ? '' : after);
}

function heldReason(client) {
  return `${client.name || 'This client'} is not active for service work until the written contract is signed and the 3-business-day cancellation window ends without a cancellation.`;
}

function removedHeldClients(ws) {
  const bag = ws && ws.heldServiceIds;
  if (!bag || typeof bag !== 'object' || Array.isArray(bag) || !Array.isArray(bag.clients)) return [];
  return bag.clients.filter(row => row && row.id);
}

function collectHeld(before, after) {
  const signatures = (after && after.signatures) || (before && before.signatures) || [];
  const heldById = new Map();
  const add = (c) => {
    if (c && c.id && clientServiceOnHold(c, undefined, signatures) && !heldById.has(c.id)) heldById.set(c.id, heldReason(c));
  };
  ((before && before.clients) || []).forEach(add);
  ((after && after.clients) || []).forEach(add);
  removedHeldClients(before).concat(removedHeldClients(after)).forEach(row => {
    if (!heldById.has(row.id)) heldById.set(String(row.id), row.reason || heldReason({ name: row.name || row.id }));
  });
  return heldById;
}

function clientHoldReason(id, clients, heldById) {
  if (!id) return '';
  if (heldById.get(id)) return heldById.get(id);
  if (!(clients || []).some(c => c && c.id === id)) return 'Client ' + id + ' is not in the workspace, so this record stays on hold.';
  return '';
}

function letterHoldReason(letter, priorLetter, disputes, reasonFor) {
  const owner = reasonFor(letter && letter.clientId) || reasonFor(priorLetter && priorLetter.clientId);
  if (owner) return owner;
  const ids = [];
  if (letter && letter.disputeId) ids.push(letter.disputeId);
  if (priorLetter && priorLetter.disputeId) ids.push(priorLetter.disputeId);
  (disputes || []).forEach(row => {
    if (row && row.letterId && ((letter && row.letterId === letter.id) || (priorLetter && row.letterId === priorLetter.id))) ids.push(row.id);
  });
  for (const id of ids) {
    const dispute = (disputes || []).find(row => row && row.id === id);
    const reason = reasonFor(dispute && dispute.clientId);
    if (reason) return reason;
  }
  return '';
}

/** Lob send is blocked when the dispute, its letter, or a dispute tied to that letter is on a held client. */
export function mailingBlocked(ws, dispute) {
  if (!ws || !dispute) return '';
  const heldById = collectHeld(ws, ws);
  const reasonFor = id => clientHoldReason(id, ws.clients || [], heldById);
  const own = reasonFor(dispute.clientId);
  if (own) return own;
  const letter = ((ws.letters) || []).find(row => row && row.id && row.id === dispute.letterId);
  return letterHoldReason(letter, letter, ws.disputes || [], reasonFor);
}

/** New letters or disputes, and any step toward sending, while a personal client is still inside CROA onboarding. */
export function serviceWorkBlocked(before, after) {
  const priorDisputes = (before && before.disputes) || [];
  const priorLetters = (before && before.letters) || [];
  const heldById = collectHeld(before, after);
  const byId = (list, id) => (list || []).find(row => row && row.id && id && row.id === id);
  const disputeSend = ['status', 'sentAt', 'sentDate', 'tracking', 'receivedAt', 'receivedDate', 'outcome', 'respondedAt', 'mail', 'dueAt', 'letterId'];
  const letterSend = ['status', 'approvedAt', 'text', 'sentAt', 'sentDate', 'tracking', 'receivedAt', 'receivedDate', 'disputeId'];
  const refused = [];
  const seen = new Set();
  const push = (key, id, field, reason) => {
    const token = key + '/' + (id || '') + '/' + field;
    if (!reason || seen.has(token)) return;
    seen.add(token);
    refused.push({ key, id: id || '', field, reason });
  };
  const afterClients = (after && after.clients) || [];
  const reasonForClient = id => clientHoldReason(id, afterClients, heldById);
  const allDisputes = priorDisputes.concat((after && after.disputes) || []);
  const letterTiedReason = letter => letterHoldReason(letter, byId(priorLetters, letter && letter.id), allDisputes, reasonForClient);
  const checkRow = (row, priorList, key, fields) => {
    if (!row || typeof row !== 'object') return;
    const old = byId(priorList, row.id);
    const prevReason = reasonForClient(old && old.clientId);
    const nextReason = reasonForClient(row.clientId);
    if (!old) {
      if (nextReason) push(key, row.id, 'clientId', nextReason);
      return;
    }
    if (String(old.clientId || '') !== String(row.clientId || '')) {
      if (prevReason) push(key, row.id, 'clientId', prevReason);
      else if (nextReason) push(key, row.id, 'clientId', nextReason);
    }
    if (prevReason || nextReason) {
      const reason = prevReason || nextReason;
      fields.forEach(field => {
        if (valueChanged(old[field], row[field])) push(key, row.id, field, reason);
      });
    }
  };
  const priorBag = before && before.heldServiceIds && typeof before.heldServiceIds === 'object' && !Array.isArray(before.heldServiceIds) ? before.heldServiceIds : {};
  const tomb = {
    disputes: (Array.isArray(priorBag.disputes) ? priorBag.disputes : []).filter(row => row && row.id).map(row => ({ id: String(row.id), reason: String(row.reason || '') })),
    letters: (Array.isArray(priorBag.letters) ? priorBag.letters : []).filter(row => row && row.id).map(row => ({ id: String(row.id), reason: String(row.reason || '') })),
    clients: (Array.isArray(priorBag.clients) ? priorBag.clients : []).filter(row => row && row.id).map(row => ({ id: String(row.id), reason: String(row.reason || '') }))
  };
  const remember = (list, id, reason) => {
    if (!id || list.some(row => row.id === id)) return;
    list.push({ id: String(id), reason: reason || 'This record belonged to a client who is not active for service work and cannot be recreated.' });
  };
  const idsOf = list => new Set((list || []).filter(row => row && row.id).map(row => row.id));
  const afterDisputeIds = idsOf(after && after.disputes);
  const afterLetterIds = idsOf(after && after.letters);
  priorDisputes.forEach(old => {
    if (!old || !old.id || afterDisputeIds.has(old.id)) return;
    if (heldById.get(old.clientId)) remember(tomb.disputes, old.id, heldById.get(old.clientId));
  });
  priorLetters.forEach(old => {
    if (!old || !old.id || afterLetterIds.has(old.id)) return;
    if (heldById.get(old.clientId)) remember(tomb.letters, old.id, heldById.get(old.clientId));
  });
  const afterIds = new Set(afterClients.filter(c => c && c.id).map(c => c.id));
  ((before && before.clients) || []).forEach(c => {
    if (!c || !c.id || afterIds.has(c.id)) return;
    const reason = heldById.get(c.id);
    if (!reason) return;
    const stillDisputes = ((after && after.disputes) || []).filter(row => row && row.clientId === c.id);
    const stillLetters = ((after && after.letters) || []).filter(row => row && row.clientId === c.id);
    if (stillDisputes.length || stillLetters.length) {
      const names = stillDisputes.map(row => 'dispute ' + (row.id || '')).concat(stillLetters.map(row => 'letter ' + (row.id || '')));
      push('clients', c.id, '', reason + ' Remove ' + names.join(', ') + ' before deleting this client.');
      stillDisputes.forEach(row => push('disputes', row.id, 'clientId', reason));
      stillLetters.forEach(row => push('letters', row.id, 'clientId', reason));
      return;
    }
    remember(tomb.clients, c.id, reason);
  });
  if (after && typeof after === 'object') after.heldServiceIds = tomb;
  const reused = (list, id) => (list || []).find(row => row && row.id === id);
  ((after && after.disputes) || []).forEach(row => {
    checkRow(row, priorDisputes, 'disputes', disputeSend);
    if (!row || typeof row !== 'object') return;
    const old = byId(priorDisputes, row.id);
    if (!old) {
      const hit = reused(tomb.disputes, row.id);
      if (hit) push('disputes', row.id, 'id', hit.reason);
    }
    const letter = byId((after && after.letters) || [], row.letterId) || byId(priorLetters, row.letterId) || (old && (byId((after && after.letters) || [], old.letterId) || byId(priorLetters, old.letterId)));
    const tied = letter && letterTiedReason(letter);
    if (!tied) return;
    if (!old || valueChanged(old.letterId, row.letterId)) push('disputes', row.id, 'letterId', tied);
    if (!old) {
      disputeSend.forEach(field => {
        if (field === 'letterId') return;
        if (row[field] != null && row[field] !== '' && row[field] !== 'draft') push('disputes', row.id, field, tied);
      });
      return;
    }
    disputeSend.forEach(field => {
      if (field === 'letterId') return;
      if (valueChanged(old[field], row[field])) push('disputes', row.id, field, tied);
    });
  });
  ((after && after.letters) || []).forEach(row => {
    if (!row || typeof row !== 'object' || byId(priorLetters, row.id)) return;
    const hit = reused(tomb.letters, row.id);
    if (hit) push('letters', row.id, 'id', hit.reason);
  });
  ((after && after.letters) || []).forEach(row => {
    checkRow(row, priorLetters, 'letters', letterSend);
    const tied = letterTiedReason(row);
    if (!tied) return;
    const old = byId(priorLetters, row.id);
    if (!old) { push('letters', row.id, 'disputeId', tied); return; }
    letterSend.forEach(field => {
      if (valueChanged(old[field], row[field])) push('letters', row.id, field, tied);
    });
  });
  if (!refused.length) return null;
  return { error: refused[0].reason, refused };
}
