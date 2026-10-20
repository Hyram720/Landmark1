/*
 * Website / portal helper ("Questions?"). Answers come from the server: the canned FAQ when AI
 * is off, or the grounded AI helper when the owner turned it on. It never sees anyone's credit
 * file, never asks for SSNs, account numbers or passwords, and hands off to staff.
 */
(function () {
  'use strict';
  const page = document.body.dataset.helper || (location.pathname.startsWith('/portal') ? 'portal' : 'apply');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const QUICK = page === 'portal'
    ? ['What documents should I upload?', 'How long do bureaus take to respond?', 'How do I cancel?', 'When am I charged?']
    : ['What happens after I submit?', 'Do you charge upfront?', 'Can I dispute on my own for free?', 'Can you guarantee results?'];
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn primary helper-fab'; btn.textContent = 'Questions?';
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'helper-panel');
  const panel = document.createElement('section');
  panel.id = 'helper-panel'; panel.className = 'helper-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Help');
  panel.innerHTML = `<div class="row between" style="padding:10px 12px;border-bottom:1px solid var(--border)"><b>How can we help?</b><button type="button" class="btn ghost sm" data-x aria-label="Close help">✕</button></div>
    <div class="helper-log" id="helper-log" aria-live="polite"><div class="bot">Hi! I can explain the form, which documents to upload, dispute timelines and your rights. I give general information, not legal advice. Please don’t type your Social Security number, date of birth, account numbers or passwords.</div>
    <div class="row" style="flex-wrap:wrap;gap:6px">${QUICK.map(q => `<button type="button" class="btn sm ghost" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>
    <form class="helper-form" id="helper-form"><label class="sr-only" for="helper-q">Your question</label><input id="helper-q" maxlength="800" autocomplete="off" placeholder="Type a question…"><button class="btn primary">Send</button></form>`;
  document.body.appendChild(btn); document.body.appendChild(panel);
  const log = panel.querySelector('#helper-log'), input = panel.querySelector('#helper-q');
  const toggle = open => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) input.focus(); };
  btn.onclick = () => toggle(panel.hidden);
  panel.querySelector('[data-x]').onclick = () => { toggle(false); btn.focus(); };
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { toggle(false); btn.focus(); } });
  async function ask(q) {
    log.insertAdjacentHTML('beforeend', `<div class="me">${esc(q)}</div>`);
    const wait = document.createElement('div'); wait.className = 'bot muted'; wait.textContent = '…'; log.appendChild(wait); log.scrollTop = log.scrollHeight;
    try {
      const r = await fetch('/api/assistant/public', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q, page }) });
      const j = await r.json();
      wait.className = 'bot'; wait.textContent = (j.text || j.error || 'Sorry, something went wrong.').replace(/\s?\[[a-z0-9-]+\]/g, '');
    } catch { wait.className = 'bot'; wait.textContent = 'The helper is offline. Please use the form or call us.'; }
    log.scrollTop = log.scrollHeight;
  }
  panel.querySelectorAll('[data-q]').forEach(b => b.onclick = () => ask(b.dataset.q));
  panel.querySelector('#helper-form').addEventListener('submit', e => { e.preventDefault(); const q = input.value.trim(); if (q) { input.value = ''; ask(q); } });
})();
