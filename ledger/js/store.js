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
  const listeners = [];
  function load() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      state = raw ? migrate(JSON.parse(raw)) : null;
    } catch (e) { state = null; }
    if (!state) state = empty();
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
  function adopt(ws) {
    const next = migrate(JSON.parse(JSON.stringify(ws || empty())));
    if (!state) { state = next; return; }
    stitchCollections(state, next);
  }
  function ownedValue(row, key) {
    if (!row || row[key] == null || row[key] === '') return '';
    return JSON.stringify(row[key]);
  }
  // Keep invoice fields the server decided when this browser did not edit them after the send.
  function applyServerSave(server, sent) {
    if (!server) return false;
    if (JSON.stringify(state) === JSON.stringify(sent)) { adopt(server); return false; }
    const sentRows = new Map(((sent && sent.invoices) || []).filter(row => row && row.id).map(row => [row.id, row]));
    const serverRows = new Map(((server && server.invoices) || []).filter(row => row && row.id).map(row => [row.id, row]));
    (state.invoices || []).forEach(inv => {
      const prior = sentRows.get(inv.id);
      const remote = serverRows.get(inv.id);
      if (!prior || !remote) return;
      ['payToken', 'paidAt', 'transId', 'paidVia', 'status'].forEach(key => {
        if (ownedValue(inv, key) !== ownedValue(prior, key)) return;
        if (remote[key] == null || remote[key] === '') delete inv[key];
        else inv[key] = remote[key];
      });
    });
    return true;
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

  /** True when a dispute result must stay a record: the client is missing, or still on hold. */
  function serviceHold(ws, clientId) {
    const c = ((ws && ws.clients) || []).find(x => x && x.id === clientId);
    if (!c) return true;
    if (c.kind === 'business') return false;
    if (!croaStatus(c).cleared) return true;
    if (!remote) return false;
    const sigs = (ws && ws.signatures) || [];
    const has = doc => sigs.some(s => s && s.clientId === c.id && s.doc === doc);
    return !(has('disclosure') && has('contract'));
  }

  function disputeState(d, onDate) {
    const t = onDate || today();
    if (d.outcome) return d.outcome;
    if (d.status === 'sent' && d.dueAt && t > d.dueAt) return 'overdue';
    return d.status;
  }

  const api = { KEY, uid, now, today, empty, migrate, load, save, replace, adopt, applyServerSave, shouldRedrawAfterSave, logVoidIfSaved, setRemote, get remote() { return remote; }, log, get, croaStatus, serviceHold, disputeState, onChange: fn => listeners.push(fn), get state() { return state; } };
  root.root = root;
  root.Store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
