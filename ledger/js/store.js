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
      ['sequences', 'pendingImports', 'automationLog'].forEach(k => { if (ws[k] !== undefined && !Array.isArray(ws[k])) ws[k] = []; });
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
  function adopt(ws) { state = migrate(ws || empty()); }
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
    const deadline = o.contractSignedAt ? Law.croaCancelDeadline(o.contractSignedAt) : null;
    const steps = [
      { key: 'disclosureSignedAt', label: 'Rights disclosure acknowledged (§ 1679c)', done: !!o.disclosureSignedAt, date: o.disclosureSignedAt },
      { key: 'contractSignedAt', label: 'Written contract signed (§ 1679d)', done: !!o.contractSignedAt, date: o.contractSignedAt },
      { key: 'cancelWindow', label: 'Cancellation period ended (§ 1679e)', done: !!deadline && t > deadline && !o.cancelledAt, date: deadline },
      { key: 'idReceived', label: 'Photo ID received', done: !!o.idReceived, date: o.idReceived },
      { key: 'addressProofReceived', label: 'Proof of address received', done: !!o.addressProofReceived, date: o.addressProofReceived },
      { key: 'authorizationAt', label: 'Signed authorization to prepare disputes', done: !!o.authorizationAt, date: o.authorizationAt }
    ];
    const requiredSteps = steps.slice(0, 3);
    const disclosureOrder = !o.disclosureSignedAt || !o.contractSignedAt || o.disclosureSignedAt <= o.contractSignedAt;
    return {
      steps, deadline, cancelled: !!o.cancelledAt, disclosureOrder,
      required, cleared: !required || (requiredSteps.every(s => s.done) && disclosureOrder),
      inWindow: required && !!deadline && t <= deadline && !o.cancelledAt,
      retainUntil: o.disclosureSignedAt ? Law.addDays(o.disclosureSignedAt, 730) : null
    };
  }

  function disputeState(d, onDate) {
    const t = onDate || today();
    if (d.outcome) return d.outcome;
    if (d.status === 'sent' && d.dueAt && t > d.dueAt) return 'overdue';
    return d.status;
  }

  const api = { KEY, uid, now, today, empty, migrate, load, save, replace, adopt, setRemote, get remote() { return remote; }, log, get, croaStatus, disputeState, onChange: fn => listeners.push(fn), get state() { return state; } };
  root.Store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
