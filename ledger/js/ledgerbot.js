/*
 * Staff side of the Ledger Assistant:
 *  - "✦ Metro 2 letters": unlimited dispute letters built from the rules engine's findings
 *    (template always; AI polish when the server has LEDGER_AI_ENABLED + OPENAI_API_KEY).
 *  - "Ledger Assistant" chat: explains findings, drafts/improves letters, next steps and
 *    deadlines for the selected client — grounded in the knowledge base. Falls back to a
 *    rules-engine summary when AI is off.
 *  - Partner click report.
 * Every letter is saved as a DRAFT; mailing (Lob) still requires staff approval.
 */
(function (root) {
  'use strict';
  const { Store, UI, Law, Letters, DisputeReasons, KB } = root;
  const { esc, modal, toast } = UI;
  const S = () => Store.state;
  const App = () => root.App;
  let cfg = null;
  async function config() {
    if (cfg) return cfg;
    if (!Store.remote) return (cfg = { enabled: false });
    try { cfg = await App().api('GET', '/api/assistant/config'); } catch { cfg = { enabled: false }; }
    return cfg;
  }
  const BUREAUS = ['Equifax', 'Experian', 'TransUnion'];
  const sevBadge = s => `<span class="badge ${s === 'high' ? 'b-high' : s === 'medium' ? 'b-med' : 'b-low'}">${esc(s)}</span>`;

  async function lettersModal(cid) {
    const c = Store.get.client(cid);
    const items = DisputeReasons.suggestionsFor(S(), cid);
    const conf = await config();
    const cs = Store.croaStatus(c);
    if (!items.length) {
      return modal({ title: 'Metro 2 letters', body: `<div class="callout good"><b>No dispute-ready inaccuracies</b>The rules engine didn’t find a Metro 2 or FCRA inconsistency in ${esc(c.name)}’s latest reports. Letters are only drafted for identified inaccuracies. If the client says something is wrong, add it as an issue on the tradeline (with evidence) and it will appear here.</div>`, foot: '<button type="button" class="btn" data-close>Close</button>' });
    }
    const groups = {};
    items.forEach((it, i) => { (groups[it.bureau] = groups[it.bureau] || []).push(Object.assign({ i }, it)); });
    const body = `${cs.cleared ? '' : '<div class="callout warn" style="margin-bottom:12px"><b>Not cleared under CROA yet</b>You can draft letters now, but nothing can be mailed until the disclosure and contract are signed and the 3-business-day cancellation period has ended.</div>'}
      <p class="small">Each item below is a specific inconsistency the rules engine found, with the Metro 2 field and the FCRA section behind it. Tick what the client has confirmed. One letter is drafted per bureau. There are no letter limits: draft as many as you need. Repeat disputes that were already verified are blocked unless you add new evidence or move to the next strategy letter.</p>
      ${Object.entries(groups).map(([b, list]) => `<h3 style="margin:14px 0 6px">${esc(b)}</h3>${list.map(it => `<div class="finding ${it.severity}"><label class="check"><input type="checkbox" name="pick" value="${it.i}" ${it.severity === 'high' && !it.needsClientConfirmation ? 'checked' : ''}><span class="t">${esc(it.creditor)} — ${esc(it.title)}</span></label> ${sevBadge(it.severity)}
        <div class="d small" style="margin-left:24px">${esc(it.discrepancy)}</div>
        <div class="f small muted" style="margin-left:24px">Fields: ${esc((it.fields || []).join(', '))} · Basis: ${esc(it.basis)} · KB: ${it.kb.map(k => { const r = KB && KB.byId(k); return r ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(k)}</a>` : esc(k); }).join(', ')}</div></div>`).join('')}`).join('')}
      <label class="field" style="margin-top:12px"><span>New evidence for repeat disputes (optional)</span><input name="newEvidence" placeholder="e.g. bank statement dated 2024-03-02 showing the account paid in full"></label>
      ${conf.enabled ? `<label class="check small"><input type="checkbox" name="ai" checked> Polish wording with AI (${esc(conf.model || 'AI')}). Identifiers are redacted before sending, and the facts, citations and [CONFIRM] markers are kept.</label>` : '<p class="small muted">AI is off, so template letters will be used. (The owner can turn AI on with LEDGER_AI_ENABLED and OPENAI_API_KEY on the server.)</p>'}
      <label class="check small"><input type="checkbox" name="confirmed"> ${esc(c.name)} reviewed each selected item and confirmed it is inaccurate, incomplete or not theirs.</label>`;
    modal({ title: `Metro 2 letters — ${c.name}`, wide: true, body, foot: '<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Draft letters</button>',
      onSubmit: async d => {
        const picked = [].concat(d.pick || []).map(Number).map(i => items[i]).filter(Boolean);
        if (!picked.length) { toast('Select at least one item'); return false; }
        if (!d.confirmed) { toast('Client confirmation is required'); return false; }
        const by = {};
        picked.forEach(it => { const k = it.bureau + '|' + it.letterType; (by[k] = by[k] || []).push(it); });
        let made = 0; const problems = [];
        for (const list of Object.values(by)) {
          const recipient = list[0].bureau, letterType = list[0].letterType;
          let text = null, warnings = [];
          if (Store.remote) {
            try {
              const out = await App().api('POST', '/api/letters/draft', { clientId: cid, recipient, letterType, items: list.map(i => ({ accountId: i.accountId, code: i.code })), newEvidence: d.newEvidence, mode: d.ai ? 'ai' : 'template' });
              text = out.text; warnings = out.warnings || [];
            } catch (e) { problems.push(`${recipient}: ${e.message}`); continue; }
          } else {
            const g = DisputeReasons.checkRepeat({ items: list, recipient, letterType, priorDisputes: S().disputes.filter(x => x.clientId === cid), newEvidence: d.newEvidence });
            if (!g.ok) { problems.push(`${recipient}: ${g.blocked.map(b => b.why).join(' ')}`); continue; }
          }
          const disp = { id: Store.uid(), clientId: cid, type: letterType, round: App().nextRound(cid, recipient), recipient, recipientAddress: '', status: 'draft',
            items: list.map(i => ({ reportId: i.reportId, accountId: i.accountId, creditor: i.creditor, accountNumber: i.accountNumber, bureau: i.bureau, discrepancy: i.discrepancy, requested: i.requested, evidence: d.newEvidence || '', fields: i.fields, code: i.code })),
            letterId: null, createdAt: Store.now(), sentAt: null, receivedAt: null, dueAt: null, tracking: '', outcome: null, respondedAt: null, notes: `Metro 2 rules engine: ${list.map(i => i.code).join(', ')}${warnings.length ? ' · ' + warnings.map(w => w.why).join(' ') : ''}` };
          S().disputes.push(disp);
          App().generateLetter(disp); // template letter (also validates specificity)
          if (text) { const l = Store.get.letter(disp.letterId); if (l) { l.text = text; l.status = 'draft'; } }
          made += 1;
        }
        if (made) App().commit(`Drafted ${made} Metro 2 letter(s) — review and approve before mailing`, cid);
        if (problems.length) toast(problems.join(' · '));
        else toast(`${made} draft letter(s) created. Review, edit and approve each one before mailing.`);
        App().go(`#/clients/${cid}/disputes`);
      } });
  }

  // ---------- chat ----------
  const chat = { clientId: '', history: [] };
  function md(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([a-z0-9-]+)\]/g, (m, id) => { const r = KB && KB.byId(id); return r ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.cite)}">[${id}]</a>` : m; }).replace(/\n/g, '<br>'); }
  async function assistantModal(cid) {
    if (cid !== undefined) { if (cid !== chat.clientId) chat.history = []; chat.clientId = cid || ''; }
    const conf = await config();
    const clients = S().clients;
    const quick = ['Explain the Metro 2 findings in plain English', 'What are the next steps and deadlines?', 'Draft an improved dispute letter for the strongest item', 'Which repair opportunities am I missing?', 'Business credit: what should this client do next?'];
    modal({ title: 'Ledger Assistant', wide: true,
      body: `<div class="row" style="gap:8px;margin-bottom:8px"><label class="small muted" for="lb-client">Client</label><select id="lb-client" name="client"><option value="">General question</option>${clients.map(c => `<option value="${c.id}" ${c.id === chat.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><span class="badge ${conf.enabled ? 'b-ok' : 'b-low'}">${conf.enabled ? 'AI on' : 'AI off · rules engine only'}</span></div>
        <div id="lb-log" class="ai-log" style="max-height:48vh;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:10px" aria-live="polite">${chat.history.map(m => `<div class="ai-msg ${m.role}"><p>${m.role === 'assistant' ? md(m.content) : esc(m.content)}</p></div>`).join('') || '<p class="small muted">Ask about the selected client’s file. Sensitive numbers are redacted before anything is sent to AI.</p>'}</div>
        <div class="row" style="flex-wrap:wrap;gap:6px;margin:8px 0">${quick.map(q => `<button type="button" class="btn sm ghost" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <label class="field"><span>Your question</span><textarea name="q" rows="2"></textarea></label>
        <p class="small muted">Suggestions need human review. Not legal advice. Never promise results.</p>`,
      foot: '<button type="button" class="btn" data-close>Close</button><button class="btn primary">Ask</button>',
      onOpen: f => {
        f.querySelector('#lb-client').onchange = e => { chat.clientId = e.target.value; chat.history = []; UI.close(); assistantModal(); };
        f.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { f.elements.q.value = b.dataset.q; f.requestSubmit(); });
      },
      onSubmit: async d => {
        const q = String(d.q || '').trim(); if (!q) return false;
        chat.history.push({ role: 'user', content: q });
        if (!Store.remote) { chat.history.push({ role: 'assistant', content: 'The assistant runs on the Ledger server.' }); assistantModal(); return; }
        try { const out = await App().api('POST', '/api/assistant/staff', { clientId: chat.clientId || null, history: chat.history }); chat.history.push({ role: 'assistant', content: (out.error ? out.error + '\n\n' : '') + out.text }); }
        catch (e) { chat.history.push({ role: 'assistant', content: e.message }); }
        assistantModal();
      } });
  }

  async function clicksModal() {
    if (!Store.remote) return toast('Click tracking runs on the Ledger server');
    let out; try { out = await App().api('GET', '/api/partners/clicks'); } catch (e) { return toast(e.message); }
    modal({ title: 'Partner link clicks', wide: true, foot: '<button type="button" class="btn" data-close>Close</button>',
      body: `<p class="small">Clicks on <span class="mono">/go/partner/…</span> links. Only the time, partner, viewer role and a hashed sub-ID are stored. No names, emails or IPs.</p>
        <div class="table-wrap"><table><thead><tr><th>Partner</th><th>Link</th><th class="right">7 days</th><th class="right">30 days</th><th class="right">All</th><th>Last click</th></tr></thead><tbody>${out.offers.map(o => `<tr><td><b>${esc(o.name)}</b><div class="small muted">${esc(o.audience)} · ${esc(o.network)}${o.subIdParam ? ' · sub-ID ' + esc(o.subIdParam) : ''}</div></td><td>${o.linkSet ? '<span class="badge b-ok">Set</span>' : `<span class="badge b-med">Paste your link</span>${o.joinUrl ? ` <a class="small" href="${esc(o.joinUrl)}" target="_blank" rel="noopener">Join ↗</a>` : ''}`}</td><td class="right">${o.last7}</td><td class="right">${o.last30}</td><td class="right">${o.total}</td><td class="small">${o.lastAt ? esc(String(o.lastAt).slice(0, 10)) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">${esc(out.disclosure)}</p>` });
  }

  async function authSettingsModal() {
    let st; try { st = await App().api('GET', '/api/settings/auth'); } catch (e) { return toast(e.message); }
    let users = []; try { users = await App().api('GET', '/api/users'); } catch { /* none */ }
    modal({ title: 'Sign-in & email', foot: '<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>',
      body: `<p class="small">Outbound email: <b>${st.mailEnabled ? esc(st.mailMode) : 'off'}</b>${st.mailEnabled ? '' : ' — set LEDGER_MAIL_MODE (resend or smtp) and LEDGER_EMAIL_FROM on the server to send reset links, codes and updates. Until then, use “Copy reset link” on the Team page.'}</p>
        <label class="check small"><input type="checkbox" name="magicLink" ${st.magicLink ? 'checked' : ''} ${st.mailEnabled ? '' : 'disabled'}> Let clients sign in with an emailed link (expires in 15 minutes)</label>
        <label class="check small"><input type="checkbox" name="emailOtp" ${st.emailOtp ? 'checked' : ''} ${st.mailEnabled ? '' : 'disabled'}> Require an emailed 6-digit code after the password (everyone)</label>
        <label class="check small"><input type="checkbox" name="notifications" ${st.notifications !== false ? 'checked' : ''}> Email clients when a bureau responds, an item is removed or corrected, or a deadline is near (clients can opt out)</label>
        <div class="field" style="margin-top:10px"><label>Make a password reset link for a user</label><div class="row"><select id="rl-user">${users.filter(u => !u.disabled).map(u => `<option value="${esc(u.id)}">${esc(u.email)} (${esc(u.role)})</option>`).join('')}</select><button type="button" class="btn sm" id="rl-go">Create link</button></div><div class="small mono" id="rl-out" style="word-break:break-all"></div></div>`,
      onOpen: m => { const go = m.querySelector('#rl-go'); if (go) go.onclick = async () => { const id = m.querySelector('#rl-user').value; if (!id) return; try { const r = await App().api('POST', '/api/users/' + encodeURIComponent(id) + '/reset-link'); m.querySelector('#rl-out').textContent = r.url + ' (works once, ' + r.expiresInMinutes + ' min)'; } catch (e) { toast(e.message); } }; },
      onSubmit: async d => { try { await App().api('PUT', '/api/settings/auth', { magicLink: !!d.magicLink, emailOtp: !!d.emailOtp, notifications: !!d.notifications }); toast('Saved'); } catch (e) { toast(e.message); return false; } } });
  }

  function fab() {
    if (document.getElementById('lb-fab')) return;
    const b = document.createElement('button');
    b.id = 'lb-fab'; b.className = 'btn ai-fab lb-fab'; b.type = 'button'; b.textContent = 'Ledger Assistant';
    b.setAttribute('aria-label', 'Open Ledger Assistant');
    b.onclick = () => { const m = location.hash.match(/^#\/clients\/([^/?]+)/); assistantModal(m ? m[1] : ''); };
    document.body.appendChild(b);
  }

  function boot() {
    if (!root.App || !root.App.A) return setTimeout(boot, 50);
    Object.assign(root.App.A, {
      'm2-letters': el => lettersModal(el.dataset.id),
      'ledger-assistant': el => assistantModal(el.dataset.id || ''),
      'partner-clicks': () => clicksModal(),
      'auth-settings': () => authSettingsModal()
    });
    fab();
  }
  boot();
  root.LedgerBot = { lettersModal, assistantModal, clicksModal };
})(window);
