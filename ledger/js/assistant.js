/* Ledger AI drawer: a Claude-powered credit repair expert that sees the open client's file. */
(function (root) {
  'use strict';
  const { UI, Store } = root;
  const { esc, icon, toast } = UI;
  const state = { open: false, clientId: '', history: [], busy: false };

  const QUICK = {
    client: [
      ['Explain the audit', 'Walk me through this client’s Metro 2 findings. Which are real inaccuracies worth disputing, which need the client to confirm or document, and which are accurate negatives we should not dispute?'],
      ['Plan the next round', 'Based on the disputes so far and their outcomes, what should the next round be for each bureau and furnisher? Include the legal basis and what evidence to gather.'],
      ['Draft a client update', 'Draft a short, friendly text and a longer email updating this client on where their file stands and what we need from them next. No promises of results.'],
      ['Rebuild plan', 'Give this client a 90-day credit-building plan (utilization, positive tradelines, authorized users, credit builders) tailored to their file.'],
      ['Business credit plan', 'Review this client’s business credit setup and give a step-by-step plan to become fundable, in priority order.']
    ],
    general: [
      ['Explain a Metro 2 code', 'Explain what Account Status 97 with payment history LLLLLL654321 means, and what would make it inaccurate.'],
      ['Check my marketing', 'Review this ad copy for CROA and FTC problems and rewrite it compliantly: "We guarantee to delete all your negative items in 30 days and raise your score 100 points!"'],
      ['Onboarding script', 'Write a compliant phone script for a free consultation, including the required disclosures and how to explain fees.'],
      ['Business credit 101', 'Explain the steps to build business credit from scratch for a new LLC, including which bureaus matter and typical timelines.']
    ]
  };

  function md(text) {
    const lines = esc(text).split('\n');
    let html = '', list = null;
    const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    lines.forEach(l => {
      const b = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
      if (b) { const t = /^\s*\d+\./.test(l) ? 'ol' : 'ul'; if (list !== t) { if (list) html += `</${list}>`; html += `<${t}>`; list = t; } html += `<li>${inline(b[1])}</li>`; return; }
      if (list) { html += `</${list}>`; list = null; }
      const h = l.match(/^#{1,4}\s+(.*)/);
      if (h) html += `<h4>${inline(h[1])}</h4>`;
      else if (l.trim()) html += `<p>${inline(l)}</p>`;
    });
    if (list) html += `</${list}>`;
    return html;
  }

  function currentClientFromRoute() {
    const m = location.hash.match(/^#\/clients\/([^/?]+)/);
    return m ? m[1] : '';
  }

  function render() {
    let el = document.getElementById('ai-drawer');
    if (!el) { el = document.createElement('aside'); el.id = 'ai-drawer'; el.className = 'ai-drawer'; document.body.appendChild(el); }
    el.classList.toggle('open', state.open);
    if (!state.open) return;
    const clients = Store.state.clients;
    const quick = state.clientId ? QUICK.client : QUICK.general;
    el.innerHTML = `<div class="ai-head"><div><b>Ledger AI</b><div class="small muted">Credit repair & business credit expert</div></div><button class="btn ghost sm" data-ai="close" aria-label="Close">${icon('x')}</button></div>
      <div class="ai-ctx"><label class="small muted" for="ai-client">Client file</label><select id="ai-client"><option value="">No client — general question</option>${clients.map(c => `<option value="${c.id}" ${c.id === state.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="ai-log" id="ai-log">${state.history.length ? state.history.map(m => `<div class="ai-msg ${m.role}">${m.role === 'assistant' ? md(m.content) : `<p>${esc(m.content)}</p>`}</div>`).join('') : `<div class="ai-empty"><p class="small">Ask anything about Metro 2, disputes, FCRA/CROA, or business credit.${state.clientId ? ' I can see this client’s reports, audit findings and disputes.' : ''}</p><div class="ai-quick">${quick.map(([l], i) => `<button class="btn sm" data-ai="quick" data-i="${i}">${esc(l)}</button>`).join('')}</div></div>`}
        ${state.busy ? '<div class="ai-msg assistant"><p class="muted">Thinking…</p></div>' : ''}</div>
      <form class="ai-input" id="ai-form"><textarea id="ai-q" rows="2" placeholder="Ask Ledger AI…"></textarea><button class="btn primary" ${state.busy ? 'disabled' : ''}>Send</button></form>
      <div class="small muted ai-foot">AI suggestions need human review. Not legal advice.${state.history.length ? ' · <a href="#" data-ai="clear">New conversation</a>' : ''}</div>`;
    const log = el.querySelector('#ai-log'); log.scrollTop = log.scrollHeight;
    el.querySelector('#ai-client').onchange = e => { state.clientId = e.target.value; state.history = []; render(); };
    el.querySelector('#ai-form').onsubmit = e => { e.preventDefault(); const q = el.querySelector('#ai-q').value.trim(); if (q) ask(q); };
    el.querySelector('#ai-q').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('#ai-form').requestSubmit(); } };
    el.querySelectorAll('[data-ai]').forEach(b => b.onclick = e => {
      e.preventDefault();
      const a = b.dataset.ai;
      if (a === 'close') toggle(false);
      if (a === 'clear') { state.history = []; render(); }
      if (a === 'quick') ask(quick[Number(b.dataset.i)][1]);
    });
    if (!state.busy) el.querySelector('#ai-q').focus();
  }

  async function ask(q) {
    if (!Store.remote) {
      state.history.push({ role: 'user', content: q }, { role: 'assistant', content: '**Ledger AI runs on your Ledger server.** Set `ANTHROPIC_API_KEY` on the server and I’ll answer using the open client’s reports, Metro 2 findings and dispute history.\n\nIn this preview I can’t reach the AI service.' });
      render(); return;
    }
    state.history.push({ role: 'user', content: q });
    state.busy = true; render();
    try {
      if (Store.remote.flushNow) await Store.remote.flushNow();
      const r = await root.App.api('POST', '/api/assistant', { clientId: state.clientId || null, history: state.history });
      state.history.push({ role: 'assistant', content: r.text + (r.truncated ? '\n\n_(Answer was cut short — ask me to continue.)_' : '') });
    } catch (e) {
      state.history.pop();
      toast(e.message);
    }
    state.busy = false; render();
  }

  function toggle(open, clientId) {
    state.open = open === undefined ? !state.open : open;
    if (state.open) {
      const cid = clientId !== undefined ? clientId : currentClientFromRoute();
      if (cid !== state.clientId && (cid || !state.history.length)) { state.clientId = cid; state.history = []; }
    }
    render();
  }

  root.Assistant = { toggle };
})(window);
