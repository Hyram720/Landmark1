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

  // Sign-in screens: password (+ optional emailed code), forgot/reset, invite, and magic link.
  let options = { magicLink: false };
  function authForm(mode, token, note) {
    const titles = { invite: 'Set up your portal access', login: 'Sign in to your portal', forgot: 'Reset your password', reset: 'Choose a new password', otp: 'Enter your sign-in code', magic: 'Email me a sign-in link' };
    const fields = {
      invite: field('Password', 'password', '', { type: 'password', required: true, help: 'At least 10 characters' }),
      login: field('Email', 'email', '', { type: 'email', required: true }) + field('Password', 'password', '', { type: 'password', required: true }),
      forgot: field('Email', 'email', '', { type: 'email', required: true, help: 'We’ll email a reset link that works once and expires in 30 minutes.' }),
      magic: field('Email', 'email', '', { type: 'email', required: true, help: 'We’ll email a sign-in link that works once and expires in 15 minutes.' }),
      reset: field('New password', 'password', '', { type: 'password', required: true, help: 'At least 10 characters. This signs you out everywhere else.' }),
      otp: field('6-digit code', 'code', '', { required: true, help: 'Check your email. The code expires in 10 minutes.' })
    };
    const button = { invite: 'Create account', login: 'Sign in', forgot: 'Send reset link', reset: 'Save password', otp: 'Verify', magic: 'Send sign-in link' }[mode];
    root.innerHTML = `<form class="card" id="auth" style="max-width:420px;margin:6vh auto" novalidate><div class="card-b stack">
      <h1>${titles[mode]}</h1>${note ? `<p class="small">${esc(note)}</p>` : mode === 'invite' ? '<p class="small muted">Choose a password to finish creating your account.</p>' : ''}
      ${fields[mode]}
      <div id="err" class="small" role="alert" style="color:var(--high)"></div><button class="btn primary" style="width:100%">${button}</button>
      ${mode === 'login' ? `<div class="row between small"><a href="#" data-mode="forgot">Forgot password?</a>${options.magicLink ? '<a href="#" data-mode="magic">Email me a sign-in link</a>' : ''}</div>` : ['forgot', 'magic', 'otp'].includes(mode) ? '<div class="small"><a href="#" data-mode="login">Back to sign in</a></div>' : ''}
      </div></form>`;
    root.querySelectorAll('[data-mode]').forEach(a => a.onclick = e => { e.preventDefault(); authForm(a.dataset.mode); });
    const f = document.getElementById('auth');
    if (f.elements[0]) f.elements[0].focus();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const d = UI.formData(e.target), err = document.getElementById('err');
      try {
        if (mode === 'invite') await api('POST', '/api/invites/accept', { token, password: d.password });
        else if (mode === 'login') { const r = await api('POST', '/api/login', d); if (r && r.otpRequired) return authForm('otp', null, r.message); }
        else if (mode === 'otp') await api('POST', '/api/auth/otp', { code: d.code });
        else if (mode === 'forgot') { const r = await api('POST', '/api/auth/forgot', { email: d.email }); return authForm('login', null, r.message); }
        else if (mode === 'magic') { const r = await api('POST', '/api/auth/magic', { email: d.email }); return authForm('login', null, r.message); }
        else if (mode === 'reset') await api('POST', '/api/auth/reset', { token, password: d.password });
        location.hash = ''; location.reload();
      } catch (ex) { err.textContent = ex.message; }
    });
  }

  // Bureau response clock: 30 days from receipt (45 if extended), shown as a bar.
  function deadline(d) {
    if (!d.sentAt || d.respondedAt || !d.dueAt) return '';
    const start = new Date(d.receivedAt || d.sentAt), end = new Date(d.dueAt), now = new Date();
    const total = Math.max(1, (end - start) / 86400000), used = Math.min(total, Math.max(0, (now - start) / 86400000));
    const left = Math.ceil((end - now) / 86400000);
    return `<div class="small" style="margin-top:4px">${left >= 0 ? `Response due in <b>${left} day${left === 1 ? '' : 's'}</b> (${date(d.dueAt)})` : `<b style="color:var(--high)">Response is ${-left} day${left === -1 ? '' : 's'} late</b> — we’ll follow up`} · bureaus generally have 30 days, up to 45 in some cases</div><div class="deadline-bar ${left < 0 ? 'late' : ''}" role="progressbar" aria-label="Time used of the response period" aria-valuemin="0" aria-valuemax="${Math.round(total)}" aria-valuenow="${Math.round(used)}"><span style="width:${Math.round(used / total * 100)}%"></span></div>`;
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
    const disputes = me.disputes.length ? `<ul class="list">${me.disputes.map(d => { const [l, c] = DSTATE[d.state] || [d.state, 'b-low']; return `<li><div class="grow"><b>${esc(d.recipient)}</b> · ${esc(d.type)} · round ${d.round}<div class="meta">${esc(d.items.join(', '))}${d.sentAt ? ' · mailed ' + date(d.sentAt) : ' · being prepared'}${d.respondedAt ? ' · response received ' + date(d.respondedAt) : ''}</div>${deadline(d)}</div><span class="badge ${c}">${esc(l)}</span></li>`; }).join('')}</ul>` : '<p class="muted small" style="padding:16px">No disputes have been sent yet.</p>';
    const history = Object.entries(me.scores).filter(([, arr]) => arr.length > 1).map(([b, arr]) => `<div class="small"><b>${esc(b)}</b>: ${arr.map(x => `${x.score} <span class="muted">(${date(x.date)})</span>`).join(' → ')}</div>`).join('');
    const recs = me.recommendations.length ? `<ul class="list">${me.recommendations.map(r => `<li><div class="grow"><b>${esc(r.name)}</b> <span class="small muted">${esc(r.category || '')}</span><div class="small">${esc(r.why || '')}</div></div><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener sponsored">Learn more ↗</a></li>`).join('')}</ul><p class="small muted" style="padding:0 18px 14px"><b>Affiliate links</b> — we may earn a commission if you sign up. ${esc(me.referralDisclosure)}</p>` : '<p class="muted small" style="padding:16px">No recommendations yet.</p>';

    root.innerHTML = `<div class="page-head"><div><h1>Welcome, ${esc(me.client.name.split(' ')[0])}</h1><p>${me.company.phone || me.company.email ? 'Questions? ' + esc([me.company.phone, me.company.email].filter(Boolean).join(' · ')) : ''}</p></div></div>
      ${cr.required && cr.inWindow ? `<div class="callout" style="margin-bottom:16px"><b>You can cancel until midnight ${date(cr.deadline)}</b>Cancel for any reason, without penalty, before then. No work starts and no fees are charged until this period ends. <button class="btn sm danger" data-cancel style="margin-left:8px">Cancel my agreement</button></div>` : ''}
      ${cr.cancelled ? '<div class="callout bad" style="margin-bottom:16px"><b>Your agreement is cancelled</b>We will refund any payment you made.</div>' : ''}
      <div class="stack">
      ${cr.required ? `${signBlock('Consumer Credit File Rights Under State and Federal Law', 'disclosure', me.documents.disclosure, cr.disclosureSigned, false, me.client.name)}
        ${signBlock('Credit services agreement', 'contract', me.documents.contract + '\n\n' + me.documents.cancellation, cr.contractSigned, !cr.disclosureSigned, me.client.name)}` : ''}
      ${scoreRows ? `<section class="card"><div class="card-h"><div><h2>Score movement</h2><p>From the reports on your file. Scores vary by model and bureau and can go up or down.</p></div></div><div class="card-b stack"><div class="grid g3">${scoreRows}</div>${history}</div></section>` : ''}
      ${me.wins && me.wins.length ? `<section class="card"><div class="card-h"><div><h2>🎉 Results so far</h2><p>${me.wins.length} item(s) removed or corrected</p></div></div><div class="card-b flush"><ul class="list">${me.wins.map(w => `<li><span class="badge ${w.result === 'deleted' ? 'b-ok' : 'b-info'}">${w.result === 'deleted' ? 'Removed' : 'Corrected'}</span><div class="grow"><b>${esc(w.creditor)}</b> · ${esc(w.bureau)}<div class="meta">${w.at ? date(w.at) : ''}</div></div></li>`).join('')}</ul></div></section>` : ''}
      <section class="card"><div class="card-h"><div><h2>Your documents</h2><p>Upload a photo ID, proof of address, and any letters you get from the bureaus</p></div></div><div class="card-b stack">
        ${me.uploads.length ? `<ul class="list" style="margin:-16px -18px 0">${me.uploads.map(u => `<li><div class="grow"><b>${esc(u.name)}</b><div class="meta">${esc(u.type)} · ${date(u.uploadedAt)}</div></div><a class="btn sm" href="/api/files/${u.id}">Download</a></li>`).join('')}</ul>` : ''}
        <form id="up" class="row" style="flex-wrap:wrap"><select name="type" style="width:auto"><option value="id">Photo ID</option><option value="address">Proof of address</option><option value="bureau-response">Letter from a bureau or creditor</option><option value="report">Credit report</option></select><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style="width:auto;flex:1"><button class="btn primary">Upload</button></form></div></section>
      <section class="card"><div class="card-h"><h2>Your disputes</h2></div><div class="card-b flush">${disputes}</div></section>
      ${me.business ? `<section class="card"><div class="card-h"><h2>Business credit${me.business.name ? ' — ' + esc(me.business.name) : ''}</h2></div><div class="card-b small">${Object.keys(me.business.checklist).length} foundation items complete. ${me.business.scores.length ? 'Latest scores: ' + me.business.scores.slice(-3).map(s => esc(s.model) + ' ' + esc(s.score)).join(' · ') : ''}</div></section>` : ''}
      <section class="card"><div class="card-h"><div><h2>Recommended for you</h2><p>Optional products that may help your goals</p></div></div><div class="card-b flush">${recs}</div></section>
      <section class="card"><div class="card-h"><div><h2>Email updates</h2><p>We can email you when a bureau responds, an item is removed or corrected, or a deadline is near. Emails never include account details.</p></div></div><div class="card-b"><label class="check small"><input type="checkbox" id="notify" ${me.notify && me.notify.email ? 'checked' : ''} ${me.notify && me.notify.available ? '' : 'disabled'}> Email me about updates to my file${me.notify && !me.notify.available ? ' (not available yet)' : ''}</label></div></section>
      <section class="card"><div class="card-h"><h2>Your rights</h2></div><div class="card-b small stack" style="gap:6px">
        <p>You have the right to dispute inaccurate information with the credit bureaus yourself, for free, and to get free credit reports at <a href="https://www.annualcreditreport.com/" target="_blank" rel="noopener">AnnualCreditReport.com</a>.</p>
        <p>Accurate, current and verifiable information can’t be removed, and we don’t promise any particular result or score change.</p>
        <p>We never charge for a service before it has been fully performed, and nothing is charged during your 3-business-day cancellation period. Partner products are optional and never required to work with us.</p>
        <p class="muted">We aren’t a law firm and don’t give legal advice.</p></div></section>
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
    const nt = document.getElementById('notify');
    if (nt) nt.onchange = async () => { try { await api('PUT', '/api/portal/notifications', { email: nt.checked }); toast(nt.checked ? 'Email updates on' : 'Email updates off'); } catch (e) { toast(e.message); nt.checked = !nt.checked; } };
    const cancel = root.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = async () => { if (!UI.ask('Cancel your agreement? This cannot be undone here.')) return; await api('POST', '/api/portal/cancel'); load(); };
  }

  async function load() {
    try { const me = await api('GET', '/api/portal/me'); try { me.notify = await api('GET', '/api/portal/notifications'); } catch { me.notify = null; } render(me); } catch (e) { root.innerHTML = `<div class="callout bad"><b>We couldn’t load your file</b>${esc(e.message)}</div>`; }
  }

  async function boot() {
    let s = null;
    try { s = await api('GET', '/api/session'); } catch (e) { /* preview */ }
    if (!s || s.mode !== 'server') { root.innerHTML = '<div class="callout"><b>Preview</b>The client portal runs on the Ledger server (<span class="mono">npm run ledger</span>).</div>'; return; }
    try { options = await api('GET', '/api/auth/options'); } catch { /* defaults */ }
    const invite = (location.hash.match(/invite=([\w-]+)/) || [])[1];
    const reset = (location.hash.match(/reset=([\w-]+)/) || [])[1];
    const magic = (location.hash.match(/magic=([\w-]+)/) || [])[1];
    if (reset) return authForm('reset', reset);
    if (magic && !s.user) { try { await api('POST', '/api/auth/magic/verify', { token: magic }); location.hash = ''; location.reload(); } catch (e) { authForm('login', null, e.message); } return; }
    if (invite && !s.user) return authForm('invite', invite);
    if (!s.user) return authForm('login');
    if (s.user.role !== 'client') { location.href = s.user.role === 'partner' ? '/partner' : '/'; return; }
    document.getElementById('portal-user').innerHTML = `<span class="small" style="color:var(--side-ink)">${esc(s.user.email)}</span><button class="btn sm" id="logout">Sign out</button>`;
    document.getElementById('logout').onclick = async () => { await api('POST', '/api/logout'); location.reload(); };
    load();
  }
  boot();
})();
