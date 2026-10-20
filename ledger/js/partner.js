/* Referral partner portal: referral link, referred clients (progress only with client consent) and commissions. */
(function () {
  'use strict';
  const { esc, date, field, toast, money } = UI;
  const root = document.getElementById('portal');
  const STAGE = { new: 'New lead', contacted: 'Contacted', consult: 'Consultation booked', analysis: 'Analysis sent', agreement: 'Agreement sent', won: 'Enrolled', lost: 'Not now' };

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
    if (!r.ok) throw new Error((data && data.error) || 'Something went wrong');
    return data;
  }

  function authForm(mode, invite) {
    root.innerHTML = `<form class="card" id="auth" style="max-width:420px;margin:6vh auto"><div class="card-b stack">
      <h1>${mode === 'invite' ? 'Set up your partner access' : mode === 'reset' ? 'Choose a new password' : 'Partner sign in'}</h1>
      ${mode === 'invite' ? '<p class="small muted">Choose a password to finish creating your account.</p>' : mode === 'reset' ? '<p class="small muted">Choose a new password. This signs you out everywhere else.</p>' : field('Email', 'email', '', { type: 'email', required: true })}
      ${field('Password', 'password', '', { type: 'password', required: true, help: mode !== 'login' ? 'At least 10 characters' : '' })}
      <div id="err" class="small" style="color:var(--high)"></div><button class="btn primary" style="width:100%">${mode === 'invite' ? 'Create account' : 'Sign in'}</button></div></form>`;
    document.getElementById('auth').addEventListener('submit', async e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      try {
        if (mode === 'invite') await api('POST', '/api/invites/accept', { token: invite, password: d.password });
        else if (mode === 'reset') await api('POST', '/api/auth/reset', { token: invite, password: d.password });
        else {
          const r = await api('POST', '/api/login', d);
          // Optional emailed sign-in code (Settings → sign-in security).
          if (r && r.otpRequired) { const code = window.prompt((r.message || 'We emailed you a code.') + ' Enter the 6-digit code:'); if (!code) return; await api('POST', '/api/auth/otp', { code: code.trim() }); }
        }
        location.hash = ''; location.reload();
      } catch (err) { document.getElementById('err').textContent = err.message; }
    });
  }

  function render(me) {
    document.getElementById('co-name').textContent = (me.company.name || 'Partner') + ' — Partner Portal';
    const k = me.commission;
    const enrolled = me.clients.filter(c => c.stage === 'won').length;
    root.innerHTML = `<div class="page-head"><div><h1>Welcome, ${esc(me.partner.name.split(' ')[0])}</h1><p>${esc(me.partner.company)}</p></div></div>
      <div class="stack">
      <section class="card"><div class="card-h"><div><h2>Your referral link</h2><p>Share it with anyone who needs help with their credit. Sign-ups through this link are credited to you.</p></div></div><div class="card-b row" style="flex-wrap:nowrap"><input readonly value="${esc(me.link)}" id="ref-link" class="mono small"><button class="btn primary" id="copy">Copy</button></div></section>
      <div class="grid g4"><div class="card kpi"><div class="label">Referred</div><div class="value">${me.clients.length}</div></div><div class="card kpi"><div class="label">Enrolled</div><div class="value">${enrolled}</div></div><div class="card kpi"><div class="label">Commission earned</div><div class="value">${money(k.earned)}</div></div><div class="card kpi"><div class="label">Owed to you</div><div class="value">${money(k.owed)}</div><div class="sub">${money(k.paid)} paid so far</div></div></div>
      <section class="card"><div class="card-h"><div><h2>Your referrals</h2><p>Progress details appear only for clients who agreed to share them with you.</p></div></div><div class="card-b flush">${me.clients.length ? `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Stage</th><th>Joined</th><th>Progress</th></tr></thead><tbody>${me.clients.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(STAGE[c.stage] || c.stage)}</td><td>${date(c.joinedAt)}</td><td class="small">${c.progress ? `${c.progress.lettersMailed} letters mailed · ${c.progress.removed} items removed or corrected · ${c.progress.inProgress} in progress` : '<span class="muted">Private</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small" style="padding:16px">No referrals yet — share your link to get started.</p>'}</div></section>
      <section class="card"><div class="card-h"><div><h2>Commission</h2><p>${esc(k.terms || (k.type === 'flat' ? money(k.amount) + ' per enrolled client' : k.type === 'percent' ? k.amount + '% of paid invoices' : 'No commission arrangement on file'))}</p></div></div><div class="card-b flush">${k.payouts.length ? `<ul class="list">${k.payouts.map(p => `<li><div class="grow"><b>${money(p.amount)}</b> paid<div class="meta">${date(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</div></div></li>`).join('')}</ul>` : '<p class="muted small" style="padding:16px">No payouts yet.</p>'}</div></section>
      <p class="small muted">Questions? ${esc([me.company.phone, me.company.email].filter(Boolean).join(' · '))}. Client information is shared only with each client’s permission.</p></div>`;
    document.getElementById('copy').onclick = () => { const i = document.getElementById('ref-link'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.resolve(document.execCommand('copy'))).then(() => toast('Link copied')); };
  }

  async function boot() {
    let s = null;
    try { s = await api('GET', '/api/session'); } catch (e) { /* preview */ }
    if (!s || s.mode !== 'server') { root.innerHTML = '<div class="callout"><b>Preview</b>The partner portal runs on the Ledger server.</div>'; return; }
    const invite = (location.hash.match(/invite=([\w-]+)/) || [])[1];
    const reset = (location.hash.match(/reset=([\w-]+)/) || [])[1];
    if (reset) return authForm('reset', reset);
    if (invite && !s.user) return authForm('invite', invite);
    if (!s.user) return authForm('login');
    if (s.user.role !== 'partner') { location.href = s.user.role === 'client' ? '/portal' : '/'; return; }
    document.getElementById('portal-user').innerHTML = `<span class="small" style="color:var(--side-ink)">${esc(s.user.email)}</span><button class="btn sm" id="logout">Sign out</button>`;
    document.getElementById('logout').onclick = async () => { await api('POST', '/api/logout'); location.reload(); };
    try { render(await api('GET', '/api/partner/me')); } catch (e) { root.innerHTML = `<div class="callout bad"><b>We couldn’t load your account</b>${esc(e.message)}</div>`; }
  }
  boot();
})();
