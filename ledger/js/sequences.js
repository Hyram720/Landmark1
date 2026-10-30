/*
 * Dispute sequences: run the Letter 1 → 2 → 3 → attorney-review strategy automatically.
 * Each letter in a sequence is an ordinary dispute (seqId, parentId). When a letter is answered
 * "verified" (or the response deadline passes with no answer), the next letter for that recipient
 * is drafted; a deletion or correction ends that branch. Pure logic — the app creates the records.
 */
(function (root) {
  'use strict';
  const Law = root.Law;

  const RESOLVED = ['deleted', 'corrected', 'blocked', 'closed'];
  const TERMINAL = ['cfpb_complaint'];
  const MAX_DEPTH = 5;
  const MAIL_BACK_DAYS = 5;

  // What follows each letter type for the same recipient.
  const NEXT = {
    cra_611: 'mov_611a7', obsolete_605: 'mov_611a7', public_record_611: 'mov_611a7', tenant_screening_611: 'mov_611a7', inquiry_604: 'mov_611a7', pii_611: null, au_removal: null, reinsertion_611: 'mov_611a7',
    disclosure_609: null, mov_611a7: 'cfpb_complaint',
    furnisher_623: 'furnisher_final', student_loan_623: 'furnisher_final', furnisher_final: 'cfpb_complaint',
    validation_809: 'furnisher_final', business_correction: null, goodwill: null
  };

  const PLAN = [
    { n: 1, title: 'Letter 1 — Dispute', text: 'Bureau, agency, servicer or collector dispute (the template you chose). Waits for the response or the legal deadline (30 days after receipt, plus mail time).' },
    { n: 2, title: 'Letter 2 — Method of verification + direct dispute', text: 'To each recipient that verified or did not answer: method-of-verification request (bureaus and agencies) or final notice (servicer / collector). Also a direct dispute to the furnisher, if you entered one.' },
    { n: 3, title: 'Letter 3 — Final notice + CFPB complaint', text: 'Final notice to the furnisher and a CFPB complaint narrative for the client to review and file.' },
    { n: 4, title: 'Step 4 — Attorney review', text: 'If the documented error is still reported, Ledger creates a task to refer the client to a consumer attorney (FCRA §§ 616–617).' }
  ];

  const isBureau = name => !!Law.BUREAUS[name];
  const seqDisputes = (ws, seq) => ws.disputes.filter(d => d.seqId === seq.id);
  const stepOf = (ws, d) => { let n = 1, p = d; while (p && p.parentId) { p = ws.disputes.find(x => x.id === p.parentId); n++; } return n; };
  /** Date when a mailed letter with no recorded outcome counts as "no response". */
  function waitUntil(d) {
    if (!d.sentAt) return null;
    return d.dueAt ? Law.addDays(d.dueAt, MAIL_BACK_DAYS) : Law.addDays(d.sentAt, 35 + MAIL_BACK_DAYS);
  }

  /** Where each branch of the sequence stands. */
  function branches(ws, seq, today) {
    const all = seqDisputes(ws, seq);
    const leaves = all.filter(d => !all.some(c => c.parentId === d.id));
    return leaves.map(d => {
      const step = stepOf(ws, d);
      if (d.withdrawnAt) return { d, step, state: 'withdrawn' };
      if (RESOLVED.includes(d.outcome)) return { d, step, state: 'won' };
      if (!d.sentAt) return { d, step, state: 'to_mail' };
      const answered = !!d.outcome;
      const until = waitUntil(d);
      const ready = answered || (until && today >= until);
      const terminal = TERMINAL.includes(d.type) || !NEXT[d.type] || step >= MAX_DEPTH;
      if (!ready) return { d, step, state: 'waiting', until };
      return { d, step, state: terminal ? 'exhausted' : 'due' };
    });
  }

  /** Overall status: active | due | won | attorney | stopped. */
  function status(ws, seq, today) {
    if (seq.status === 'stopped') return { state: 'stopped', label: 'Stopped', branches: [] };
    const br = branches(ws, seq, today);
    const due = br.filter(b => b.state === 'due');
    const open = br.filter(b => ['to_mail', 'waiting', 'due'].includes(b.state));
    const step = Math.max(1, ...br.map(b => b.step));
    if (!open.length) {
      if (br.some(b => b.state === 'exhausted')) return { state: 'attorney', label: 'Attorney review', step: 4, branches: br };
      return { state: 'won', label: 'Completed — items removed or corrected', step, branches: br };
    }
    if (due.length) return { state: 'due', label: `Letter ${step + 1} ready to draft`, step, branches: br };
    const toMail = br.filter(b => b.state === 'to_mail').length;
    const next = br.filter(b => b.until).map(b => b.until).sort()[0];
    return { state: 'active', label: toMail ? `Letter ${step}: ${toMail} to mail` : `Letter ${step}: waiting for responses`, step, next, branches: br };
  }

  /** New disputes to create for every branch that is due. Returns [{ parent, type, recipient, recipientAddress, items, step }]. */
  function plan(ws, seq, today) {
    const out = [];
    const all = seqDisputes(ws, seq);
    let furnisherDone = all.some(d => ['furnisher_623', 'student_loan_623', 'furnisher_final', 'validation_809'].includes(d.type) && seq.furnisher && d.recipient === seq.furnisher.name);
    branches(ws, seq, today).filter(b => b.state === 'due').forEach(({ d, step }) => {
      const items = d.items.map(it => Object.assign({}, it));
      const nextType = d.outcome === 'frivolous' ? d.type : NEXT[d.type];
      if (nextType === 'cfpb_complaint') out.push({ parent: d, type: nextType, recipient: d.recipient, recipientAddress: 'File online at consumerfinance.gov/complaint', items, step: step + 1 });
      else out.push({ parent: d, type: nextType, recipient: d.recipient, recipientAddress: d.recipientAddress || '', items, step: step + 1 });
      // Letter 2 also goes straight to the furnisher, once.
      if (step === 1 && seq.furnisher && seq.furnisher.name && !furnisherDone && (isBureau(d.recipient) || ['public_record_611', 'tenant_screening_611'].includes(d.type))) {
        out.push({ parent: d, type: 'furnisher_623', recipient: seq.furnisher.name, recipientAddress: seq.furnisher.address || '', items, step: 2 });
        furnisherDone = true;
      }
    });
    return out;
  }

  /** The whole sequence as letter types, for previews: [{ step, type, recipient }]. */
  function outline(seq, firstLetters) {
    const starts = firstLetters.map(f => ({ type: f.type, recipient: f.recipient, step: 1 }));
    const needsFurnisher = seq.furnisher && seq.furnisher.name && firstLetters.some(f => isBureau(f.recipient) || ['public_record_611', 'tenant_screening_611'].includes(f.type)) &&
      !firstLetters.some(f => f.recipient === seq.furnisher.name);
    if (needsFurnisher) starts.push({ type: 'furnisher_623', recipient: seq.furnisher.name, step: 2 });
    const rows = [];
    starts.forEach(f => {
      let type = f.type, step = f.step;
      while (type && step <= MAX_DEPTH) {
        rows.push({ step, type, recipient: type === 'cfpb_complaint' ? 'CFPB (about ' + f.recipient + ')' : f.recipient });
        type = NEXT[type]; step++;
      }
    });
    return rows.sort((a, b) => a.step - b.step);
  }

  /** The letter text for a sequence dispute, built with the same rules as the staff app. */
  function letterFor(ws, d) {
    const L = root.Letters;
    if (!L) return null;
    const client = ws.clients.find(c => c.id === d.clientId);
    const bureau = Law.BUREAUS[d.recipient];
    const book = !bureau && !d.recipientAddress && root.Furnishers && root.Furnishers.lookup(ws, d.recipient);
    const recipient = bureau ? { name: bureau.name, address: bureau.address } : { name: d.recipient, address: d.recipientAddress || (book ? book.address : '') };
    const prior = ws.disputes.find(p => p.id === d.parentId);
    const report = d.items[0] && (ws.reports || []).find(r => r.id === d.items[0].reportId);
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const res = L.build(d.type, { client, recipient, recipientName: d.recipient, items: d.items, today, report, priorSentAt: prior && prior.sentAt, business: client && client.business });
    return res.ok ? res.text : null;
  }

  /**
   * Moves every active sequence forward on `today` and records the results in `ws`:
   *  - withdraws unmailed letters whose previous letter has since been answered deleted/corrected,
   *  - drafts every due letter (as a draft dispute + draft letter that staff still approve),
   *  - adds one review task per client with new drafts, an attorney-review task, and completion.
   * Runs the same in the browser and on the server. Returns { drafted, withdrawn, events }.
   */
  function advance(ws, today, opts) {
    const { uid, now, onlyId } = opts;
    const events = [];
    let drafted = 0, withdrawn = 0;
    const perClient = {};
    const nextRound = (cid, recipient) => 1 + Math.max(0, ...ws.disputes.filter(d => d.clientId === cid && d.recipient === recipient).map(d => d.round || 0));
    ws.sequences = ws.sequences || [];
    ws.tasks = ws.tasks || [];
    ws.letters = ws.letters || [];
    ws.sequences.filter(q => q.status !== 'stopped' && (!onlyId || q.id === onlyId)).forEach(q => {
      // A letter drafted after "no response" is moot once the earlier letter is answered deleted/corrected.
      seqDisputes(ws, q).filter(d => d.parentId && !d.sentAt && !d.withdrawnAt).forEach(d => {
        const parent = ws.disputes.find(p => p.id === d.parentId);
        if (!parent || !RESOLVED.includes(parent.outcome)) return;
        d.withdrawnAt = now();
        d.status = 'closed';
        d.notes = `${d.notes ? d.notes + '\n' : ''}Withdrawn: ${parent.recipient} answered ${parent.outcome} before this letter was mailed.`;
        const l = ws.letters.find(x => x.id === d.letterId);
        if (l) l.status = 'draft';
        withdrawn++;
        events.push({ text: `Sequence “${q.title}”: withdrew the unmailed letter to ${d.recipient} — ${parent.recipient} answered ${parent.outcome}`, clientId: q.clientId });
      });
      plan(ws, q, today).forEach(p => {
        const d = { id: uid(), clientId: q.clientId, type: p.type, round: nextRound(q.clientId, p.recipient), recipient: p.recipient, recipientAddress: p.recipientAddress, status: 'draft', items: p.items, letterId: null, createdAt: now(), sentAt: null, receivedAt: null, dueAt: null, tracking: '', outcome: null, respondedAt: null, notes: `Sequence “${q.title}” — Letter ${p.step}, after ${p.parent.recipient} ${p.parent.outcome ? 'answered: ' + p.parent.outcome.replace('_', ' ') : 'did not answer by the deadline'}.`, seqId: q.id, parentId: p.parent.id, strategyStep: Math.min(p.step, 3) };
        ws.disputes.push(d);
        const text = letterFor(ws, d);
        if (text) {
          const l = { id: uid(), clientId: d.clientId, disputeId: d.id, type: d.type, status: 'draft', createdAt: now(), approvedAt: null, text };
          ws.letters.push(l);
          d.letterId = l.id;
        }
        drafted++;
        perClient[q.clientId] = (perClient[q.clientId] || 0) + 1;
      });
      const st = status(ws, q, today);
      if (st.state === 'attorney' && !q.attorneyTaskAt) {
        const c = ws.clients.find(x => x.id === q.clientId);
        ws.tasks.push({ id: uid(), clientId: q.clientId, title: `Attorney review: “${q.title}” still reported after Letter 3 — offer ${c ? c.name : 'the client'} a consumer attorney referral (FCRA §§ 616–617)`, due: today, done: false, createdAt: now() });
        q.attorneyTaskAt = now();
        events.push({ text: `Sequence “${q.title}” reached attorney review`, clientId: q.clientId });
      }
      if (st.state === 'won' && !q.completedAt) {
        q.completedAt = now();
        events.push({ text: `Sequence “${q.title}” completed — items removed or corrected`, clientId: q.clientId });
      }
    });
    Object.keys(perClient).forEach(cid => {
      const c = ws.clients.find(x => x.id === cid);
      const n = perClient[cid];
      ws.tasks.push({ id: uid(), clientId: cid, title: `Review ${n} sequence letter${n > 1 ? 's' : ''} for ${c ? c.name : 'client'}: confirm with the client, approve, then add to Send round`, due: today, done: false, createdAt: now() });
      events.push({ text: `Sequences: drafted ${n} due letter${n > 1 ? 's' : ''}`, clientId: cid });
    });
    return { drafted, withdrawn, events };
  }

  const api = { PLAN, NEXT, RESOLVED, branches, status, plan, outline, waitUntil, stepOf, advance, letterFor };
  root.Sequences = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
