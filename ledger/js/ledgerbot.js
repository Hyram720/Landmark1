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
      <label class="check small"><input type="checkbox" name="confirmed"> ${esc(c.name)} reviewed each selected item and confirmed it is inaccurate or incomplete.</label>`;
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

  // ---------- personal info & inquiries (feeds js/filecheck.js) ----------
  const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
  function piiModal(cid, rid) {
    const c = Store.get.client(cid);
    const reps = Store.get.latestByBureau(cid);
    if (!reps.length) return toast('Add a credit report first');
    const r0 = reps.find(x => x.id === rid) || reps[0];
    const render = r => {
      const P = r.personal || {};
      const inq = (r.inquiries || []).map(q => [q.creditor, q.date, q.kind || 'hard', q.clientSays === 'unrecognized' ? 'unrecognized' : ''].join(' | ')).join('\n');
      return `<p class="small">Enter what the <b>${esc(r.bureau)}</b> report (${esc(r.date || '')}) shows, then record what the client says. Only items the client confirms are wrong become disputes; accurate information is left alone. DOB and SSN variations are compared but never printed in letters. Identity theft disputes are out of scope; refer clients to IdentityTheft.gov.</p>
        <label class="field"><span>Report</span><select name="rid">${reps.map(x => `<option value="${esc(x.id)}" ${x.id === r.id ? 'selected' : ''}>${esc(x.bureau)} · ${esc(x.date || '')}</option>`).join('')}</select></label>
        <div class="form-grid">
          <label class="field"><span>Names on the report (one per line)</span><textarea name="names" rows="3">${esc((P.names || []).join('\n'))}</textarea></label>
          <label class="field"><span>Client’s other names / AKAs (one per line)</span><textarea name="aka" rows="3">${esc((c.aka || []).join('\n'))}</textarea></label>
          <label class="field"><span>Addresses on the report</span><textarea name="addresses" rows="3">${esc((P.addresses || []).join('\n'))}</textarea></label>
          <label class="field"><span>Client’s previous addresses</span><textarea name="previousAddresses" rows="3">${esc((c.previousAddresses || []).join('\n'))}</textarea></label>
          <label class="field"><span>Employers on the report</span><textarea name="employers" rows="2">${esc((P.employers || []).join('\n'))}</textarea></label>
          <label class="field"><span>Client’s employers</span><textarea name="clientEmployers" rows="2">${esc((c.employers || []).join('\n'))}</textarea></label>
          <label class="field"><span>Dates of birth on the report</span><input name="dobs" type="password" autocomplete="off" value="${esc((P.dobs || []).join(', '))}" placeholder="YYYY-MM-DD, comma separated"></label>
          <label class="field"><span>SSN last-4 variations on the report</span><input name="ssns" type="password" autocomplete="off" inputmode="numeric" value="${esc((P.ssnLast4s || []).join(', '))}" placeholder="last 4 only"></label>
        </div>
        <label class="field"><span>Inquiries (one per line: company | YYYY-MM-DD | hard or soft | “unrecognized” if the client didn’t authorize it)</span><textarea name="inquiries" rows="4">${esc(inq)}</textarea></label>
        <h3 style="margin:10px 0 4px">Accounts the client disputes as inaccurate or unverifiable</h3>
        <div class="stack" style="gap:6px">${(r.accounts || []).map(t => `<div class="row" style="gap:8px;align-items:flex-start"><div style="min-width:180px" class="small"><b>${esc(t.creditor)}</b><br><span class="muted">${esc(t.status || '')}</span></div><select name="says:${esc(t.id)}"><option value="">No issue</option><option value="unrecognized" ${t.clientSays === 'unrecognized' ? 'selected' : ''}>Client says inaccurate / unverifiable</option><option value="accurate" ${t.clientSays === 'accurate' ? 'selected' : ''}>Client confirms accurate</option></select><input class="grow" name="why:${esc(t.id)}" maxlength="400" placeholder="What exactly is wrong (required to dispute)" value="${esc(t.clientExplanation || '')}"></div>`).join('')}</div>`;
    };
    modal({ title: `Personal info & inquiries — ${c.name}`, wide: true, body: render(r0), foot: '<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>',
      onOpen: f => { f.elements.rid.onchange = () => { const rid = f.elements.rid.value; const x = f.querySelector('[data-close]'); if (x) x.click(); piiModal(cid, rid); }; },
      onSubmit: d => {
        const r = reps.find(x => x.id === d.rid) || r0;
        r.personal = { names: lines(d.names), addresses: lines(d.addresses), employers: lines(d.employers), dobs: String(d.dobs || '').split(',').map(x => x.trim()).filter(Boolean), ssnLast4s: String(d.ssns || '').split(',').map(x => x.replace(/\D/g, '').slice(-4)).filter(Boolean) };
        r.inquiries = lines(d.inquiries).map((l, i) => { const [creditor, date, kind, flag] = l.split('|').map(x => (x || '').trim()); return { id: 'inq-' + i + '-' + (creditor || '').toLowerCase().replace(/\W+/g, '').slice(0, 12), creditor, date, kind: /soft/i.test(kind || '') ? 'soft' : 'hard', clientSays: /unrec/i.test(flag || '') ? 'unrecognized' : 'authorized' }; });
        c.aka = lines(d.aka); c.previousAddresses = lines(d.previousAddresses); c.employers = lines(d.clientEmployers);
        (r.accounts || []).forEach(t => { const v = d['says:' + t.id]; if (v) t.clientSays = v; else delete t.clientSays; t.clientExplanation = String(d['why:' + t.id] || '').trim(); if (!t.clientExplanation) delete t.clientExplanation; });
        App().commit(`Updated personal info & inquiries for ${c.name} (${r.bureau})`, cid);
        App().go(`#/clients/${cid}/audit`);
      } });
  }

  // ---------- business bureau file (feeds js/filecheck.js business checks) ----------
  function bizReportModal(cid) {
    const c = Store.get.client(cid);
    c.businessReports = c.businessReports || [];
    const BUREAUS = ['Dun & Bradstreet', 'Experian Business', 'Equifax Business'];
    modal({ title: `Business bureau file — ${c.name}`, wide: true, foot: '<button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save report</button>',
      body: `<p class="small">Enter what the business bureau shows. Ledger compares it with the client file (legal name/DBA, address, phone, formation date, NAICS/SIC) and the vendor accounts. Business files are corrected through each bureau’s own process, not FCRA § 611.</p>
        <div class="form-grid">
          <label class="field"><span>Bureau</span><select name="bureau">${BUREAUS.map(b => `<option>${esc(b)}</option>`).join('')}</select></label>
          <label class="field"><span>Report date</span><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
          <label class="field"><span>Business name shown</span><input name="name"></label>
          <label class="field"><span>Address shown</span><input name="address"></label>
          <label class="field"><span>Phone shown</span><input name="phone"></label>
          <label class="field"><span>Formation date shown</span><input name="formedOn" type="date"></label>
          <label class="field"><span>Years in business shown</span><input name="yearsInBusiness" type="number" min="0" step="0.5"></label>
          <label class="field"><span>NAICS shown</span><input name="naics"></label>
          <label class="field"><span>SIC shown</span><input name="sic"></label>
        </div>
        <label class="field"><span>Tradelines (one per line: creditor | last 4 | open/closed/paid | balance | limit | opened YYYY-MM-DD | last reported YYYY-MM-DD | closed on)</span><textarea name="tradelines" rows="4" placeholder="Uline | 1234 | open | 250 | 1000 | 2026-08-01 | 2026-10-01 |"></textarea></label>
        <label class="field"><span>Liens, judgments and UCC filings (one per line: ucc/lien/judgment | filed YYYY-MM-DD | open/satisfied | secured party or court | amount | date the client’s documents show it satisfied/terminated | document)</span><textarea name="records" rows="3" placeholder="ucc | 2024-02-01 | open | Example Equipment Finance | 12000 | 2025-09-15 | UCC-3 termination"></textarea></label>
        <p class="small muted">Saved reports: ${c.businessReports.length ? c.businessReports.map(r => esc(r.bureau + ' ' + r.date)).join(', ') : 'none yet'}.</p>`,
      onSubmit: d => {
        const id = Store.uid();
        const tl = lines(d.tradelines).map((l, i) => { const [creditor, last4, status, balance, limit, opened, lastReported, closedOn] = l.split('|').map(x => (x || '').trim()); return { id: `${id}-t${i}`, creditor, accountNumber: last4, status: (status || 'open').toLowerCase(), balance, limit, opened, lastReported, closedOn }; });
        const pr = lines(d.records).map((l, i) => { const [type, filedOn, status, securedParty, amount, clientSatisfiedOn, docRef] = l.split('|').map(x => (x || '').trim()); return { id: `${id}-p${i}`, type: (type || '').toLowerCase(), filedOn, status: (status || 'open').toLowerCase(), securedParty, amount, clientSatisfiedOn, docRef }; });
        c.businessReports.push({ id, bureau: d.bureau, date: d.date, profile: { name: d.name, address: d.address, phone: d.phone, formedOn: d.formedOn, yearsInBusiness: d.yearsInBusiness, naics: d.naics, sic: d.sic }, tradelines: tl, publicRecords: pr });
        App().commit(`Added ${d.bureau} business report for ${c.name}`, cid);
        const n = DisputeReasons.suggestionsFor(S(), cid).filter(x => x.business).length;
        toast(n ? `${n} business item(s) ready for a correction letter — use ✦ Dispute letters` : 'Saved. No business inaccuracies found.');
        App().go(`#/clients/${cid}/business`);
      } });
  }

  // ---------- business credit coach (staff) ----------
  async function coachModal(cid, msg) {
    const c = Store.get.client(cid);
    if (!Store.remote) return toast('The coach runs on the Ledger server');
    let v;
    try { v = msg ? await App().api('POST', `/api/coach/${encodeURIComponent(cid)}/chat`, { message: msg }) : await App().api('GET', `/api/coach/${encodeURIComponent(cid)}`); } catch (e) { return toast(e.message); }
    const st = v.state;
    const u = st.utilization;
    modal({ title: `Business credit coach — ${c.name}`, wide: true, foot: '<button type="button" class="btn" data-close>Close</button><button class="btn primary">Ask</button>',
      body: `<div class="callout">${md(v.text)}</div>
        ${st.started ? '' : '<button type="button" class="btn primary" data-coach-start>Start the 90-day plan today</button>'}
        ${(st.pending || []).length ? `<h3 style="margin:12px 0 4px">Client said these are done — review</h3>${st.pending.map(p => `<div class="row small" style="gap:8px"><span class="grow">${esc(p.key)} · ${esc(String(p.at).slice(0, 10))}${p.note ? ' · “' + esc(p.note) + '”' : ''}</span><button type="button" class="btn sm primary" data-step="${esc(p.key)}" data-done="1">Accept</button><button type="button" class="btn sm" data-step="${esc(p.key)}" data-done="0">Not yet</button></div>`).join('')}` : ''}
        ${st.started ? `<h3 style="margin:12px 0 4px">Plan steps</h3><ul class="list">${st.steps.map(s => `<li><div class="grow small"><b>${esc(s.title)}</b><div class="meta">due ${esc(s.due)}${s.overdue ? ' · <b style="color:var(--high)">overdue</b>' : ''}${s.clientConfirmed ? ' · client says done' : ''}</div></div>${s.complete ? '<span class="badge b-ok">Done</span>' : `<button type="button" class="btn sm" data-step="${esc(s.key)}" data-done="1">Mark done</button>`}</li>`).join('')}</ul>` : ''}
        <h3 style="margin:12px 0 4px">Utilization</h3>
        ${u.business.accounts.length ? `<div class="table-wrap"><table><thead><tr><th>Account</th><th class="right">Balance</th><th class="right">Limit</th><th class="right">Used</th></tr></thead><tbody>${u.business.accounts.map(a => `<tr><td>${esc(a.name)}${a.guaranteed ? ' <span class="badge b-low">PG</span>' : ''}</td><td class="right">$${a.balance.toLocaleString()}</td><td class="right">$${a.limit.toLocaleString()}</td><td class="right"><span class="badge ${a.pct >= 50 ? 'b-high' : a.pct >= 30 ? 'b-med' : 'b-ok'}">${a.pct}%</span></td></tr>`).join('')}<tr><td><b>Overall</b></td><td class="right">$${u.business.balance.toLocaleString()}</td><td class="right">$${u.business.limit.toLocaleString()}</td><td class="right"><b>${u.business.pct}%</b></td></tr></tbody></table></div>` : '<p class="small muted">Add a balance and limit to vendor accounts or credit lines to see utilization.</p>'}
        ${u.personal.filter(p => p.pct !== null).map(p => `<div class="small">Personal revolving (${esc(p.bureau)}): <b>${p.pct}%</b>${p.includesGuaranteed ? ' incl. owner-guaranteed accounts' : ''}</div>`).join('')}
        <label class="field" style="margin-top:12px"><span>Ask the coach</span><input name="q" maxlength="1000" placeholder="e.g. What should we do this week? Which vendor should we add next?"></label>`,
      onOpen: f => {
        const start = f.querySelector('[data-coach-start]');
        if (start) start.onclick = async () => { try { await App().api('POST', `/api/coach/${encodeURIComponent(cid)}/start`); await App().reload(); coachModal(cid); } catch (e) { toast(e.message); } };
        f.querySelectorAll('[data-step]').forEach(b => b.onclick = async () => { try { await App().api('POST', `/api/coach/${encodeURIComponent(cid)}/step`, { key: b.dataset.step, done: b.dataset.done === '1' }); await App().reload(); coachModal(cid); } catch (e) { toast(e.message); } });
      },
      onSubmit: d => { const q = String(d.q || '').trim(); if (!q) return false; coachModal(cid, q); } });
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
      'auth-settings': () => authSettingsModal(),
      'pii-edit': el => piiModal(el.dataset.id),
      'biz-report': el => bizReportModal(el.dataset.id),
      'biz-coach': el => coachModal(el.dataset.id)
    });
    fab();
  }
  boot();
  root.LedgerBot = { lettersModal, assistantModal, clicksModal };
})(window);
