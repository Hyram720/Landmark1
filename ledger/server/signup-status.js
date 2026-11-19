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

function holdReleased(client, signatures) {
  if (!client || (client.kind || 'personal') !== 'personal') return false;
  if (!hasServerSignatures(client, signatures)) return false;
  return !clientServiceOnHold(client, undefined, signatures);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach(key => { out[key] = stableValue(value[key]); });
    return out;
  }
  return value;
}

function fileSnapshot(row) {
  return JSON.stringify(stableValue({
    reportId: row && row.reportId ? String(row.reportId) : '',
    accountId: row && row.accountId ? String(row.accountId) : '',
    items: (row && row.items) || []
  }));
}

function fileChanged(old, row) {
  if (!old) return true;
  return fileSnapshot(old) !== fileSnapshot(row);
}

function indexHeldFiles(reports, reasonFor, tomb) {
  const reportHeld = new Map();
  const accountHeld = new Map();
  (reports || []).forEach(report => {
    if (!report || !report.id) return;
    const reason = reasonFor(report.clientId);
    if (!reason) return;
    if (!reportHeld.has(report.id)) reportHeld.set(report.id, { reason, clientId: report.clientId });
    (report.accounts || []).forEach(acct => {
      if (acct && acct.id && !accountHeld.has(acct.id)) accountHeld.set(acct.id, { reason, clientId: report.clientId, reportId: report.id });
    });
  });
  ((tomb && tomb.reports) || []).forEach(row => {
    if (row && row.id && !reportHeld.has(row.id)) reportHeld.set(row.id, { reason: row.reason || 'This report belonged to a client who is not active for service work and cannot be recreated.', clientId: '' });
  });
  ((tomb && tomb.accounts) || []).forEach(row => {
    if (row && row.id && !accountHeld.has(row.id)) accountHeld.set(row.id, { reason: row.reason || 'This account belonged to a client who is not active for service work and cannot be recreated.', clientId: '' });
  });
  return { reportHeld, accountHeld };
}

function fileCitation(row, files, owners) {
  if (!row || typeof row !== 'object') return '';
  if (row.reportId && files.reportHeld.has(row.reportId)) owners.add(files.reportHeld.get(row.reportId).clientId);
  if (row.accountId && files.accountHeld.has(row.accountId)) owners.add(files.accountHeld.get(row.accountId).clientId);
  let reason = '';
  if (row.reportId && files.reportHeld.has(row.reportId)) reason = files.reportHeld.get(row.reportId).reason;
  if (!reason && row.accountId && files.accountHeld.has(row.accountId)) reason = files.accountHeld.get(row.accountId).reason;
  (row.items || []).forEach(item => {
    const nested = fileCitation(item, files, owners);
    if (!reason && nested) reason = nested;
  });
  return reason;
}

function foreignCitation(row, files) {
  const owners = new Set();
  const reason = fileCitation(row, files, owners);
  if (!reason) return '';
  if (owners.size === 1 && row && owners.has(row.clientId)) return '';
  return reason;
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
    const id = String(row.id);
    const live = ((after && after.clients) || []).find(c => c && c.id === id);
    if (holdReleased(live, signatures)) return;
    if (!heldById.has(id)) heldById.set(id, row.reason || heldReason({ name: row.name || id }));
  });
  return heldById;
}

function clientHoldReason(id, clients, heldById) {
  if (!String(id || '').trim()) return '';
  if (heldById.get(id)) return heldById.get(id);
  if (!(clients || []).some(c => c && c.id === id)) return 'Client ' + id + ' is not in the workspace, so this record stays on hold.';
  return '';
}

function noClientReason() {
  return 'This record needs a client before it can be sent.';
}

