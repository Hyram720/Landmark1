/* Small DOM helpers shared by the views. */
(function (root) {
  'use strict';

  const esc = v => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (n === '' || n === null || n === undefined || Number.isNaN(Number(n))) ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const date = s => {
    if (!s) return '—';
    const d = new Date(String(s).length === 10 ? s + 'T00:00:00' : s);
    return Number.isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const ago = s => {
    const diff = (Date.now() - new Date(s).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + 'd ago';
    return date(s);
  };

  const I = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.7 3.5 2.9 3.5 6"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3 8 4.5 9 8 12 8zm0 0s1.5-5 4-3.5S15 8 12 8z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/>',
    download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>',
    upload: '<path d="M12 15V3m0 0L8 7m4-4 4 4M4 17v3h16v-3"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    pipeline: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="6" rx="1"/>'
  };
  const icon = (name, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${I[name] || ''}</svg>`;

  const SEV = { high: 'b-high', medium: 'b-med', low: 'b-low' };
  const sevBadge = s => `<span class="badge ${SEV[s] || 'b-low'}">${esc(s)}</span>`;
  const DSTATE = {
    draft: ['Draft', 'b-low'], ready: ['Approved', 'b-info'], sent: ['Awaiting response', 'b-accent'], overdue: ['Overdue', 'b-high'],
    deleted: ['Deleted', 'b-ok'], corrected: ['Corrected', 'b-ok'], verified: ['Verified', 'b-med'], frivolous: ['Frivolous notice', 'b-med'],
    no_response: ['No response', 'b-high'], closed: ['Closed', 'b-low'], blocked: ['Blocked (ID theft)', 'b-ok'], validated: ['Validated', 'b-med']
  };
  const dBadge = s => { const [l, c] = DSTATE[s] || [s, 'b-low']; return `<span class="badge ${c}">${esc(l)}</span>`; };
  const CSTATE = { lead: ['Lead', 'b-low'], onboarding: ['Onboarding', 'b-info'], active: ['Active', 'b-accent'], paused: ['Paused', 'b-med'], completed: ['Completed', 'b-ok'], cancelled: ['Cancelled', 'b-high'] };
  const cBadge = s => { const [l, c] = CSTATE[s] || [s, 'b-low']; return `<span class="badge ${c}">${esc(l)}</span>`; };

  let modalEl = null;
  function modal({ title, body, foot, wide, onSubmit, onOpen }) {
    close();
    const wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate>
      <div class="modal-h"><h2>${esc(title)}</h2><button type="button" class="btn ghost sm" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-b">${body}</div>
      <div class="modal-f">${foot || '<button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button>'}</div></form>`;
    document.body.appendChild(wrap);
    modalEl = wrap;
    const form = wrap.querySelector('form');
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = formData(form);
      const res = onSubmit ? onSubmit(data, form, e.submitter) : true;
      if (res !== false) close();
    });
    const first = form.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    if (onOpen) onOpen(form);
    return form;
  }
  function close() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  function formData(form) {
    const out = {};
    Array.from(form.elements).forEach(el => {
      if (!el.name) return;
      if (el.type === 'checkbox') {
        if (el.name.endsWith('[]')) { const k = el.name.slice(0, -2); out[k] = out[k] || []; if (el.checked) out[k].push(el.value); }
        else out[el.name] = el.checked;
      } else out[el.name] = el.value.trim();
    });
    return out;
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type: type || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }
  function printDoc(title, text) {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font:12pt/1.55 Georgia,'Times New Roman',serif;color:#000;margin:0}
      .page{max-width:6.5in;margin:0.9in auto;white-space:pre-wrap}
      @page{margin:0.75in}@media print{.page{margin:0}}</style></head><body><div class="page">${esc(text)}</div>
      <script>window.onload=()=>{window.print()}<\/script></body></html>`);
    w.document.close();
  }
  const field = (label, name, value, opts) => {
    opts = opts || {};
    const type = opts.type || 'text';
    const attrs = `name="${name}" ${opts.required ? 'required' : ''} ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''} ${opts.attrs || ''}`;
    let control;
    if (type === 'select') control = `<select ${attrs}>${opts.options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value === undefined ? '' : value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    else if (type === 'textarea') control = `<textarea ${attrs} ${opts.rows ? `rows="${opts.rows}"` : ''}>${esc(value)}</textarea>`;
    else control = `<input type="${type}" value="${esc(value === undefined ? '' : value)}" ${attrs}>`;
    return `<label class="field ${opts.cls || ''}"><span>${esc(label)}</span>${control}${opts.help ? `<small>${esc(opts.help)}</small>` : ''}</label>`;
  };

  root.UI = { esc, money, date, ago, icon, sevBadge, dBadge, cBadge, DSTATE, CSTATE, modal, close, formData, toast, download, printDoc, field };
})(typeof window !== 'undefined' ? window : globalThis);
