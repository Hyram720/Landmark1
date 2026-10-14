/* Router, actions and modals. */
(function (root) {
  'use strict';
  const { Store, Metro2, Law, Letters, UI, Views, Sample } = root;
  const { esc, icon, field, modal, toast } = UI;
  const S = () => Store.state;
  const T = () => Store.today();
  const go = h => { if (location.hash === h) render(); else location.hash = h; };
  const commit = (msg, cid) => { if (msg) Store.log(msg, cid); Store.save(); render(); };

  // ---------- router ----------
  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    return { parts, params };
  }
  function render() {
    const { parts, params } = parseHash();
    const [a, b, c] = parts;
    let html, nav = a || 'dashboard';
    try {
      if (!a) html = Views.dashboard(params);
      else if (a === 'clients' && b) html = Views.client(Object.assign({ id: b, tab: c }, params));
      else if (a === 'disputes' && b) html = Views.dispute({ id: b });
      else if (Views[a]) html = Views[a](params);
      else html = Views.dashboard(params);
    } catch (e) {
      console.error(e);
      html = `<div class="callout bad"><b>Something went wrong rendering this page</b>${esc(e.message)}</div>`;
    }
    document.getElementById('view').innerHTML = html;
    document.querySelectorAll('.nav a').forEach(el => el.classList.toggle('active', el.dataset.nav === nav));
    const open = Views.openDisputes().length;
    const al = Views.alerts().filter(x => x.sev === 'high').length;
    setCount('disputes', open);
    setCount('compliance', al, true);
    setCount('clients', S().clients.length);
    document.querySelector('.side').classList.remove('open');
    window.scrollTo(0, 0);
  }
  function setCount(nav, n, alert) {
    const el = document.querySelector(`.nav a[data-nav="${nav}"] .count`);
    if (!el) return;
    el.textContent = n;
    el.style.display = n ? '' : 'none';
    el.classList.toggle('alert', !!alert);
  }

  // ---------- helpers ----------
  const clientOptions = sel => S().clients.map(c => [c.id, c.name]).map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const statusOptions = Object.entries(Metro2.ACCOUNT_STATUS).map(([k, v]) => [k, `${k} — ${v}`]);
  const nextRound = (cid, recipient) => 1 + Math.max(0, ...S().disputes.filter(d => d.clientId === cid && d.recipient === recipient).map(d => d.round));
  function recipientFor(d) {
    const b = Law.BUREAUS[d.recipient];
    return b ? { name: b.name, address: b.address } : { name: d.recipient, address: d.recipientAddress || '' };
  }
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const clean = rows.filter(r => r.some(x => x.trim()));
    if (!clean.length) return [];
    const head = clean[0].map(h => h.trim());
    return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  const TRADELINE_COLS = ['creditor', 'accountNumber', 'type', 'status', 'balance', 'limit', 'highCredit', 'pastDue', 'chargeOff', 'opened', 'closed', 'lastPayment', 'dofd', 'reportedDate', 'ecoa', 'complianceCode', 'cii', 'paymentHistory', 'originalCreditor', 'issue', 'evidence'];
  function tradelineFrom(o) {
    const t = { id: Store.uid(), consumerDisputed: false };
    TRADELINE_COLS.forEach(k => { t[k] = o[k] === undefined ? '' : o[k]; });
    ['balance', 'limit', 'highCredit', 'pastDue', 'chargeOff'].forEach(k => { if (t[k] !== '') t[k] = Number(String(t[k]).replace(/[$,]/g, '')); });
    t.type = String(t.type || '').toUpperCase().slice(0, 1);
    t.status = String(t.status || '').toUpperCase();
    if (!t.ecoa) t.ecoa = '1';
    return t;
  }
  function pickFile(accept, cb) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => cb(String(r.result), f.name); r.readAsText(f); };
    inp.click();
  }

  // ---------- modals ----------
  function clientModal(c) {
    const isNew = !c;
    c = c || { status: 'lead', kind: 'personal' };
    modal({
      title: isNew ? 'New client' : 'Edit client',
      body: `<div class="form-grid">
        ${field('First name', 'firstName', c.firstName, { required: true })}${field('Last name', 'lastName', c.lastName, { required: true })}
        ${field('Email', 'email', c.email, { type: 'email' })}${field('Phone', 'phone', c.phone)}
        ${field('Street address', 'address', c.address, { cls: 'span2' })}
        ${field('City', 'city', c.city)}<div class="form-grid" style="gap:10px">${field('State', 'state', c.state)}${field('ZIP', 'zip', c.zip)}</div>
        ${field('Date of birth', 'dob', c.dob, { type: 'date' })}${field('SSN — last 4 only', 'ssnLast4', c.ssnLast4, { attrs: 'maxlength="4" inputmode="numeric" pattern="\\d{4}"', help: 'Ledger never stores full SSNs' })}
        ${field('Status', 'status', c.status, { type: 'select', options: Object.entries(UI.CSTATE).map(([k, v]) => [k, v[0]]) })}
        ${field('Referred by', 'referralId', c.referralId, { type: 'select', options: [['', '—']].concat(S().referrals.map(r => [r.id, r.name])) })}
        ${field('Notes', 'notes', c.notes, { type: 'textarea', rows: 3, cls: 'span2' })}</div>`,
      foot: `${isNew ? '' : '<button type="button" class="btn danger" data-del style="margin-right:auto">Delete client</button>'}<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>`,
      onOpen: f => { const del = f.querySelector('[data-del]'); if (del) del.onclick = () => { if (confirm(`Delete ${c.name} and all their reports, disputes and invoices?`)) { const id = c.id; ['reports', 'disputes', 'letters', 'tasks', 'invoices'].forEach(k => { S()[k] = S()[k].filter(x => x.clientId !== id); }); S().clients = S().clients.filter(x => x.id !== id); UI.close(); Store.log('Deleted client ' + c.name); Store.save(); go('#/clients'); } }; },
      onSubmit: d => {
        if (!d.firstName || !d.lastName) { toast('Name is required'); return false; }
        if (d.ssnLast4 && !/^\d{4}$/.test(d.ssnLast4)) { toast('Enter only the last 4 digits of the SSN'); return false; }
        Object.assign(c, d, { name: `${d.firstName} ${d.lastName}`.trim() });
        if (isNew) { Object.assign(c, { id: Store.uid(), createdAt: Store.now(), onboarding: {} }); S().clients.push(c); }
        Store.log((isNew ? 'Added ' : 'Updated ') + c.name, c.id);
        Store.save();
        go(`#/clients/${c.id}`);
      }
    });
  }

  function reportModal(cid, r) {
    const isNew = !r;
    r = r || { bureau: 'Experian', date: T(), source: '', scores: {} };
    modal({
      title: isNew ? 'Add credit report' : 'Edit report', wide: isNew,
      body: `<div class="form-grid g4f">
        ${field('Bureau', 'bureau', r.bureau, { type: 'select', options: ['Equifax', 'Experian', 'TransUnion'] })}
        ${field('Report date', 'date', r.date, { type: 'date', required: true })}
        ${field('Source', 'source', r.source, { placeholder: 'e.g. annualcreditreport.com' })}
        ${field('Score (optional)', 'score', (r.scores || {})[r.bureau] || '', { type: 'number' })}</div>
        ${isNew ? `<hr><label class="field"><span>Tradelines (optional CSV)</span><textarea name="csv" rows="7" class="mono" placeholder="${TRADELINE_COLS.join(',')}"></textarea><small>Paste rows with a header line, or leave empty and add tradelines one by one. Status uses Metro 2 codes (11, 13, 71, 93, 97…). Dates as YYYY-MM-DD.</small></label>
        <div class="row" style="margin-top:8px"><button type="button" class="btn sm" data-csvfile>${icon('upload')} Load CSV file</button><button type="button" class="btn sm ghost" data-act="csv-template">${icon('download')} Template</button></div>` : ''}`,
      onOpen: f => { const b = f.querySelector('[data-csvfile]'); if (b) b.onclick = () => pickFile('.csv,text/csv', txt => { f.elements.csv.value = txt; }); },
      onSubmit: d => {
        let accounts = [];
        if (isNew && d.csv) {
          try { accounts = parseCSV(d.csv).map(tradelineFrom).filter(t => t.creditor); } catch (e) { toast('Could not read CSV'); return false; }
        }
        Object.assign(r, { bureau: d.bureau, date: d.date, source: d.source, scores: d.score ? { [d.bureau]: Number(d.score) } : {} });
        if (isNew) { Object.assign(r, { id: Store.uid(), clientId: cid, accounts }); S().reports.push(r); }
        commit(isNew ? `Imported ${r.bureau} report (${accounts.length} tradelines)` : `Updated ${r.bureau} report`, cid);
        if (isNew) go(`#/clients/${cid}/reports`);
      }
    });
  }

  function tradelineModal(reportId, id) {
    const r = Store.get.report(reportId);
    const isNew = !id;
    const t = isNew ? tradelineFrom({ reportedDate: r.date }) : r.accounts.find(a => a.id === id);
    modal({
      title: isNew ? 'Add tradeline' : `${t.creditor} — ${r.bureau}`, wide: true,
      body: `<div class="form-grid g4f">
        ${field('Furnisher / creditor', 'creditor', t.creditor, { required: true, cls: 'span2' })}${field('Account # (masked)', 'accountNumber', t.accountNumber)}${field('Original creditor', 'originalCreditor', t.originalCreditor, { help: 'For collection accounts' })}
        ${field('Portfolio type', 'type', t.type, { type: 'select', options: [['', '—']].concat(Object.entries(Metro2.PORTFOLIO_TYPE)) })}
        ${field('Account status (17A)', 'status', t.status, { type: 'select', options: [['', '—']].concat(statusOptions), cls: 'span2' })}
        ${field('ECOA', 'ecoa', t.ecoa, { type: 'select', options: Object.entries(Metro2.ECOA).map(([k, v]) => [k, k + ' — ' + v]) })}
        ${field('Current balance', 'balance', t.balance, { type: 'number' })}${field('Amount past due', 'pastDue', t.pastDue, { type: 'number' })}${field('Credit limit', 'limit', t.limit, { type: 'number' })}${field('Highest credit', 'highCredit', t.highCredit, { type: 'number' })}
        ${field('Original charge-off', 'chargeOff', t.chargeOff, { type: 'number' })}${field('Date opened', 'opened', t.opened, { type: 'date' })}${field('Date closed', 'closed', t.closed, { type: 'date' })}${field('Last payment', 'lastPayment', t.lastPayment, { type: 'date' })}
        ${field('Date of first delinquency', 'dofd', t.dofd, { type: 'date' })}${field('Date reported', 'reportedDate', t.reportedDate, { type: 'date' })}
        ${field('Compliance condition', 'complianceCode', t.complianceCode, { type: 'select', options: [['', '—']].concat(Object.keys(Metro2.COMPLIANCE_CONDITION).map(k => [k, k])) })}
        ${field('Consumer info indicator', 'cii', t.cii, { type: 'select', options: [['', '—']].concat(Object.entries(Metro2.CONSUMER_INFO_INDICATOR).map(([k, v]) => [k, k + ' — ' + v])) })}
        ${field('Payment history (24 months, newest first)', 'paymentHistory', t.paymentHistory, { cls: 'span2', attrs: 'maxlength="24" class="mono"', help: '0–6 days late buckets, B, D, E, G, H, J, K, L' })}
        <label class="check span2" style="align-self:center"><input type="checkbox" name="consumerDisputed" ${t.consumerDisputed ? 'checked' : ''}> Consumer has disputed this account</label>
        ${field('Consumer-reported issue', 'issue', t.issue, { type: 'textarea', rows: 2, cls: 'span2', help: 'What the consumer says is wrong, in their words' })}
        ${field('Evidence', 'evidence', t.evidence, { type: 'textarea', rows: 2, cls: 'span2', help: 'Statements, payoff letters, receipts' })}</div>`,
      foot: `${isNew ? '' : '<button type="button" class="btn danger" data-del style="margin-right:auto">Remove</button>'}<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>`,
      onOpen: f => { const del = f.querySelector('[data-del]'); if (del) del.onclick = () => { r.accounts = r.accounts.filter(a => a.id !== id); UI.close(); commit(`Removed ${t.creditor} tradeline`, r.clientId); }; },
      onSubmit: d => {
        if (!d.creditor) { toast('Creditor is required'); return false; }
        const upd = tradelineFrom(d);
        upd.id = t.id;
        upd.consumerDisputed = !!d.consumerDisputed;
        if (isNew) r.accounts.push(upd); else Object.assign(t, upd);
        commit(`${isNew ? 'Added' : 'Updated'} tradeline ${d.creditor} (${r.bureau})`, r.clientId);
      }
    });
  }

  function disputesFromAudit(cid) {
    const all = Views.clientFindings(cid);
    const picked = Array.from(document.querySelectorAll('input[name="f"]:checked')).map(el => all[Number(el.value)]).filter(Boolean);
    if (!picked.length) { toast('Select at least one finding'); return; }
    const c = Store.get.client(cid);
    modal({
      title: `Create disputes — ${picked.length} finding(s)`,
      body: `${field('Send to', 'mode', 'bureau', { type: 'select', options: [['bureau', 'Credit bureaus (FCRA § 611) — one letter per bureau'], ['furnisher', 'Furnishers directly (§ 623 / Reg V) — one letter per creditor']] })}
        <div class="callout" style="margin:14px 0">Items past the 7-year period are grouped into a separate obsolete-information request. Discrepancy text is pre-filled from the audit and can be edited on each dispute.</div>
        <label class="check"><input type="checkbox" name="confirmed" required> <span>${esc(c.name)} reviewed each selected item and confirmed it is inaccurate, incomplete or not theirs.</span></label>`,
      foot: '<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create drafts</button>',
      onSubmit: d => {
        if (!d.confirmed) { toast('Client confirmation is required'); return false; }
        const groups = {};
        picked.forEach(f => {
          const targets = d.mode === 'furnisher' && f.code !== 'FCRA-OBSOLETE' ? f.targets.slice(0, 1) : f.targets;
          targets.forEach(t => {
            const type = f.code === 'FCRA-OBSOLETE' ? 'obsolete_605' : d.mode === 'bureau' ? 'cra_611' : 'furnisher_623';
            const recipient = type === 'furnisher_623' ? f.creditor : t.bureau;
            const key = type + '|' + recipient;
            groups[key] = groups[key] || { type, recipient, items: [] };
            groups[key].items.push({ reportId: t.reportId, accountId: t.accountId, creditor: f.creditor, accountNumber: t.accountNumber, bureau: type === 'furnisher_623' ? '' : t.bureau,
              discrepancy: f.code === 'CONSUMER-ASSERTED' && t.issue ? t.issue : t.detail, fields: f.fields || [], requested: f.action, evidence: t.evidence });
          });
        });
        const made = Object.values(groups).map(g => {
          const disp = { id: Store.uid(), clientId: cid, type: g.type, round: nextRound(cid, g.recipient), recipient: g.recipient, recipientAddress: '', status: 'draft', items: g.items, letterId: null, createdAt: Store.now(), sentAt: null, receivedAt: null, dueAt: null, tracking: '', outcome: null, respondedAt: null, notes: '' };
          S().disputes.push(disp);
          return disp;
        });
        Store.log(`Created ${made.length} dispute draft(s) from the Metro 2 audit`, cid);
        Store.save();
        go(made.length === 1 ? `#/disputes/${made[0].id}` : `#/clients/${cid}/disputes`);
      }
    });
  }

  function newDisputeModal(cid, preset) {
    preset = preset || {};
    modal({
      title: preset.title || 'New dispute',
      body: `<div class="form-grid">
        ${field('Client', 'clientId', cid, { type: 'select', options: S().clients.map(c => [c.id, c.name]), cls: 'span2' })}
        ${field('Type', 'type', preset.type || 'cra_611', { type: 'select', options: Object.entries(Law.DISPUTE_TYPES).map(([k, v]) => [k, `${v.label} — ${v.cite}`]), cls: 'span2' })}
        ${field('Recipient', 'recipient', preset.recipient || 'Experian', { help: 'Equifax, Experian, TransUnion — or the furnisher / collector name' })}
        ${field('Recipient address', 'recipientAddress', preset.recipientAddress || '', { type: 'textarea', rows: 2, help: 'Not needed for the three bureaus' })}</div>`,
      foot: '<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create</button>',
      onSubmit: d => {
        if (!d.clientId) { toast('Add a client first'); return false; }
        const disp = { id: Store.uid(), clientId: d.clientId, type: d.type, round: nextRound(d.clientId, d.recipient), recipient: d.recipient, recipientAddress: d.recipientAddress, status: 'draft', items: preset.items || [], letterId: null, createdAt: Store.now(), sentAt: null, receivedAt: null, dueAt: null, tracking: '', outcome: null, respondedAt: null, notes: preset.notes || '' };
        S().disputes.push(disp);
        Store.log(`Created ${Law.DISPUTE_TYPES[d.type].label.toLowerCase()} draft to ${d.recipient}`, d.clientId);
        Store.save();
        go(`#/disputes/${disp.id}`);
      }
    });
  }

  function itemModal(d, i) {
    const isNew = i === undefined || i === '';
    const it = isNew ? { creditor: '', fields: [] } : d.items[Number(i)];
    modal({
      title: isNew ? 'Add disputed item' : 'Edit item',
      body: `<div class="form-grid">${field('Creditor / furnisher', 'creditor', it.creditor, { required: true })}${field('Account # (masked)', 'accountNumber', it.accountNumber)}
        ${field('What is inaccurate — be specific', 'discrepancy', it.discrepancy, { type: 'textarea', rows: 3, cls: 'span2', help: 'e.g. “Reported as 60 days late in March 2024; I paid on time — bank statement enclosed.”' })}
        ${field('Metro 2 fields affected', 'fields', (it.fields || []).join(', '), { cls: 'span2' })}
        ${field('Correction requested', 'requested', it.requested, { cls: 'span2' })}
        ${field('Supporting evidence', 'evidence', it.evidence, { cls: 'span2' })}</div>`,
      foot: `${isNew ? '' : '<button type="button" class="btn danger" data-del style="margin-right:auto">Remove</button>'}<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>`,
      onOpen: f => { const del = f.querySelector('[data-del]'); if (del) del.onclick = () => { d.items.splice(Number(i), 1); UI.close(); commit(); }; },
      onSubmit: x => {
        if (!x.creditor || x.discrepancy.length < 12) { toast('Add the creditor and a specific description'); return false; }
        Object.assign(it, x, { fields: x.fields ? x.fields.split(',').map(s => s.trim()).filter(Boolean) : [] });
        if (isNew) d.items.push(it);
        commit();
      }
    });
  }

  function generateLetter(d) {
    const c = Store.get.client(d.clientId);
    const prior = S().disputes.filter(p => p.clientId === d.clientId && p.recipient === d.recipient && p.round < d.round && p.sentAt).sort((a, b) => b.round - a.round)[0];
    const res = Letters.build(d.type, { client: c, recipient: recipientFor(d), items: d.items, today: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), report: d.items[0] && Store.get.report(d.items[0].reportId), priorSentAt: prior && prior.sentAt });
    if (!res.ok) { toast(res.errors[0]); return; }
    let l = d.letterId && Store.get.letter(d.letterId);
    if (!l) { l = { id: Store.uid(), clientId: d.clientId, disputeId: d.id, type: d.type, status: 'draft', createdAt: Store.now(), approvedAt: null }; S().letters.push(l); d.letterId = l.id; }
    l.text = res.text;
    commit(`Generated ${Law.DISPUTE_TYPES[d.type].label.toLowerCase()} letter to ${d.recipient}`, d.clientId);
  }

  function invoiceModal(cid) {
    const done = cId => S().disputes.filter(d => d.clientId === cId && d.sentAt && !S().invoices.some(i => i.disputeId === d.id && i.status !== 'void'));
    modal({
      title: 'New invoice',
      body: `<div class="form-grid">
        ${field('Client', 'clientId', cid, { type: 'select', options: S().clients.map(c => [c.id, c.name]), cls: 'span2' })}
        <label class="field span2"><span>Completed service</span><select name="disputeId"></select><small>Only mailed disputes not yet invoiced are listed.</small></label>
        ${field('Description', 'description', '', { cls: 'span2' })}
        ${field('Service completed on', 'serviceCompletedAt', '', { type: 'date' })}${field('Amount ($)', 'amount', '', { type: 'number', attrs: 'step="0.01" min="0"' })}</div>`,
      foot: '<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Issue invoice</button>',
      onOpen: f => {
        const fill = () => {
          const list = done(f.elements.clientId.value);
          f.elements.disputeId.innerHTML = '<option value="">Other completed service…</option>' + list.map(d => `<option value="${d.id}">${esc(d.recipient)} · ${esc(Law.DISPUTE_TYPES[d.type].label)} · round ${d.round} · mailed ${d.sentAt}</option>`).join('');
          if (list[0]) { f.elements.disputeId.value = list[0].id; pick(); }
        };
        const pick = () => {
          const d = Store.get.dispute(f.elements.disputeId.value);
          if (d) { f.elements.description.value = `Dispute letter prepared and mailed — ${d.recipient} (round ${d.round})`; f.elements.serviceCompletedAt.value = d.sentAt; }
        };
        f.elements.clientId.onchange = fill;
        f.elements.disputeId.onchange = pick;
        fill();
      },
      onSubmit: d => {
        const c = Store.get.client(d.clientId);
        const cs = Store.croaStatus(c);
        if (!cs.cleared) { toast('Blocked: onboarding and cancellation period are not complete'); return false; }
        if (!d.serviceCompletedAt) { toast('Enter the date the service was completed'); return false; }
        if (d.serviceCompletedAt > T()) { toast('Blocked: you cannot bill for a service not yet performed (§ 1679b(b))'); return false; }
        if (cs.deadline && d.serviceCompletedAt <= cs.deadline) { toast('Blocked: service date falls inside the cancellation period'); return false; }
        if (!(Number(d.amount) > 0) || !d.description) { toast('Add a description and amount'); return false; }
        S().invoices.push({ id: Store.uid(), clientId: d.clientId, description: d.description, amount: Number(d.amount), serviceCompletedAt: d.serviceCompletedAt, disputeId: d.disputeId || null, status: 'issued', issuedAt: T(), paidAt: null });
        commit(`Issued invoice ${UI.money(d.amount)} — ${d.description}`, d.clientId);
      }
    });
  }

  function printClientDoc(kind, cid) {
    const co = S().settings.company;
    const c = cid ? Store.get.client(cid) : { name: '[Client name]', onboarding: {} };
    const cs = cid ? Store.croaStatus(c) : {};
    if (kind === 'disclosure') return UI.printDoc('Consumer Credit File Rights', Law.CROA_DISCLOSURE + `\n\n\nAcknowledgment of receipt\n\nI received this statement before signing any contract.\n\n${c.name}\n\nSignature: ______________________   Date: __________`);
    if (kind === 'contract') return UI.printDoc('Credit services agreement', Law.contractTerms(co, c, S().settings.defaultFee));
    if (kind === 'cancel') { const n = Law.cancellationNotice(co, cs.deadline ? UI.date(cs.deadline) : null); return UI.printDoc('Notice of Cancellation', n + '\n\n\n— — — — — — — — — — duplicate copy — — — — — — — — — —\n\n' + n); }
  }

  function progressReport(cid) {
    const c = Store.get.client(cid);
    const ds = Store.get.disputesFor(cid);
    const lines = [`CREDIT FILE PROGRESS REPORT`, ``, `Client: ${c.name}`, `Prepared: ${UI.date(T())} by ${S().settings.company.name || ''}`, ``, `SCORES`];
    ['Equifax', 'Experian', 'TransUnion'].forEach(b => {
      const rs = Store.get.reportsFor(cid).filter(r => r.scores && r.scores[b]).map(r => ({ d: r.date, v: r.scores[b] })).reverse();
      lines.push(`  ${b.padEnd(11)} ${rs.length ? rs.map(x => `${x.v} (${x.d})`).join(' → ') : '—'}`);
    });
    lines.push('', 'DISPUTES');
    ds.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach(d => {
      lines.push(`  Round ${d.round} · ${d.recipient} · ${Law.DISPUTE_TYPES[d.type].label} · ${UI.DSTATE[Store.disputeState(d)] ? UI.DSTATE[Store.disputeState(d)][0] : Store.disputeState(d)}${d.sentAt ? ' · mailed ' + d.sentAt : ''}${d.dueAt && !d.outcome ? ' · due ' + d.dueAt : ''}`);
      d.items.forEach(it => lines.push(`     – ${it.creditor}: ${it.discrepancy}`));
    });
    const open = Views.clientFindings(cid).filter(f => f.severity === 'high');
    lines.push('', `OPEN HIGH-PRIORITY FINDINGS: ${open.length}`);
    open.forEach(f => lines.push(`  – ${f.creditor} (${f.bureau}): ${f.title}`));
    lines.push('', 'Results are not guaranteed. Accurate, current and verifiable information cannot be removed from a credit report.');
    UI.printDoc('Progress report — ' + c.name, lines.join('\n'));
  }

  // ---------- actions ----------
  const A = {
    'new-client': () => clientModal(),
    'edit-client': el => clientModal(Store.get.client(el.dataset.id)),
    'load-demo': () => { if (S().clients.length && !confirm('Replace the current workspace with demo data?')) return; Store.replace(Sample.build()); toast('Demo workspace loaded'); go('#/'); },
    'reset': () => { if (!confirm('Erase every client, report, dispute and invoice in this browser? Export a backup first.')) return; Store.replace(Store.empty()); go('#/'); },
    'export': () => { UI.download(`ledger-workspace-${T()}.json`, JSON.stringify(S(), null, 2)); Store.log('Exported workspace backup'); Store.save(); },
    'import': () => pickFile('.json,application/json', txt => {
      try {
        const ws = Store.migrate(JSON.parse(txt));
        if (S().clients.length && !confirm(`Replace the current workspace with this backup (${ws.clients.length} clients)?`)) return;
        Store.replace(ws); toast(`Imported ${ws.clients.length} client(s)`); go('#/');
      } catch (e) { toast('Import failed: ' + e.message); }
    }),
    'csv-template': () => UI.download('ledger-tradelines-template.csv', TRADELINE_COLS.join(',') + '\nExample Bank,XXXX1234,R,11,250,1000,800,0,,2018-03-01,,2026-09-01,,2026-09-30,1,,,000000000000000000000000,,,\n', 'text/csv'),
    'import-client-csv': () => pickFile('.csv,text/csv', txt => {
      const rows = parseCSV(txt).filter(r => r.firstName || r.name);
      rows.forEach(r => { const [fn, ...ln] = (r.name || '').split(' '); const first = r.firstName || fn, last = r.lastName || ln.join(' '); S().clients.push({ id: Store.uid(), name: `${first} ${last}`.trim(), firstName: first, lastName: last, kind: 'personal', email: r.email || '', phone: r.phone || '', address: r.address || '', city: r.city || '', state: r.state || '', zip: r.zip || '', dob: '', ssnLast4: '', status: 'lead', createdAt: Store.now(), notes: '', referralId: '', onboarding: {} }); });
      commit(`Imported ${rows.length} lead(s) from CSV`); toast(`Imported ${rows.length} lead(s). Columns: firstName,lastName,email,phone,address,city,state,zip`);
    }),
    'new-task': el => modal({
      title: 'New task',
      body: `<div class="form-grid">${field('Task', 'title', '', { required: true, cls: 'span2' })}${field('Client', 'clientId', el.dataset.client || '', { type: 'select', options: [['', '—']].concat(S().clients.map(c => [c.id, c.name])) })}${field('Due', 'due', Law.addDays(T(), 3), { type: 'date' })}</div>`,
      onSubmit: d => { if (!d.title) return false; S().tasks.push({ id: Store.uid(), title: d.title, clientId: d.clientId || null, due: d.due, done: false, createdAt: Store.now() }); commit('Task added: ' + d.title, d.clientId); }
    }),
    'toggle-task': el => { const t = S().tasks.find(x => x.id === el.dataset.id); t.done = true; commit('Completed task: ' + t.title, t.clientId); },
    'add-report': el => reportModal(el.dataset.id),
    'edit-report': el => { const r = Store.get.report(el.dataset.id); reportModal(r.clientId, r); },
    'delete-report': el => { const r = Store.get.report(el.dataset.id); if (!confirm(`Delete the ${r.bureau} report dated ${r.date}?`)) return; S().reports = S().reports.filter(x => x.id !== r.id); commit(`Deleted ${r.bureau} report`, r.clientId); },
    'edit-tradeline': el => tradelineModal(el.dataset.report, el.dataset.id),
    'disputes-from-audit': el => disputesFromAudit(el.dataset.id),
    'new-dispute': el => newDisputeModal(el.dataset.client || (S().clients[0] || {}).id),
    'delete-dispute': el => { const d = Store.get.dispute(el.dataset.id); if (!confirm('Delete this dispute and its letter?')) return; S().disputes = S().disputes.filter(x => x.id !== d.id); S().letters = S().letters.filter(l => l.disputeId !== d.id); Store.log(`Deleted dispute to ${d.recipient}`, d.clientId); Store.save(); go(`#/clients/${d.clientId}/disputes`); },
    'edit-item': el => itemModal(Store.get.dispute(el.dataset.id), el.dataset.i),
    'edit-recipient': el => { const d = Store.get.dispute(el.dataset.id); modal({ title: 'Recipient', body: `${field('Recipient', 'recipient', d.recipient)}<div style="height:12px"></div>${field('Address (non-bureau recipients)', 'recipientAddress', d.recipientAddress, { type: 'textarea', rows: 3 })}<div style="height:12px"></div>${field('Notes', 'notes', d.notes, { type: 'textarea', rows: 3 })}`, onSubmit: x => { Object.assign(d, x); commit(); } }); },
    'gen-letter': el => { const d = Store.get.dispute(el.dataset.id); const l = d.letterId && Store.get.letter(d.letterId); if (l && l.text && !l.text.startsWith('(Generated') && !confirm('Regenerate and replace any edits to this letter?')) return; generateLetter(d); },
    'print-letter': el => { const l = Store.get.letter(el.dataset.id); UI.printDoc('Dispute letter', l.text); },
    'approve-letter': el => {
      const d = Store.get.dispute(el.dataset.id);
      if (!document.getElementById('confirm-true').checked) { toast('Confirm the client reviewed the letter'); return; }
      const c = Store.get.client(d.clientId);
      if (!Store.croaStatus(c).cleared) { toast('Blocked until onboarding and the cancellation period are complete'); return; }
      const l = Store.get.letter(d.letterId);
      const v = Letters.validate(d.type, d.items);
      if (v.length) { toast(v[0]); return; }
      l.status = 'approved'; l.approvedAt = T(); d.status = 'ready';
      commit(`Letter to ${d.recipient} approved after client review`, d.clientId);
    },
    'unapprove': el => { const d = Store.get.dispute(el.dataset.id); const l = Store.get.letter(d.letterId); l.status = 'draft'; l.approvedAt = null; d.status = 'draft'; commit(); },
    'mark-sent': el => {
      const d = Store.get.dispute(el.dataset.id);
      const transit = Number(S().settings.mailTransitDays) || 5;
      modal({
        title: 'Record mailing',
        body: `<div class="form-grid">${field('Date mailed', 'sentAt', T(), { type: 'date', required: true })}${field('Certified mail tracking #', 'tracking', d.tracking)}${field('Date received (if known)', 'receivedAt', Law.addDays(T(), transit), { type: 'date', help: `Defaults to ${transit} days after mailing; update from the return receipt` })}</div>`,
        onSubmit: x => {
          if (!Store.croaStatus(Store.get.client(d.clientId)).cleared) { toast('Blocked until onboarding clears'); return false; }
          Object.assign(d, { sentAt: x.sentAt, tracking: x.tracking, receivedAt: x.receivedAt || Law.addDays(x.sentAt, transit), status: 'sent' });
          d.dueAt = Law.responseDue(d.type, d.receivedAt);
          const l = Store.get.letter(d.letterId); if (l) { l.status = 'sent'; l.sentAt = x.sentAt; }
          d.items.forEach(it => { const r = Store.get.report(it.reportId); const a = r && r.accounts.find(t => t.id === it.accountId); if (a) a.consumerDisputed = true; });
          if (d.dueAt) S().tasks.push({ id: Store.uid(), clientId: d.clientId, title: `Check ${d.recipient} response (round ${d.round})`, due: d.dueAt, done: false, createdAt: Store.now() });
          commit(`Round ${d.round} mailed to ${d.recipient}${d.dueAt ? ' — response due ' + d.dueAt : ''}`, d.clientId);
        }
      });
    },
    'mark-received': el => { const d = Store.get.dispute(el.dataset.id); modal({ title: 'Date received by recipient', body: field('Received on', 'receivedAt', d.receivedAt, { type: 'date', help: 'From the certified mail return receipt' }), onSubmit: x => { d.receivedAt = x.receivedAt; d.dueAt = Law.responseDue(d.type, x.receivedAt); commit(`${d.recipient} received dispute on ${x.receivedAt}`, d.clientId); } }); },
    'record-response': el => {
      const d = Store.get.dispute(el.dataset.id);
      modal({
        title: `Response from ${d.recipient}`,
        body: `<div class="form-grid">${field('Outcome', 'outcome', '', { type: 'select', options: [['deleted', 'Deleted'], ['corrected', 'Corrected / updated'], ['verified', 'Verified as accurate'], ['frivolous', 'Frivolous / irrelevant notice'], ['no_response', 'No response by deadline'], ['blocked', 'Blocked (identity theft)'], ['validated', 'Debt validated'], ['closed', 'Closed — other']] })}${field('Date of response', 'respondedAt', T(), { type: 'date' })}${field('Notes', 'notes', d.notes, { type: 'textarea', rows: 3, cls: 'span2' })}</div>`,
        onSubmit: x => { Object.assign(d, { outcome: x.outcome, respondedAt: x.respondedAt, notes: x.notes }); commit(`${d.recipient} response recorded: ${UI.DSTATE[x.outcome][0]}`, d.clientId); }
      });
    },
    'next-round': el => {
      const d = Store.get.dispute(el.dataset.id);
      const items = d.items.map(it => Object.assign({}, it));
      const type = d.outcome === 'verified' && d.type === 'cra_611' ? 'mov_611a7' : d.type;
      newDisputeModal(d.clientId, { title: `Round ${d.round + 1} follow-up`, type, recipient: d.recipient, recipientAddress: d.recipientAddress, items, notes: `Follow-up to round ${d.round} (${d.outcome}).` });
    },
    'letter-edit': () => {},
    'new-invoice': el => invoiceModal(el.dataset.client || (S().clients[0] || {}).id),
    'invoice-paid': el => { const i = S().invoices.find(x => x.id === el.dataset.id); i.status = 'paid'; i.paidAt = T(); commit(`Payment received ${UI.money(i.amount)}`, i.clientId); },
    'invoice-void': el => { const i = S().invoices.find(x => x.id === el.dataset.id); if (!confirm('Void this invoice?')) return; i.status = 'void'; commit('Voided invoice: ' + i.description, i.clientId); },
    'invoice-print': el => { const i = S().invoices.find(x => x.id === el.dataset.id); const c = Store.get.client(i.clientId); const co = S().settings.company; UI.printDoc('Invoice', `${co.name}\n${co.address}\n\nINVOICE\n\nBill to: ${c.name}\n${c.address || ''}\n\nIssued: ${i.issuedAt}\nService completed: ${i.serviceCompletedAt}\n\n${i.description}\n\nAmount: ${UI.money(i.amount)}\nStatus: ${i.status}\n\nThis invoice is for services already performed. No fees are charged in advance of services (15 U.S.C. § 1679b(b)).`); },
    'export-invoices': () => UI.download(`ledger-invoices-${T()}.csv`, 'client,description,serviceCompletedAt,issuedAt,status,amount,paidAt\n' + S().invoices.map(i => [Store.get.client(i.clientId) ? Store.get.client(i.clientId).name : '', i.description, i.serviceCompletedAt, i.issuedAt, i.status, i.amount, i.paidAt || ''].map(v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv'),
    'print-doc': el => printClientDoc(el.dataset.doc, el.dataset.id),
    'progress-report': el => progressReport(el.dataset.id),
    'lint': () => {
      const res = Law.lintText(document.getElementById('lint-in').value);
      document.getElementById('lint-out').innerHTML = res.length ? `<div class="callout warn"><b>${res.length} issue(s)</b>${res.map(r => `“${esc(r.phrase)}” — ${esc(r.why)}`).join('<br>')}</div>` : `<div class="callout good"><b>No flagged phrases</b>Still review for accuracy — software cannot judge whether a statement is true.</div>`;
    },
    'new-referral': () => referralModal(),
    'edit-referral': el => referralModal(S().referrals.find(r => r.id === el.dataset.id))
  };

  function referralModal(r) {
    const isNew = !r;
    r = r || {};
    modal({
      title: isNew ? 'New referral partner' : 'Edit partner',
      body: `<div class="form-grid">${field('Name', 'name', r.name, { required: true })}${field('Email', 'email', r.email)}${field('Company', 'company', r.company)}${field('Commission terms', 'commission', r.commission)}</div><p class="small muted" style="margin-top:12px">Paying for referrals can trigger RESPA (mortgage) and state-law issues. Confirm with counsel.</p>`,
      onSubmit: d => { if (!d.name) return false; Object.assign(r, d); if (isNew) { r.id = Store.uid(); r.createdAt = T(); S().referrals.push(r); } commit((isNew ? 'Added' : 'Updated') + ' referral partner ' + d.name); }
    });
  }

  // ---------- wiring ----------
  function wire() {
    document.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act && act.tagName !== 'SELECT' && act.tagName !== 'TEXTAREA' && A[act.dataset.act]) {
        if (act.tagName === 'INPUT' && act.type === 'checkbox') { A[act.dataset.act](act, e); return; }
        e.preventDefault(); A[act.dataset.act](act, e); return;
      }
      const row = e.target.closest('[data-href]');
      if (row && !e.target.closest('a,button,input')) go(row.dataset.href);
    });
    document.addEventListener('change', e => {
      if (e.target.matches('[data-act="filter-client"]')) go('#/disputes' + (e.target.value ? '?client=' + e.target.value : ''));
    });
    let timer;
    document.addEventListener('input', e => {
      if (e.target.matches('[data-act="letter-edit"]')) {
        const l = Store.get.letter(e.target.dataset.id);
        l.text = e.target.value;
        clearTimeout(timer);
        timer = setTimeout(() => Store.save(), 400);
      }
    });
    document.addEventListener('submit', e => {
      const f = e.target.closest('[data-form]');
      if (!f) return;
      e.preventDefault();
      const d = UI.formData(f);
      if (f.dataset.form === 'onboarding') {
        const c = Store.get.client(f.dataset.id);
        c.onboarding = Object.assign(c.onboarding || {}, d);
        if (d.contractSignedAt && c.status === 'lead') c.status = 'onboarding';
        const cs = Store.croaStatus(c);
        if (cs.cleared && c.status === 'onboarding') c.status = 'active';
        if (d.cancelledAt) c.status = 'cancelled';
        commit('Updated agreement record', c.id);
        toast('Saved');
      }
      if (f.dataset.form === 'company') {
        const { defaultFee, mailTransitDays, ...co } = d;
        S().settings.company = co;
        S().settings.defaultFee = defaultFee;
        S().settings.mailTransitDays = Number(mailTransitDays) || 5;
        commit('Updated company settings');
        toast('Saved');
      }
    });

    // search
    const input = document.getElementById('search');
    const box = document.getElementById('search-results');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.hidden = true; return; }
      const hits = S().clients.filter(c => [c.name, c.email, c.phone].join(' ').toLowerCase().includes(q)).slice(0, 6);
      box.innerHTML = hits.length ? hits.map(c => `<a href="#/clients/${c.id}">${esc(c.name)} <span class="muted small">${esc(c.email || '')}</span></a>`).join('') : '<div class="small muted" style="padding:10px 12px">No matches</div>';
      box.hidden = false;
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { const a = box.querySelector('a'); if (a) { location.hash = a.getAttribute('href'); input.value = ''; box.hidden = true; } } if (e.key === 'Escape') { box.hidden = true; input.blur(); } });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) box.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === '/' && !e.target.closest('input,textarea,select')) { e.preventDefault(); input.focus(); } if (e.key === 'Escape') UI.close(); });

    document.getElementById('menu').onclick = () => document.querySelector('.side').classList.toggle('open');
    const themeBtn = document.getElementById('theme');
    themeBtn.onclick = () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('ledger-theme', next); } catch (err) { /* ignore */ }
    };
    window.addEventListener('hashchange', render);
  }

  function boot() {
    try { const th = localStorage.getItem('ledger-theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* ignore */ }
    Store.load();
    wire();
    render();
  }
  root.App = { boot, render, A };
  document.addEventListener('DOMContentLoaded', boot);
})(window);