function alreadyMailed(row) {
  if (!row) return false;
  if (row.sentAt || row.sentDate) return true;
  return String(row.status || '') === 'sent';
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
  if (!String(dispute.clientId || '').trim()) return noClientReason();
  const files = indexHeldFiles(ws.reports, reasonFor, ws.heldServiceIds);
  const cited = foreignCitation(dispute, files);
  if (cited) return cited;
  const own = reasonFor(dispute.clientId);
  if (own) return own;
  const letter = ((ws.letters) || []).find(row => row && row.id && row.id === dispute.letterId);
  const letterCited = letter && foreignCitation(letter, files);
  if (letterCited) return letterCited;
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
  const bureauResponse = new Set(['outcome', 'respondedAt', 'receivedDate']);
  const keepResponse = (key, old, field) => key === 'disputes' && alreadyMailed(old) && bureauResponse.has(field);
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
      const bare = !String(row.clientId || '').trim();
      const reason = nextReason || (bare ? noClientReason() : '');
      if (!reason) return;
      if (nextReason) push(key, row.id, 'clientId', nextReason);
      let advanced = false;
      fields.forEach(field => {
        if (field === 'clientId' || field === 'letterId' || field === 'disputeId') return;
        if (bare && field === 'text') return;
        if (keepResponse(key, row, field)) return;
        if (row[field] != null && row[field] !== '' && row[field] !== 'draft') {
          push(key, row.id, field, reason);
          advanced = true;
        }
      });
      if (bare && advanced) push(key, row.id, 'clientId', reason);
      return;
    }
    if (!String(row.clientId || '').trim()) {
      fields.forEach(field => {
        if (keepResponse(key, old, field)) return;
        if (valueChanged(old[field], row[field])) push(key, row.id, field, noClientReason());
      });
    }
    if (String(old.clientId || '') !== String(row.clientId || '')) {
      if (prevReason) push(key, row.id, 'clientId', prevReason);
      else if (nextReason) push(key, row.id, 'clientId', nextReason);
    }
    if (prevReason || nextReason) {
      const reason = prevReason || nextReason;
      fields.forEach(field => {
        if (keepResponse(key, old, field)) return;
        if (valueChanged(old[field], row[field])) push(key, row.id, field, reason);
      });
    }
  };
  const priorBag = before && before.heldServiceIds && typeof before.heldServiceIds === 'object' && !Array.isArray(before.heldServiceIds) ? before.heldServiceIds : {};
  const tomb = {
    disputes: (Array.isArray(priorBag.disputes) ? priorBag.disputes : []).filter(row => row && row.id).map(row => ({ id: String(row.id), reason: String(row.reason || '') })),
    letters: (Array.isArray(priorBag.letters) ? priorBag.letters : []).filter(row => row && row.id).map(row => ({ id: String(row.id), reason: String(row.reason || '') })),
    clients: (Array.isArray(priorBag.clients) ? priorBag.clients : []).filter(row => row && row.id).map(row => ({ id: String(row.id), reason: String(row.reason || '') })),
    reports: (Array.isArray(priorBag.reports) ? priorBag.reports : []).filter(row => row && row.id).map(row => ({ id: String(row.id), reason: String(row.reason || '') })),
    accounts: (Array.isArray(priorBag.accounts) ? priorBag.accounts : []).filter(row => row && row.id).map(row => ({ id: String(row.id), reason: String(row.reason || '') }))
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
    const ownedReports = new Set();
    const ownedAccounts = new Set();
    ((before && before.reports) || []).forEach(report => {
      if (!report || report.clientId !== c.id) return;
      if (report.id) ownedReports.add(report.id);
      (report.accounts || []).forEach(acct => { if (acct && acct.id) ownedAccounts.add(acct.id); });
    });
    const citesFile = row => {
      if (!row || row.clientId === c.id) return false;
      return [row].concat(row.items || []).some(node => node && ((node.reportId && ownedReports.has(node.reportId)) || (node.accountId && ownedAccounts.has(node.accountId))));
    };
    const citing = ((after && after.disputes) || []).filter(citesFile).map(row => 'dispute ' + (row.id || ''))
      .concat(((after && after.letters) || []).filter(citesFile).map(row => 'letter ' + (row.id || '')));
    if (citing.length) push('clients', c.id, '', 'Another client cites this file. Remove ' + citing.join(', ') + ' before deleting this client.');
    const reason = heldById.get(c.id);
    if (!reason) return;
    const stillDisputes = ((after && after.disputes) || []).filter(row => row && row.clientId === c.id);
    const stillLetters = ((after && after.letters) || []).filter(row => row && row.clientId === c.id);
    const stillReports = ((after && after.reports) || []).filter(row => row && row.clientId === c.id);
    if (stillDisputes.length || stillLetters.length || stillReports.length) {
      const names = stillDisputes.map(row => 'dispute ' + (row.id || '')).concat(stillLetters.map(row => 'letter ' + (row.id || '')), stillReports.map(row => 'report ' + (row.id || '')));
      push('clients', c.id, '', reason + ' Remove ' + names.join(', ') + ' before deleting this client.');
      stillDisputes.forEach(row => push('disputes', row.id, 'clientId', reason));
      stillLetters.forEach(row => push('letters', row.id, 'clientId', reason));
      stillReports.forEach(row => push('reports', row.id, 'clientId', reason));
      return;
    }
    remember(tomb.clients, c.id, reason);
  });
  const priorReports = (before && before.reports) || [];
  const afterReportIds = idsOf(after && after.reports);
  priorReports.forEach(old => {
    if (!old || !old.id) return;
    const reason = reasonForClient(old.clientId);
    if (!reason) return;
    const kept = ((after && after.reports) || []).find(row => row && row.id === old.id);
    if (!kept) {
      if (!afterReportIds.has(old.id)) remember(tomb.reports, old.id, reason);
      (old.accounts || []).forEach(acct => { if (acct && acct.id) remember(tomb.accounts, acct.id, reason); });
      return;
    }
    const keptAccounts = new Set((kept.accounts || []).filter(acct => acct && acct.id).map(acct => acct.id));
    (old.accounts || []).forEach(acct => {
      if (acct && acct.id && !keptAccounts.has(acct.id)) remember(tomb.accounts, acct.id, reason);
    });
  });
  const signatures = (after && after.signatures) || (before && before.signatures) || [];
  tomb.clients = tomb.clients.filter(row => {
    const live = afterClients.find(c => c && c.id === row.id);
    if (holdReleased(live, signatures)) return false;
    return true;
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
      if (field === 'letterId' || keepResponse('disputes', old, field)) return;
      if (valueChanged(old[field], row[field])) push('disputes', row.id, field, tied);
    });
  });
  ((after && after.letters) || []).forEach(row => {
    if (!row || typeof row !== 'object' || byId(priorLetters, row.id)) return;
    const hit = reused(tomb.letters, row.id);
    if (hit) push('letters', row.id, 'id', hit.reason);
  });
  ((after && after.clients) || []).forEach(c => {
    if (!c || !c.id) return;
    const old = ((before && before.clients) || []).find(row => row && row.id === c.id);
    if (!old || (old.kind || 'personal') === (c.kind || 'personal')) return;
    if (!heldById.get(c.id)) return;
    const hasWork = priorDisputes.concat((after && after.disputes) || []).some(row => row && row.clientId === c.id) || priorLetters.concat((after && after.letters) || []).some(row => row && row.clientId === c.id) || ((before && before.reports) || []).concat((after && after.reports) || []).some(row => row && row.clientId === c.id);
    if (!hasWork) return;
    push('clients', c.id, 'kind', heldById.get(c.id));
  });
  const files = indexHeldFiles(((before && before.reports) || []).concat((after && after.reports) || []), reasonForClient, tomb);
  ((after && after.reports) || []).forEach(report => {
    const old = byId((before && before.reports) || [], report.id);
    if (!old || String(old.clientId || '') === String(report.clientId || '')) return;
    const reason = reasonForClient(old.clientId);
    if (reason) push('reports', report.id, 'clientId', reason);
  });
  const priorAccount = new Map();
  ((before && before.reports) || []).forEach(report => {
    (report.accounts || []).forEach(acct => { if (acct && acct.id) priorAccount.set(acct.id, report); });
  });
  ((after && after.reports) || []).forEach(report => {
    (report.accounts || []).forEach(acct => {
      if (!acct || !acct.id) return;
      const prev = priorAccount.get(acct.id);
      if (!prev || prev.id === report.id) return;
      const reason = reasonForClient(prev.clientId);
      if (reason && String(prev.clientId || '') !== String(report.clientId || '')) push('reports', report.id, 'accounts', reason);
    });
  });
  const blockedDispute = new Map();
  ((after && after.disputes) || []).forEach(row => {
    const reason = foreignCitation(row, files);
    if (!reason || !row || !row.id) return;
    blockedDispute.set(row.id, reason);
    const old = byId(priorDisputes, row.id);
    if (!old || fileChanged(old, row)) push('disputes', row.id, 'items', reason);
    if (!old) {
      disputeSend.forEach(field => {
        if (field === 'letterId') return;
        if (row[field] != null && row[field] !== '' && row[field] !== 'draft') push('disputes', row.id, field, reason);
      });
      return;
    }
    if (valueChanged(old.letterId, row.letterId)) push('disputes', row.id, 'letterId', reason);
    disputeSend.forEach(field => {
      if (field === 'letterId' || keepResponse('disputes', old, field)) return;
      if (valueChanged(old[field], row[field])) push('disputes', row.id, field, reason);
    });
  });
  ((after && after.reports) || []).forEach(report => {
    if (!report || !report.id) return;
    if (!byId(priorReports, report.id)) {
      const hit = reused(tomb.reports, report.id);
      if (hit) push('reports', report.id, 'id', hit.reason);
    }
    (report.accounts || []).forEach(acct => {
      if (!acct || !acct.id || priorAccount.has(acct.id)) return;
      const acctHit = reused(tomb.accounts, acct.id);
      if (acctHit) push('reports', report.id, 'accounts', acctHit.reason);
    });
  });
  ((after && after.letters) || []).forEach(row => {
    if (!row || typeof row !== 'object') return;
    let reason = foreignCitation(row, files);
    if (!reason && row.disputeId && blockedDispute.has(row.disputeId)) reason = blockedDispute.get(row.disputeId);
    if (!reason) {
      const linked = ((after && after.disputes) || []).find(item => item && item.letterId && item.letterId === row.id && blockedDispute.has(item.id));
      if (linked) reason = blockedDispute.get(linked.id);
    }
    if (!reason) return;
    const old = byId(priorLetters, row.id);
    if (old && !fileChanged(old, row) && String(old.disputeId || '') === String(row.disputeId || '')) return;
    if (!old) {
      letterSend.forEach(field => {
        if (row[field] != null && row[field] !== '' && row[field] !== 'draft') push('letters', row.id, field, reason);
      });
      if (!letterSend.some(field => row[field] != null && row[field] !== '' && row[field] !== 'draft')) push('letters', row.id, 'items', reason);
      return;
    }
    push('letters', row.id, 'items', reason);
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
