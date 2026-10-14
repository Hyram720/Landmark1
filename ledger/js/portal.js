/* Client portal: e-sign CROA documents, follow disputes and scores, see recommendations. */
(function () {
  'use strict';
  const { esc, date, field, toast, DSTATE } = UI;
  const root = document.getElementById('portal');

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
    if (!r.ok) { const e = new Error((data && data.error) || 'Something went wrong'); e.status = r.status; throw e; }
    return data;
  }

  function authForm(mode, invite) {
    root.innerHTML = `<form class="card" id="auth" style="max-width:420px;margin:6vh auto"><div class="card-b stack">
      <h1>${mode === 'invite' ? 'Set up your portal access' : 'Sign in to your portal'}</h1>
      ${mode === 'invite' ? '<p class="small muted">Choose a password to finish creating your account.</p>' : field('Email', 'email', '', { type: 'email', required: true })}
      ${field('Password', 'password', '', { type: 'password', required: true, help: mode === 'invite' ? 'At least 10 characters' : '' })}
      <div id="err" class="small" style="color:var(--high)"></div><button class="btn primary" style="width:100%">${mode === 'invite' ? 'Create account' : 'Sign in'}</button></div></form>`;
    document.getElementById('auth').addEventListener('submit', async e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      try {
        if (mode === 'invite') await api('POST', '/api/invites/accept', { token: invite, password: d.password });
        else await api('POST', '/api/login', d);
        location.hash = ''; location.reload();
      } catch (err) { document.getElementById('err').textContent = err.message; }
    });
  }

  function signBlock(title, doc, text, signed, locked, name) {
    return `<section class="card"><div class="card-h"><div><h2>${esc(title)}</h2><p>${signed ? 'Signed electronically' : locked ? 'Sign the rights statement first' : 'Please read, then sign'}</p></div>${signed ? '<span class="badge b-ok">Signed</span>' : ''}</div><div class="card-b stack">
      <div class="doc-box">${esc(text)}</div>
      ${signed || locked ? '' : `<form data-sign="${doc}" class="stack"><label class="check small"><input type="checkbox" name="agree"> I agree to sign electronically. Typing my name below is my signature.</label>
        <div class="row" style="flex-wrap:nowrap">${field('Type your full name', 'typedName', '', { placeholder: name })}<button class="btn primary" style="align-self:flex-end">Sign</button></div></form>`}
    </div></section>`;
  }

  function render(me) {
    document.getElementById('co-name').textContent = me.company.name || 'Client Portal';
    const cr = me.croa;
    const scoreRows = Object.entries(me.scores).map(([b, arr]) => { const last = arr[arr.length - 1], first = arr[0], dlt = last.score - first.score; return `<div class="card kpi"><div class="label">${esc(b)}</div><div class="value">${last.score}</div><div class="sub">${arr.length > 1 ? `<span class="${dlt >= 0 ? 'delta-up' : 'delta-down'}">${dlt >= 0 ? '+' : ''}${dlt}</span> since ${date(first.date)}` : 'as of ' + date(last.date)}</div></div>`; }).join('');
    const disputes = me.disputes.length ? `<ul class="list">${me.disputes.map(d => { const [l, c] = DSTATE[d.state] || [d.state, 'b-low']; return `<li><div class="grow"><b>${esc(d.recipient)}</b> · ${esc(d.type)} · round ${d.round}<div class="meta">${esc(d.items.join(', '))}${d.sentAt ? ' · mailed ' + date(d.sentAt) : ''}${d.dueAt && !d.respondedAt ? ' · response due ' + date(d.dueAt) : ''}</div></div><span class="badge ${c}">${esc(l)}</span></li>`; }).join('')}</ul>` : '<p class="muted small" style="padding:16px">No disputes have been sent yet.</p>';
    const recs = me.recommendations.length ? `<ul class="list">${me.recommendations.map(r => `<li><div class="grow"><b>${esc(r.name)}</b> <span class="small muted">${esc(r.category || '')}</span><div class="small">${esc(r.why || '')}</div></div><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener sponsored">Learn more ↗</a></li>`).join('')}</ul><p class="small muted" style="padding:0 18px 14px">${esc(me.referralDisclosure)}</p>` : '<p class="muted small" style="padding:16px">No recommendations yet.</p>';

    root.innerHTML = `<div class="page-head"><div><h1>Welcome, ${esc(me.client.name.split(' ')[0])}</h1><p>${me.company.phone || me.company.email ? 'Questions? ' + esc([me.company.phone, me.company.email].filter(Boolean).join(' · ')) : ''}</p></div></div>
      ${cr.required && cr.inWindow ? `<div class="callout" style="margin-bottom:16px"><b>You can cancel until midnight ${date(cr.deadline)}</b>Cancel for any reason, without penalty, before then. No work starts and no fees are charged until this period ends. <button class="btn sm danger" data-cancel style="margin-left:8px">Cancel my agreement</button></div>` : ''}
      ${cr.cancelled ? '<div class="callout bad" style="margin-bottom:16px"><b>Your agreement is cancelled</b>We will refund any payment you made.</div>' : ''}
      <div class="stack">
      ${cr.required ? `${signBlock('Consumer Credit File Rights Under State and Federal Law', 'disclosure', me.documents.disclosure, cr.disclosureSigned, false, me.client.name)}
        ${signBlock('Credit services agreement', 'contract', me.documents.contract + '\n\n' + me.documents.cancellation, cr.contractSigned, !cr.disclosureSigned, me.client.name)}` : ''}
      ${scoreRows ? `<div class="grid g3">${scoreRows}</div>` : ''}
      <section class="card"><div class="card-h"><div><h2>Your documents</h2><p>Upload a photo ID, proof of address, and any letters you get from the bureaus</p></div></div><div class="card-b stack">
        ${me.uploads.length ? `<ul class="list" style="margin:-16px -18px 0">${me.uploads.map(u => `<li><div class="grow"><b>${esc(u.name)}</b><div class="meta">${esc(u.type)} · ${date(u.uploadedAt)}</div></div><a class="btn sm" href="/api/files/${u.id}">Download</a></li>`).join('')}</ul>` : ''}
        <form id="up" class="row" style="flex-wrap:wrap"><select name="type" style="width:auto"><option value="id">Photo ID</option><option value="address">Proof of address</option><option value="bureau-response">Letter from a bureau or creditor</option><option value="report">Credit report</option></select><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style="width:auto;flex:1"><button class="btn primary">Upload</button></form></div></section>
      <section class="card"><div class="card-h"><h2>Your disputes</h2></div><div class="card-b flush">${disputes}</div></section>
      ${me.business ? `<section class="card"><div class="card-h"><h2>Business credit${me.business.name ? ' — ' + esc(me.business.name) : ''}</h2></div><div class="card-b small">${Object.keys(me.business.checklist).length} foundation items complete. ${me.business.scores.length ? 'Latest scores: ' + me.business.scores.slice(-3).map(s => esc(s.model) + ' ' + esc(s.score)).join(' · ') : ''}</div></section>` : ''}
      <section class="card"><div class="card-h"><div><h2>Recommended for you</h2><p>Optional products that may help your goals</p></div></div><div class="card-b flush">${recs}</div></section>
      <p class="small muted">You have the right to dispute inaccurate information with the credit bureaus yourself, for free. Accurate, current and verifiable information cannot be removed. Results are not guaranteed.</p>
      </div>`;

    root.querySelectorAll('[data-sign]').forEach(f => f.addEventListener('submit', async e => {
      e.preventDefault();
      const d = UI.formData(f);
      try { await api('POST', '/api/portal/sign', { doc: f.dataset.sign, typedName: d.typedName, agree: d.agree }); toast('Signed — thank you'); load(); } catch (err) { toast(err.message); }
    }));
    document.getElementById('up').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target; if (!f.elements.file.files[0]) return toast('Choose a file');
      const fd = new FormData(); fd.append('type', f.elements.type.value); fd.append('file', f.elements.file.files[0]);
      const r = await fetch('/api/portal/files', { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json(); if (!r.ok) return toast(j.error); toast('Uploaded — thank you'); load();
    });
    const cancel = root.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = async () => { if (!confirm('Cancel your agreement? This cannot be undone here.')) return; await api('POST', '/api/portal/cancel'); load(); };
  }

  async function load() {
    try { render(await api('GET', '/api/portal/me')); } catch (e) { root.innerHTML = `<div class="callout bad"><b>We couldn’t load your file</b>${esc(e.message)}</div>`; }
  }

  async function boot() {
    let s = null;
    try { s = await api('GET', '/api/session'); } catch (e) { /* preview */ }
    if (!s || s.mode !== 'server') { root.innerHTML = '<div class="callout"><b>Preview</b>The client portal runs on the Ledger server (<span class="mono">npm run ledger</span>).</div>'; return; }
    const invite = (location.hash.match(/invite=([\w-]+)/) || [])[1];
    if (invite && !s.user) return authForm('invite', invite);
    if (!s.user) return authForm('login');
    if (s.user.role !== 'client') { location.href = '/'; return; }
    document.getElementById('portal-user').innerHTML = `<span class="small" style="color:var(--side-ink)">${esc(s.user.email)}</span><button class="btn sm" id="logout">Sign out</button>`;
    document.getElementById('logout').onclick = async () => { await api('POST', '/api/logout'); location.reload(); };
    load();
  }
  boot();
})();
