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
    reviewScan(cid, out, doc ? doc.name : 'report', docId);
  }

  /** Shows what the AI read and imports the selected bureaus as reports. */
  function reviewScan(cid, out, label, docId) {
    const doc = { name: label };
    const bureaus = out.bureaus || [];
    if (!bureaus.length) { toast('No tradelines were found in this file'); return; }
    modal({
      title: `AI scan — ${esc(label)}`, wide: true,
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
          const r = { id: Store.uid(), clientId: cid, bureau: b.bureau, date, source: (out.source || 'AI scan') + ' (AI scan)', scores: Number(b.score) ? { [b.bureau]: Number(b.score) } : {}, accounts, sourceDocId: docId || null };
          S().reports.push(r);
          return r;
        });
        const wins = afterImport(added);
        App().commit(`AI imported ${added.length} bureau report(s) from ${label}`, cid);
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


  // ---------- upload hub ----------
  const mode = () => (Store.remote ? 'server' : root.AIDirect && root.AIDirect.getKey() ? 'direct' : 'none');
  function mergeScans(list) {
    const merged = { reportDate: '', source: '', notes: '', bureaus: [] };
    list.forEach(o => {
      merged.reportDate = merged.reportDate || o.reportDate;
      merged.source = merged.source || o.source;
      if (o.notes) merged.notes += (merged.notes ? ' ' : '') + o.notes;
      (o.bureaus || []).forEach(b => {
        const ex = merged.bureaus.find(x => x.bureau === b.bureau);
        if (ex) { ex.accounts = ex.accounts.concat(b.accounts); ex.score = ex.score || b.score; } else merged.bureaus.push(Object.assign({}, b));
      });
    });
    return merged;
  }
  async function scanFiles(cid, files) {
    const m = mode();
    if (m === 'none') { toast('Turn on AI first: Settings → AI in this browser'); return; }
    const results = [];
    let firstDoc = null;
    for (const [i, file] of files.entries()) {
      if (file.size > 15 * 1024 * 1024) { toast(`${file.name} is over 15 MB`); continue; }
      toast(`AI is reading ${file.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''}… this can take a minute`);
      try {
        if (m === 'server') {
          const fd = new FormData(); fd.append('type', 'report'); fd.append('file', file);
          if (Store.remote.flushNow) await Store.remote.flushNow();
          const r = await fetch(`/api/clients/${cid}/files`, { method: 'POST', body: fd, credentials: 'same-origin' });
          const j = await r.json(); if (!r.ok) throw new Error(j.error);
          firstDoc = firstDoc || j.doc.id;
          await Store.remote.reload();
          results.push(await App().api('POST', `/api/clients/${cid}/files/${j.doc.id}/scan`));
        } else {
          results.push(await root.AIDirect.scan({ file }));
        }
      } catch (e) { toast(`${file.name}: ${e.message}`); }
    }
    if (!results.length) return;
    const out = mergeScans(results);
    if (!out.bureaus.length) { toast('The AI found no accounts in that report'); return; }
    reviewScan(cid, out, files.length === 1 ? files[0].name : `${files.length} files`, firstDoc);
  }
  async function scanText(cid, text) {
    const m = mode();
    if (m === 'none') { toast('Turn on AI first: Settings → AI in this browser'); return; }
    if (String(text).trim().length < 200) { toast('Paste the full report text (select all on the report page, copy, paste)'); return; }
    toast('AI is reading the pasted report… this can take a minute');
    try {
      const out = m === 'server' ? await App().api('POST', `/api/clients/${cid}/scan-text`, { text }) : await root.AIDirect.scan({ text });
      if (!out.bureaus || !out.bureaus.length) { toast('The AI found no accounts in that text'); return; }
      reviewScan(cid, out, 'pasted report');
    } catch (e) { toast(e.message); }
  }

  function uploadHub(cid) {
    const clients = S().clients;
    if (!clients.length) { toast('Add a client first'); return; }
    cid = cid || (location.hash.match(/^#\/clients\/([^/?]+)/) || [])[1] || '';
    const m = mode();
    const aiNote = m === 'none'
      ? `<div class="callout warn"><b>AI scanning is off</b>${Store.remote ? 'Set ANTHROPIC_API_KEY on the server to turn it on.' : 'Add your Anthropic API key in <a href="#/settings" data-close>Settings → AI in this browser</a> to read reports automatically.'} You can still import a CSV or enter accounts by hand.</div>`
      : `<div class="callout good"><b>✦ AI scan is on</b>Drop the report and AI reads every account for each bureau. You review everything before it is saved.</div>`;
    const offers = S().offers.filter(o => ['myfreescorenow', 'identityiq', 'smartcredit'].includes(o.key));
    modal({
      title: 'Upload credit report', wide: true,
      body: `<div class="form-grid">${field('Client', 'cid', cid, { type: 'select', options: [['', 'Choose a client…']].concat(clients.map(c => [c.id, c.name])), cls: 'span2' })}</div>
        <div style="margin:14px 0">${aiNote}</div>
        <div class="up-grid">
          <section class="up-card up-main"><h3>✦ AI scan a report file</h3><p class="small muted">PDF, saved web page (.html) or screenshots from MyFreeScoreNow, IdentityIQ, SmartCredit or annualcreditreport.com. Several files at once is fine.</p>
            <label class="drop" id="drop"><input type="file" id="up-files" multiple accept=".pdf,.html,.htm,.txt,.png,.jpg,.jpeg,.webp" hidden><b>Drop report files here</b><span class="small muted">or click to choose</span></label></section>
          <section class="up-card"><h3>✦ AI scan pasted text</h3><p class="small muted">On the report page press Ctrl+A, Ctrl+C, then paste here.</p><textarea id="up-text" rows="5" placeholder="Paste the full credit report…"></textarea><button type="button" class="btn sm primary" data-up="text" style="margin-top:8px">Scan pasted text</button></section>
          <section class="up-card"><h3>Spreadsheet (CSV)</h3><p class="small muted">One row per account with Metro 2 columns. Download the template from Settings.</p><button type="button" class="btn sm" data-up="csv">Import CSV</button></section>
          <section class="up-card"><h3>Enter by hand</h3><p class="small muted">Create the report, then add each account.</p><button type="button" class="btn sm" data-up="manual">Add report manually</button></section>
          ${Store.remote ? `<section class="up-card"><h3>Ask the client to upload</h3><p class="small muted">They upload it in their portal and it appears in Documents for scanning.</p><button type="button" class="btn sm" data-up="ask">Message client</button></section>` : ''}
          <section class="up-card"><h3>Need a report first?</h3><p class="small muted">3-bureau monitoring with downloadable reports:</p><div class="row small">${offers.map(o => `<a href="${esc(o.affiliateUrl || o.url)}" target="_blank" rel="noopener">${esc(o.name)} ↗</a>`).join('')}<a href="https://www.annualcreditreport.com" target="_blank" rel="noopener">AnnualCreditReport.com (free) ↗</a></div></section>
        </div>`,
      foot: '<button type="button" class="btn" data-close>Close</button>',
      onOpen: f => {
        const pick = () => { const v = f.elements.cid.value; if (!v) toast('Choose the client first'); return v; };
        const go = files => { const id = pick(); if (!id || !files.length) return; UI.close(); scanFiles(id, Array.from(files)); };
        const drop = f.querySelector('#drop'), inp = f.querySelector('#up-files');
        inp.onchange = () => go(inp.files);
        ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => go(e.dataTransfer.files));
        f.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
          const id = pick(); if (!id) return;
          const k = b.dataset.up;
          if (k === 'text') { const t = f.querySelector('#up-text').value; UI.close(); scanText(id, t); }
          if (k === 'csv' || k === 'manual') { UI.close(); App().A['add-report']({ dataset: { id } }); }
          if (k === 'ask') { UI.close(); App().messageModal(id, 'email', { subject: 'Please upload your credit report', body: TEMPLATE_ASK(Store.get.client(id)) }); }
        });
      }
    });
  }
  const TEMPLATE_ASK = c => `Hi ${c.firstName || c.name}, please download your 3-bureau credit report as a PDF and upload it in your client portal under "Your documents" (choose "Credit report"). If you don't have one yet, reply and we'll send you a link. Thank you!`;

  Object.assign(root.App.A, {
    'upload-report': el => uploadHub(el.dataset.id || el.dataset.client),
    'ai-key': () => {
      modal({ title: 'AI in this browser', body: `<p class="small">Paste your Anthropic API key (from console.anthropic.com → API keys). It is saved only in this browser, never in backups, and is used to scan reports directly from this file.</p>${field('Anthropic API key', 'key', root.AIDirect.getKey() ? '••••••••' + root.AIDirect.getKey().slice(-4) : '', { attrs: 'autocomplete="off"' })}<p class="small muted">Anyone who can open this browser can use the key. Remove it on shared computers.</p>`,
        foot: '<button type="button" class="btn danger" data-rm style="margin-right:auto">Remove key</button><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>',
        onOpen: f => { f.querySelector('[data-rm]').onclick = () => { root.AIDirect.setKey(''); UI.close(); toast('Key removed'); App().render(); }; },
        onSubmit: d => { if (d.key.startsWith('••')) return; if (!/^sk-ant-/.test(d.key)) { toast('That does not look like an Anthropic API key (it starts with sk-ant-)'); return false; } root.AIDirect.setKey(d.key); toast('AI scan is on for this browser'); App().render(); } });
    },
    'ai-scan': el => (Store.remote ? scanDoc(el.dataset.client, el.dataset.id) : toast('AI scanning runs on the Ledger server')),
    'ai-plan': el => (Store.remote ? planRound(el.dataset.id) : toast('AI round planning runs on the Ledger server with ANTHROPIC_API_KEY set'))
  });
  root.AIFlow = { afterImport, showWins, scanDoc, planRound, uploadHub, scanFiles, scanText, reviewScan };
})(window);
