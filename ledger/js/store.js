/*
 * Workspace state, persistence (localStorage), backup import/export and v1 migration.
 */
(function (root) {
  'use strict';
  const Law = root.Law;
  const KEY = 'ledger-workspace-v2';
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  const now = () => new Date().toISOString();
  const today = () => Law.iso(new Date());

  function empty() {
    return {
      version: 2,
      settings: {
        company: { name: '', address: '', phone: '', email: '', website: '', state: '', bondNumber: '', registration: '' },
        defaultFee: 'A flat fee of $__ per dispute letter prepared and mailed, billed only after the letter is mailed',
        mailTransitDays: 5
      },
      clients: [], reports: [], disputes: [], letters: [], tasks: [], invoices: [], referrals: [], activity: [],
      offers: root.Partners ? root.Partners.seedOffers() : [], partnerReferrals: [], signatures: [], messages: [], documents: [], sequences: []
    };
  }

  const V1_STATUS = { current: '11', paid: '13', closed: '13', late: '71', '30': '71', '60': '78', '90': '80', collection: '93', collections: '93', 'charged off': '97', chargeoff: '97', 'charge-off': '97', repossession: '96', foreclosure: '94' };
  const V1_TYPE = { revolving: 'R', installment: 'I', mortgage: 'M', open: 'O', 'line of credit': 'C' };

  // Older workspaces stored the public homepages for these two offers. Point them at the
  // approved affiliate links unless someone already saved a different affiliate URL.
  const OLD_CREDIT_NOTES = {
    myfreescorenow: 'Common report source for Metro 2 software (“MFSN import”). Listings conflict and some network listings are closed. Ask MFSN about its credit-professional program.',
    smartcredit: 'Listings conflict and one shows the program as closed on a network. Check with SmartCredit directly.'
  };
  const OLD_CREDIT_URL = {
    myfreescorenow: /^https:\/\/www\.myfreescorenow\.com\/?$/i,
    smartcredit: /^https:\/\/www\.smartcredit\.com\/?$/i
  };
  const OLD_CREDIT_JOIN = {
    myfreescorenow: /^https:\/\/www\.myfreescorenow\.com\/?$/i,
    smartcredit: 'https://www.flexoffers.com/affiliate-programs/smartcredit-affiliate-program/'
  };
  function applyLiveCreditLinks(offers) {
    const catalog = (root.Partners && root.Partners.CATALOG) || [];
    (offers || []).forEach(o => {
      const seed = catalog.find(c => c.key === o.key);
      const bare = OLD_CREDIT_URL[o.key];
      if (!seed || !bare || !seed.url) return;
      if (!o.affiliateUrl || bare.test(o.affiliateUrl)) o.affiliateUrl = seed.affiliateUrl || seed.url;
      if (!o.url || bare.test(o.url)) o.url = seed.url;
      const oldJoin = OLD_CREDIT_JOIN[o.key];
      const joinBare = typeof oldJoin === 'string' ? o.joinUrl === oldJoin : oldJoin.test(String(o.joinUrl || ''));
      if (!o.joinUrl || joinBare) o.joinUrl = seed.joinUrl || seed.url;
      if (o.note === OLD_CREDIT_NOTES[o.key]) {
        o.note = seed.note;
        if (seed.program) o.program = seed.program;
        if (seed.status) o.status = seed.status;
        if (seed.network) o.network = seed.network;
        if (seed.subIdParam !== undefined) o.subIdParam = seed.subIdParam;
      }
    });
  }

  /** Accepts a v1 backup (ledger-workspace-backup) or a v2 workspace and returns a v2 workspace. */
  function migrate(data) {
    if (!data || typeof data !== 'object') throw new Error('Not a workspace backup.');
    if (data.version === 2) {
      const base = empty();
      const seed = base.offers;
      const ws = Object.assign(base, data, { settings: Object.assign(base.settings, data.settings || {}) });
      // Add catalog offers introduced after this workspace was created.
      const have = new Set((ws.offers || []).map(o => o.key));
      ws.offers = (ws.offers || []).concat(seed.filter(o => !have.has(o.key)));
      applyLiveCreditLinks(ws.offers);
      // Any list that is missing or damaged (null, object) becomes an empty list so pages and forms never crash on it.
      Object.keys(base).forEach(k => { if (Array.isArray(base[k]) && !Array.isArray(ws[k])) ws[k] = []; });
      ['sequences', 'pendingImports'].forEach(k => { if (ws[k] !== undefined && !Array.isArray(ws[k])) ws[k] = []; });
      if (!ws.settings.company || typeof ws.settings.company !== 'object') ws.settings.company = base.settings.company;
      ws.clients = ws.clients.filter(c => c && typeof c === 'object');
      return ws;
    }
    if (data.version !== 1) throw new Error('Unsupported backup version: ' + data.version);
    const ws = empty();
    ws.clients = (data.clients || []).map(c => {
      const [firstName, ...rest] = String(c.name || '').split(' ');
      return {
        id: c.id || uid(), name: c.name, firstName, lastName: rest.join(' '), kind: c.kind || 'personal',
        email: c.email || '', phone: '', address: c.address || '', city: '', state: '', zip: '', dob: '', ssnLast4: '',
        status: 'active', createdAt: c.createdAt || now(), notes: '', referralId: '', onboarding: {}
      };
    });
    ws.reports = (data.reports || []).map(r => ({
      id: r.id || uid(), clientId: r.clientId, source: r.source || '', bureau: r.bureau, date: r.date, scores: {},
      accounts: (r.accounts || []).map(a => ({
        id: a.id || uid(), creditor: a.creditor, accountNumber: a.accountNumber || '',
        type: V1_TYPE[String(a.type || '').toLowerCase()] || String(a.type || '').toUpperCase().slice(0, 1),
        status: V1_STATUS[String(a.status || '').toLowerCase()] || a.status || '',
        balance: a.balance, limit: a.limit, highCredit: '', pastDue: '', chargeOff: '', opened: '', closed: '', lastPayment: '',
        dofd: '', reportedDate: r.date, ecoa: '1', complianceCode: '', cii: '', paymentHistory: '', originalCreditor: '',
        issue: a.issue || '', evidence: a.evidence || '', consumerDisputed: false
      }))
    }));
    ws.letters = (data.letters || []).map(l => ({
      id: l.id || uid(), clientId: l.clientId, disputeId: null, type: 'cra_611', reportId: l.reportId, accountId: l.accountId,
      status: l.status === 'approved' ? 'approved' : 'draft', text: l.text, createdAt: l.createdAt, approvedAt: l.approvedAt || null
    }));
    // Each v1 letter becomes a round-1 bureau dispute so deadlines can be tracked.
    ws.letters.forEach(l => {
      const rep = ws.reports.find(r => r.id === l.reportId);
      const acct = rep && rep.accounts.find(a => a.id === l.accountId);
      const d = {
        id: uid(), clientId: l.clientId, type: 'cra_611', round: 1, recipient: rep ? rep.bureau : '', status: l.status === 'approved' ? 'ready' : 'draft',
        items: acct ? [{ reportId: rep.id, accountId: acct.id, creditor: acct.creditor, bureau: rep.bureau, discrepancy: acct.issue, evidence: acct.evidence, fields: [] }] : [],
        letterId: l.id, createdAt: l.createdAt, sentAt: null, receivedAt: null, dueAt: null, tracking: '', outcome: null, respondedAt: null, notes: 'Imported from v1 backup'
      };
      l.disputeId = d.id;
      ws.disputes.push(d);
    });
    ws.tasks = (data.tasks || []).map(t => Object.assign({ id: uid(), done: false, createdAt: now() }, t));
    ws.referrals = (data.referrals || []).map(r => Object.assign({ id: uid() }, r));
    ws.activity = (data.activity || []).map(a => ({ id: a.id || uid(), at: a.at, text: a.text, clientId: a.clientId || null }));
    ws.activity.unshift({ id: uid(), at: now(), text: 'Migrated workspace from backup version 1', clientId: null });
    return ws;
  }

  let state;
  let dirty = new Map();
  let bases = {};
  const listeners = [];
  function load() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      state = raw ? migrate(JSON.parse(raw)) : null;
    } catch (e) { state = null; }
    if (!state) state = empty();
    resetBases(state);
    return state;
  }
  // When `remote` is set (server mode) saves go to the API instead of this browser.
  let remote = null;
  function setRemote(r) { remote = r; }
  function save() {
    if (remote) remote.push(state);
    else { try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ } }
    listeners.forEach(fn => fn(state));
  }
  function replace(ws) { state = ws; save(); }
  function stitchRow(old, row) {
    Object.keys(old).forEach(key => { if (!Object.prototype.hasOwnProperty.call(row, key)) delete old[key]; });
    Object.assign(old, row);
    return old;
  }
  function stitchCollections(local, next) {
    Object.keys(next).forEach(key => {
      const rows = next[key];
      if (!Array.isArray(rows)) { local[key] = rows; return; }
      const prevList = Array.isArray(local[key]) ? local[key] : [];
      const prev = new Map(prevList.filter(row => row && row.id).map(row => [row.id, row]));
      local[key] = rows.map(row => (row && row.id && prev.has(row.id) ? stitchRow(prev.get(row.id), row) : row));
    });
    Object.keys(local).forEach(key => { if (!Object.prototype.hasOwnProperty.call(next, key)) delete local[key]; });
  }
  function adopt(ws, opts) {
    const next = migrate(JSON.parse(JSON.stringify(ws || empty())));
    if (!state) state = next;
    else stitchCollections(state, next);
    if (!opts || !opts.keepDirty) resetBases(state);
  }
  function sameJson(a, b) {
    const stable = value => {
      if (Array.isArray(value)) return value.map(stable);
      if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(key => { out[key] = stable(value[key]); });
        return out;
      }
      return value;
    };
    return JSON.stringify(stable(a == null ? null : a)) === JSON.stringify(stable(b == null ? null : b));
  }
  function rowsById(list) {
    const map = new Map();
    (list || []).forEach(row => { if (row && row.id) map.set(row.id, row); });
    return map;
  }
  const INVOICE_OWNED = ['payToken', 'paidAt', 'transId', 'paidVia'];
  const CLIENT_OWNED = ['signupSource'];
  function resetBases(ws) {
    dirty = new Map();
    bases = indexWorkspace(ws);
  }
  function tokenOf(key, id) { return key + '/' + id; }
  function recordId(row, index) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    if (row.id) return String(row.id);
    if (row.key) return 'key:' + row.key;
    if (row.name && !row.id) return 'name:' + row.name;
    return index == null ? null : 'i:' + index;
  }
  function workspaceKeys() {
    const keys = new Set();
    Array.from(arguments).forEach(obj => {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(key => { if (key !== 'version') keys.add(key); });
    });
    return Array.from(keys);
  }
  function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function indexWorkspace(ws) {
    const out = {};
    workspaceKeys(ws || {}).forEach(key => {
      out[key] = new Map();
      const value = ws[key];
      if (Array.isArray(value)) value.forEach((row, i) => { const id = recordId(row, i); if (id) out[key].set(id, JSON.parse(JSON.stringify(row))); });
      else if (isPlainObject(value)) {
        if (key === 'settings') out[key].set('', JSON.parse(JSON.stringify(value)));
        else Object.keys(value).forEach(id => { if (value[id] && typeof value[id] === 'object') out[key].set(id, JSON.parse(JSON.stringify(value[id]))); });
      }
    });
    return out;
  }
  function userShape(key, row) {
    if (row == null) return null;
    const copy = JSON.parse(JSON.stringify(row));
    const owned = key === 'invoices' ? INVOICE_OWNED : key === 'clients' ? CLIENT_OWNED : [];
    owned.forEach(field => delete copy[field]);
    return copy;
  }
  function overlayOwned(key, localRow, remoteRow) {
    if (localRow == null) return null;
    const next = JSON.parse(JSON.stringify(localRow));
    if (!remoteRow || typeof remoteRow !== 'object') return next;
    const owned = key === 'invoices' ? INVOICE_OWNED : key === 'clients' ? CLIENT_OWNED : [];
    owned.forEach(field => {
      if (remoteRow[field] == null || remoteRow[field] === '') delete next[field];
      else next[field] = remoteRow[field];
    });
    return next;
  }
  function readIndexed(idx, key, id) { return idx[key] && idx[key].has(id) ? idx[key].get(id) : null; }
  function baseRow(key, id) { return bases[key] && bases[key].has(id) ? bases[key].get(id) : null; }
  function setBase(key, id, row) {
    if (!bases[key]) bases[key] = new Map();
    if (row == null) bases[key].delete(id);
    else bases[key].set(id, JSON.parse(JSON.stringify(row)));
  }
  function dirtyNow(local) {
    const found = new Map();
    const indexed = indexWorkspace(local);
    const keys = new Set([...Object.keys(bases), ...Object.keys(indexed)]);
    keys.forEach(key => {
      const ids = new Set([...(bases[key] ? bases[key].keys() : []), ...(indexed[key] ? indexed[key].keys() : [])]);
      ids.forEach(id => {
        const left = userShape(key, indexed[key] && indexed[key].has(id) ? indexed[key].get(id) : null);
        const right = userShape(key, baseRow(key, id));
        if (!sameJson(left, right)) found.set(tokenOf(key, id), indexed[key] && indexed[key].has(id) ? indexed[key].get(id) : null);
      });
    });
    return found;
  }
  const LIST_KEYS = new Set(['clients', 'reports', 'disputes', 'letters', 'tasks', 'invoices', 'referrals', 'activity', 'offers', 'partnerReferrals', 'signatures', 'messages', 'documents', 'sequences', 'pendingImports', 'addressBook', 'automations']);
  const MAP_KEYS = new Set(['automationLog', 'violations', 'settings']);
  function listPreferred(key, serverSnap, sentSnap, localSnap) {
    if (MAP_KEYS.has(key)) return false;
    const snaps = [serverSnap, sentSnap, localSnap];
    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      if (!snap || snap[key] == null) continue;
      if (Array.isArray(snap[key])) return true;
    }
    return LIST_KEYS.has(key);
  }
  function writeRow(key, id, row, asList) {
    if (key === 'settings') { state.settings = row || {}; return; }
    if (asList) {
      const list = Array.isArray(state[key]) ? state[key] : (state[key] = []);
      const idx = list.findIndex((item, i) => recordId(item, i) === id);
      if (row == null) { if (idx >= 0) list.splice(idx, 1); return; }
      if (idx >= 0) list[idx] = row;
      else list.push(row);
      return;
    }
    const bag = isPlainObject(state[key]) ? state[key] : (state[key] = {});
    if (row == null) delete bag[id];
    else bag[id] = row;
  }
  function blankValue(value) {
    if (value == null || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      return keys.length === 0 || keys.every(key => blankValue(value[key]));
    }
    return false;
  }
  function changedFields(left, right) {
    const a = left || {};
    const b = right || {};
    const names = new Set(Object.keys(a).concat(Object.keys(b)));
    const out = [];
    names.forEach(field => { if (!sameJson(a[field], b[field])) out.push(field); });
    return out;
  }
  function parseRefused(list) {
    const byToken = new Map();
    (list || []).forEach(item => {
      let token = '';
      let field = '';
      let reason = '';
      if (typeof item === 'string') token = item;
      else if (item && item.key) {
        token = tokenOf(item.key, item.id || '');
        field = item.field || '';
        reason = item.reason || '';
      }
      if (!token) return;
      const cur = byToken.get(token) || { fields: new Set(), reasons: [] };
      if (field) cur.fields.add(field);
      if (reason) cur.reasons.push(reason);
      byToken.set(token, cur);
    });
    return byToken;
  }
  function stageLocal(ws) {
    state = migrate(JSON.parse(JSON.stringify(ws || empty())));
  }
  // Adopt the server copy, then put back every record still dirty since the base we edited from.
  // A refused record is named from the server's structured refusal and is not replayed.
  function applyServerSave(server, sent, options) {
    if (!server) return { requeue: false, conflict: false, dropped: [], refused: [], reverted: [] };
    const opts = options || {};
    const localSnap = JSON.parse(JSON.stringify(state));
    const explicit = Array.isArray(opts.refused);
    const refusedByToken = explicit ? parseRefused(opts.refused) : new Map();
    const pending = dirtyNow(localSnap);
    const serverIdx = indexWorkspace(server);
    const sentIdx = indexWorkspace(sent || {});
    adopt(server, { keepDirty: true });
    const dropped = [];
    const refused = [];
    const reverted = [];
    pending.forEach((localRow, token) => {
      const split = token.indexOf('/');
      const key = token.slice(0, split);
      const id = token.slice(split + 1);
      const remoteRow = readIndexed(serverIdx, key, id);
      const kept = baseRow(key, id);
      const sentRow = readIndexed(sentIdx, key, id);
      const asList = listPreferred(key, server, sent, localSnap);
      const touchedAfterSend = !sameJson(userShape(key, localRow), userShape(key, sentRow));
      const sentThis = !sameJson(userShape(key, sentRow), userShape(key, kept));
      const refusal = refusedByToken.get(token);
      const fallbackRefusal = !explicit && opts.rejected && sentThis;
      const label = recordLabel(key, localRow || sentRow || kept, id);
      if ((refusal && (refusal.fields.size === 0 || !remoteRow)) || fallbackRefusal) {
        refused.push(refusal && refusal.reasons.length ? refusal.reasons.join(' ') : label);
        keepPostSend(key, id, localRow, sentRow, remoteRow, asList, touchedAfterSend);
        setBase(key, id, remoteRow);
        return;
      }
      if (refusal && refusal.fields.size) {
        const out = localRow && typeof localRow === 'object' ? JSON.parse(JSON.stringify(localRow)) : {};
        const remoteUser = userShape(key, remoteRow) || {};
        refusal.fields.forEach(field => {
          if (!Object.prototype.hasOwnProperty.call(remoteUser, field)) delete out[field];
          else out[field] = remoteUser[field];
        });
        const next = overlayOwned(key, out, remoteRow);
        refused.push(refusal.reasons.length ? refusal.reasons.join(' ') : label + ' ' + Array.from(refusal.fields).join(', '));
        if (!sameJson(userShape(key, next), userShape(key, remoteRow))) writeRow(key, id, next, asList);
        setBase(key, id, remoteRow);
        return;
      }
      if (opts.accepted && !touchedAfterSend) {
        const lost = changedFields(userShape(key, sentRow), userShape(key, remoteRow)).filter(field => !blankValue((userShape(key, sentRow) || {})[field]));
        setBase(key, id, remoteRow);
        if (lost.length) reverted.push(label + ' (' + lost.join(', ') + ')');
        return;
      }
      if (opts.accepted && touchedAfterSend) {
        const sentUser = userShape(key, sentRow) || {};
        const localUser = userShape(key, localRow) || {};
        const remoteUser = userShape(key, remoteRow) || {};
        const out = remoteRow && typeof remoteRow === 'object' ? JSON.parse(JSON.stringify(remoteRow)) : {};
        const lost = [];
        new Set(Object.keys(sentUser).concat(Object.keys(localUser), Object.keys(remoteUser))).forEach(field => {
          if (!sameJson(localUser[field], sentUser[field])) {
            if (localUser[field] === undefined) delete out[field];
            else out[field] = localUser[field];
          } else if (!sameJson(sentUser[field], remoteUser[field]) && !blankValue(sentUser[field])) lost.push(field);
        });
        const next = overlayOwned(key, out, remoteRow);
        if (lost.length) reverted.push(label + ' (' + lost.join(', ') + ')');
        if (!sameJson(userShape(key, next), userShape(key, remoteRow))) writeRow(key, id, next, asList);
        setBase(key, id, remoteRow);
        return;
      }
      const merged = mergeFields(key, kept, sentRow, localRow, remoteRow);
      if (merged.conflicts.length) dropped.push(label + ' ' + merged.conflicts.join(', '));
      const next = overlayOwned(key, merged.row, remoteRow);
      if (!sameJson(userShape(key, next), userShape(key, remoteRow))) writeRow(key, id, next, asList);
      setBase(key, id, remoteRow);
    });
    Object.keys(serverIdx).forEach(key => {
      serverIdx[key].forEach((row, id) => { if (!pending.has(tokenOf(key, id))) setBase(key, id, row); });
    });
    const still = dirtyNow(state);
    return { requeue: still.size > 0, conflict: dropped.length > 0, dropped, refused, reverted };
  }
  function keepPostSend(key, id, localRow, sentRow, remoteRow, asList, touchedAfterSend) {
    if (!touchedAfterSend) return;
    const localUser = userShape(key, localRow) || {};
    const sentUser = userShape(key, sentRow) || {};
    const out = remoteRow && typeof remoteRow === 'object' ? JSON.parse(JSON.stringify(remoteRow)) : {};
    Object.keys(localUser).forEach(field => {
      if (!sameJson(localUser[field], sentUser[field])) out[field] = localUser[field];
    });
    const next = overlayOwned(key, out, remoteRow);
    if (!sameJson(userShape(key, next), userShape(key, remoteRow))) writeRow(key, id, next, asList);
  }
  function mergeFields(key, base, sent, local, remote) {
    const b = userShape(key, base) || {};
    const s = userShape(key, sent) || {};
    const l = userShape(key, local) || {};
    const r = userShape(key, remote) || {};
    const out = remote && typeof remote === 'object' ? JSON.parse(JSON.stringify(remote)) : {};
    const conflicts = [];
    new Set(Object.keys(b).concat(Object.keys(s), Object.keys(l), Object.keys(r))).forEach(field => {
      const localChanged = !sameJson(l[field], b[field]);
      const serverChanged = !sameJson(r[field], b[field]) && !sameJson(r[field], s[field]);
      if (localChanged && serverChanged && !sameJson(l[field], r[field])) { conflicts.push(field); return; }
      if (localChanged) {
        if (l[field] === undefined) delete out[field];
        else out[field] = l[field];
      }
    });
    return { row: out, conflicts };
  }
  function recordLabel(key, row, id) {
    const name = row && (row.name || row.title || row.recipient || row.description || row.vendor) || id;
    const label = String(key).replace(/s$/, '') + ' ' + name;
    return id && String(name) !== String(id) ? label + ' (' + id + ')' : label;
  }
  function shouldRedrawAfterSave(env) {
    if (!env) return true;
    if (env.overlay) return false;
    const tag = String(env.activeTag || '').toLowerCase();
    return tag !== 'input' && tag !== 'textarea' && tag !== 'select';
  }
  function logVoidIfSaved(invoiceId, description, clientId) {
    const inv = (state.invoices || []).find(row => row && row.id === invoiceId);
    if (!inv || inv.status !== 'void') return false;
    const text = 'Voided invoice: ' + description;
    if ((state.activity || []).some(row => row && row.text === text && (row.clientId || null) === (clientId || null))) return false;
    log(text, clientId);
    return true;
  }
  function log(text, clientId) { state.activity.unshift({ id: uid(), at: now(), text, clientId: clientId || null }); if (state.activity.length > 2000) state.activity.length = 2000; }

  const get = {
    client: id => state.clients.find(c => c.id === id),
    report: id => state.reports.find(r => r.id === id),
    dispute: id => state.disputes.find(d => d.id === id),
    letter: id => state.letters.find(l => l.id === id),
    reportsFor: cid => state.reports.filter(r => r.clientId === cid).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    disputesFor: cid => state.disputes.filter(d => d.clientId === cid),
    latestByBureau(cid) {
      const out = {};
      get.reportsFor(cid).forEach(r => { if (!out[r.bureau]) out[r.bureau] = r; });
      return Object.values(out);
    }
  };

  /** CROA onboarding status for a client. Services and billing are blocked until `cleared`. */
  function croaStatus(c, onDate) {
    const o = c.onboarding || {};
    const t = onDate || today();
    const required = c.kind !== 'business';
    const deadline = o.cancellationWindowEndsAt || (o.contractSignedAt ? Law.croaCancelDeadline(o.contractSignedAt) : null);
    const instantOpen = o.cancellationWindowEndsAtTs ? Date.now() <= Date.parse(o.cancellationWindowEndsAtTs) : null;
    const steps = [
      { key: 'disclosureSignedAt', label: 'Rights disclosure acknowledged (§ 1679c)', done: !!o.disclosureSignedAt, date: o.disclosureSignedAt },
      { key: 'contractSignedAt', label: 'Written contract signed (§ 1679d)', done: !!o.contractSignedAt, date: o.contractSignedAt },
      { key: 'cancelWindow', label: 'Cancellation period ended (§ 1679e)', done: !!deadline && (instantOpen === null ? t > deadline : !instantOpen) && !o.cancelledAt, date: deadline },
      { key: 'idReceived', label: 'Photo ID received', done: !!o.idReceived, date: o.idReceived },
      { key: 'addressProofReceived', label: 'Proof of address received', done: !!o.addressProofReceived, date: o.addressProofReceived },
      { key: 'authorizationAt', label: 'Signed authorization to prepare disputes', done: !!o.authorizationAt, date: o.authorizationAt }
    ];
    const requiredSteps = steps.slice(0, 3);
    const disclosureOrder = !o.disclosureSignedAt || !o.contractSignedAt || o.disclosureSignedAt <= o.contractSignedAt;
    return {
      steps, deadline, cancelled: !!o.cancelledAt, disclosureOrder,
      required, cleared: !required || (requiredSteps.every(s => s.done) && disclosureOrder),
      inWindow: required && !!deadline && (instantOpen === null ? t <= deadline : instantOpen) && !o.cancelledAt,
      retainUntil: o.disclosureSignedAt ? Law.addDays(o.disclosureSignedAt, 730) : null
    };
  }

  function disputeState(d, onDate) {
    const t = onDate || today();
    if (d.outcome) return d.outcome;
    if (d.status === 'sent' && d.dueAt && t > d.dueAt) return 'overdue';
    return d.status;
  }

  const api = { KEY, uid, now, today, empty, migrate, load, save, replace, adopt, stageLocal, applyServerSave, shouldRedrawAfterSave, logVoidIfSaved, setRemote, get remote() { return remote; }, log, get, croaStatus, disputeState, onChange: fn => listeners.push(fn), get state() { return state; }, get unsaved() { return dirtyNow(state).size > 0; } };
  root.root = root;
  root.Store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
