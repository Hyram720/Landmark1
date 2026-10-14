/* AI-assisted workflow: scan uploaded reports, plan the next round, and report removals. */
(function (root) {
  'use strict';
  const { Store, Law, Results, UI } = root;
  const { esc, modal, toast, field, icon } = UI;
  const S = () => Store.state;
  const T = () => Store.today();
  const App = () => root.App;

  /** Runs removal detection for newly added reports; returns wins and records them. */
  function afterImport(reports) {
    const wins = [];
    reports.forEach(r => {
      const out = Results.applyNewReport(S(), r, T());
      out.wins.forEach(w => wins.push(w));
    });
    if (wins.length) {
      const cid = reports[0].clientId;
      const c = Store.get.client(cid);
      wins.forEach(w => Store.log(`${w.kind === 'deleted' ? 'REMOVED' : 'Corrected'}: ${w.creditor} on ${w.bureau}`, cid));
      S().tasks.push({ id: Store.uid(), clientId: cid, title: `Tell ${c.name} about ${wins.length} result(s) and plan the next round`, due: T(), done: false, createdAt: Store.now() });
    }
    return wins;
  }

  function showWins(cid, wins) {
    const c = Store.get.client(cid);
    const text = Results.winsText(c.name, wins);
    modal({
      title: `🎉 ${wins.length} result(s) detected for ${c.name}`,
      body: `<p class="small">Compared with the previous report from the same bureau, these disputed items changed. The disputes were updated automatically; items still reporting stay open for the next strategy letter.</p>
        <ul class="list" style="margin:8px 0 12px">${wins.map(w => `<li><span class="badge ${w.kind === 'deleted' ? 'b-ok' : 'b-info'}">${w.kind === 'deleted' ? 'Removed' : 'Corrected'}</span><div class="grow"><b>${esc(w.creditor)}</b> · ${esc(w.bureau)}${w.changes ? `<div class="meta">${w.changes.map(ch => `${esc(ch.field)}: ${esc(ch.from || '—')} → ${esc(ch.to || '—')}`).join('; ')}</div>` : ''}</div></li>`).join('')}</ul>
        ${field('Message to the client', 'body', text, { type: 'textarea', rows: 6 })}`,
      foot: '<button type="button" class="btn" data-close>Later</button><button type="button" class="btn" data-sms>Text client</button><button class="btn primary">Email client</button>',
      onOpen: f => { f.querySelector('[data-sms]').onclick = () => { const body = f.elements.body.value; UI.close(); App().messageModal(cid, 'sms', { body }); }; },
      onSubmit: d => { setTimeout(() => App().messageModal(cid, 'email', { subject: 'Results from your disputes', body: d.body }), 0); }
    });
  }

  async function scanDoc(cid, docId) {
    const doc = (S().documents || []).find(d => d.id === docId);
    toast('Scanning the report with AI… this can take a minute');
    let out;
    try { out = await App().api('POST', `/api/clients/${cid}/files/${docId}/scan`); } catch (e) { toast(e.message); return; }
    const bureaus = out.bureaus || [];
    if (!bureaus.length) { toast('No tradelines were found in this file'); return; }
    modal({
      title: `AI scan — ${doc ? doc.name : 'report'}`, wide: true,
      body: `<p class="small">Review what the AI read before importing. ${out.source ? `Source: <b>${esc(out.source)}</b>. ` : ''}${out.reportDate ? `Report date: <b>${esc(out.reportDate)}</b>.` : ''}</p>
        ${out.notes ? `<div class="callout warn" style="margin:8px 0"><b>AI notes</b>${esc(out.notes)}</div>` : ''}
        ${bureaus.map((b, bi) => `<h3 style="margin:14px 0 6px"><label class="check"><input type="checkbox" name="b[]" value="${bi}" checked> ${esc(b.bureau)} · ${b.accounts.length} tradelines${b.score ? ' · score ' + esc(b.score) : ''}</label></h3>
          <div class="table-wrap"><table><thead><tr><th>Creditor</th><th>Status</th><th class="num">Balance</th><th class="num">Past due</th><th>Opened</th><th>DOFD</th><th>Remarks</th></tr></thead><tbody>${b.accounts.map(a => `<tr><td><b>${esc(a.creditor)}</b><div class="small muted mono">${esc(a.accountNumber)}</div></td><td>${esc(a.status)}</td><td class="num">${esc(a.balance)}</td><td class="num">${esc(a.pastDue)}</td><td class="small">${esc(a.opened)}</td><td class="small">${esc(a.dofd)}</td><td class="small">${esc(a.remarks)}</td></tr>`).join('')}</tbody></table></div>`).join('')}`,
      foot: `<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Import selected</button>`,
      onSubmit: d => {
        const picked = (d.b || []).map(Number);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(out.reportDate) ? out.reportDate : T();
        const added = picked.map(i => {
          const b = bureaus[i];
          const accounts = b.accounts.map(a => App().tradelineFrom(Object.assign({}, a, { reportedDate: a.reportedDate || date, issue: '', evidence: '' })));
          const r = { id: Store.uid(), clientId: cid, bureau: b.bureau, date, source: (out.source || 'AI scan') + ' (AI scan)', scores: Number(b.score) ? { [b.bureau]: Number(b.score) } : {}, accounts, sourceDocId: docId };
          S().reports.push(r);
          return r;
        });
        const wins = afterImport(added);
        App().commit(`AI imported ${added.length} bureau report(s) from ${doc ? doc.name : 'an uploaded file'}`, cid);
        App().go(`#/clients/${cid}/audit`);
        if (wins.length) setTimeout(() => showWins(cid, wins), 50);
      }
    });
  }

  async function planRound(cid) {
    const c = Store.get.client(cid);
    toast('Ledger AI is reviewing the file and planning the next round…');
    let plan;
    try { await (Store.remote.flushNow ? Store.remote.flushNow() : null); plan = await App().api('POST', `/api/clients/${cid}/ai-plan`); } catch (e) { toast(e.message); return; }
    const cs = Store.croaStatus(c);
    modal({
      title: `AI round plan — ${c.name}`, wide: true,
      body: `<div class="callout" style="margin-bottom:12px"><b>Summary</b>${esc(plan.summary)}</div>
        ${plan.letters.length ? plan.letters.map((L, i) => `<div class="finding ${L.strategyStep >= 2 ? 'high' : 'medium'}" style="margin-bottom:10px">
          <label class="check"><input type="checkbox" name="L[]" value="${i}" checked><span class="t">Letter ${L.strategyStep} · ${esc((Law.DISPUTE_TYPES[L.letterType] || {}).label || L.letterType)} → ${esc(L.recipient)}</span></label>
          <div class="small muted" style="margin:2px 0 6px 24px">${esc(L.why)}</div>
          <ul class="small" style="margin:0 0 0 24px;padding-left:16px">${L.items.map(it => `<li><b>${esc(it.creditor)}</b>${it.bureau ? ' (' + esc(it.bureau) + ')' : ''}: ${esc(it.discrepancy)}${it.evidenceNeeded ? `<br><span class="muted">Evidence: ${esc(it.evidenceNeeded)}</span>` : ''}${it.needsClientConfirmation ? ' <span class="badge b-med plain">client must confirm</span>' : ''}</li>`).join('')}</ul></div>`).join('') : '<p class="muted">No letters recommended right now.</p>'}
        ${plan.doNotDispute.length ? `<h3 style="margin:14px 0 6px">Not disputing (accurate or not worth it)</h3><ul class="small" style="padding-left:18px">${plan.doNotDispute.map(x => `<li><b>${esc(x.creditor)}</b> — ${esc(x.reason)} <span class="muted">Instead: ${esc(x.alternative)}</span></li>`).join('')}</ul>` : ''}
        <h3 style="margin:14px 0 6px">Message for the client</h3><pre class="doc" style="max-height:160px">${esc(plan.clientMessage)}</pre>
        ${cs.cleared ? '' : '<div class="callout warn" style="margin-top:12px"><b>Onboarding not cleared</b>Drafts can be created, but nothing can be approved or mailed until the CROA steps are complete.</div>'}
        <label class="check" style="margin-top:12px"><input type="checkbox" name="confirmed"> <span>${esc(c.name)} reviewed the selected items and confirmed each one is inaccurate, incomplete or not theirs.</span></label>`,
      foot: `<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn" data-msg>Send client message</button><button class="btn primary">Create letters</button>`,
      onOpen: f => { f.querySelector('[data-msg]').onclick = () => { UI.close(); App().messageModal(cid, 'email', { subject: 'Your next dispute round', body: plan.clientMessage }); }; },
      onSubmit: d => {
        const picked = (d.L || []).map(Number);
        if (!picked.length) { toast('Select at least one letter'); return false; }
        if (!d.confirmed) { toast('Client confirmation is required'); return false; }
        const made = picked.map(i => {
          const L = plan.letters[i];
          const items = L.items.map(it => {
            const rep = S().reports.find(r => r.clientId === cid && r.accounts.some(a => a.id === it.accountId));
            return { reportId: rep ? rep.id : null, accountId: it.accountId || null, creditor: it.creditor, accountNumber: it.accountNumber, bureau: it.bureau, discrepancy: it.discrepancy, requested: it.requested, evidence: it.evidenceNeeded ? `[${it.evidenceNeeded}]` : '', fields: [] };
          });
          const disp = { id: Store.uid(), clientId: cid, type: L.letterType, round: App().nextRound(cid, L.recipient), recipient: L.recipient, recipientAddress: '', status: 'draft', items, letterId: null, createdAt: Store.now(), sentAt: null, receivedAt: null, dueAt: null, tracking: '', outcome: null, respondedAt: null, notes: `AI plan (Letter ${L.strategyStep}): ${L.why}`, strategyStep: L.strategyStep, aiPlanned: true };
          S().disputes.push(disp);
          App().generateLetter(disp);
          return disp;
        });
        App().commit(`Created ${made.length} letter draft(s) from the AI round plan`, cid);
        App().go(`#/clients/${cid}/disputes`);
      }
    });
  }

  Object.assign(root.App.A, {
    'ai-scan': el => (Store.remote ? scanDoc(el.dataset.client, el.dataset.id) : toast('AI scanning runs on the Ledger server')),
    'ai-plan': el => (Store.remote ? planRound(el.dataset.id) : toast('AI round planning runs on the Ledger server with ANTHROPIC_API_KEY set'))
  });
  root.AIFlow = { afterImport, showWins, scanDoc, planRound };
})(window);
