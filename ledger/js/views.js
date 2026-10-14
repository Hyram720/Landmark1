/* Page renderers. Each returns an HTML string; actions are wired by data-act attributes in app.js. */
(function (root) {
  'use strict';
  const { Store, Metro2, Law, UI } = root;
  const { esc, money, date, ago, icon, sevBadge, dBadge, cBadge } = UI;
  const S = () => Store.state;
  const T = () => Store.today();

  // ---------- derived data ----------
  const MONEY_FIELDS = ['balance', 'pastDue', 'limit'];
  function clientFindings(cid) {
    const reports = Store.get.latestByBureau(cid);
    const merged = {};
    reports.forEach(r => Metro2.auditReport(r).forEach(f => {
      const t = r.accounts.find(a => a.id === f.accountId) || {};
      const key = f.code + '|' + Metro2.matchKey(t);
      const target = { bureau: r.bureau, reportId: r.id, accountId: f.accountId, accountNumber: t.accountNumber || '', evidence: t.evidence || '', issue: t.issue || '', detail: f.detail };
      if (merged[key]) { merged[key].targets.push(target); merged[key].bureau += ' / ' + r.bureau; }
      else merged[key] = Object.assign({}, f, { targets: [target] });
    }));
    const out = Object.values(merged);
    Metro2.compareBureaus(reports).filter(g => g.differences.length).forEach(g => {
      const detail = g.differences.map(d => `${d.label}: ` + Object.entries(d.values).map(([b, v]) => `${b} ${v === '' ? '—' : MONEY_FIELDS.includes(d.field) ? money(v) : v}`).join(', ')).join('; ') + '. The same account cannot be accurate with different values at each bureau.';
      out.push({
        code: 'XB-MISMATCH', severity: g.differences.some(d => ['status', 'balance', 'dofd', 'pastDue'].includes(d.field)) ? 'high' : 'medium',
        title: 'Reported differently across bureaus', creditor: g.creditor, bureau: g.bureaus.join(' / '), detail,
        fields: g.differences.map(d => d.label), basis: 'FCRA § 607(b) maximum possible accuracy; § 611', action: 'Dispute the inconsistent values',
        targets: g.bureaus.map(b => ({ bureau: b, reportId: g.byBureau[b].reportId, accountId: g.byBureau[b].id, accountNumber: g.byBureau[b].accountNumber || '', evidence: g.byBureau[b].evidence || '', issue: '', detail }))
      });
    });
    const order = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  function openDisputes() { return S().disputes.filter(d => !d.outcome && d.status !== 'closed'); }

  function alerts() {
    const out = [];
    const t = T();
    S().clients.forEach(c => {
      if (['lead', 'cancelled', 'completed'].includes(c.status)) return;
      const cs = Store.croaStatus(c);
      const link = `#/clients/${c.id}/compliance`;
      if (!cs.required) return;
      if (!c.onboarding || !c.onboarding.disclosureSignedAt) out.push({ sev: 'high', text: `${c.name}: rights disclosure (§ 1679c) not recorded`, link });
      if (!cs.disclosureOrder) out.push({ sev: 'high', text: `${c.name}: disclosure was acknowledged after the contract was signed`, link });
      if (cs.inWindow) out.push({ sev: 'low', text: `${c.name}: cancellation period open until ${date(cs.deadline)} — no services or billing yet`, link });
      const early = S().disputes.filter(d => d.clientId === c.id && ['ready', 'sent'].includes(d.status) && !cs.cleared);
      if (early.length) out.push({ sev: 'high', text: `${c.name}: ${early.length} dispute(s) approved or sent before onboarding cleared`, link: `#/clients/${c.id}/disputes` });
    });
    S().invoices.filter(i => i.status !== 'void' && i.status !== 'draft').forEach(i => {
      const c = Store.get.client(i.clientId);
      if (!c) return;
      const cs = Store.croaStatus(c);
      if (!i.serviceCompletedAt || (cs.deadline && i.serviceCompletedAt <= cs.deadline) || (i.issuedAt && i.issuedAt < i.serviceCompletedAt)) {
        out.push({ sev: 'high', text: `${c.name}: invoice “${i.description}” billed before the service was complete (§ 1679b(b))`, link: '#/billing' });
      }
    });
    openDisputes().forEach(d => {
      if (d.status === 'sent' && d.dueAt && t > d.dueAt) {
        const c = Store.get.client(d.clientId);
        out.push({ sev: 'high', text: `${c ? c.name : 'Client'}: ${d.recipient} response overdue since ${date(d.dueAt)}`, link: `#/disputes/${d.id}` });
      }
    });
    S().disputes.filter(d => d.status === 'draft').forEach(d => {
      const r = repeatRisk(d);
      if (r.length) out.push({ sev: 'medium', text: `Round ${d.round} to ${d.recipient} repeats a verified dispute with no new evidence`, link: `#/disputes/${d.id}` });
    });
    const order = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => order[a.sev] - order[b.sev]);
  }

  /** Items in `d` already disputed with the same recipient, verified, and re-sent without new evidence. */
  function repeatRisk(d) {
    const prior = S().disputes.filter(p => p.id !== d.id && p.clientId === d.clientId && p.recipient === d.recipient && p.outcome === 'verified' && p.type === d.type);
    const risks = [];
    d.items.forEach(it => prior.forEach(p => p.items.forEach(pi => {
      const same = (it.accountId && pi.accountId === it.accountId) || (pi.creditor === it.creditor && (pi.accountNumber || '') === (it.accountNumber || ''));
      if (same && (it.evidence || '') === (pi.evidence || '')) risks.push({ item: it, prior: p });
    })));
    return risks;
  }

  // ---------- shared fragments ----------
  const head = (title, sub, actions, crumbs) => `<div class="page-head"><div>${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row">${actions || ''}</div></div>`;
  const card = (title, body, opts) => { opts = opts || {}; return `<section class="card ${opts.cls || ''}">${title ? `<div class="card-h"><div><h2>${title}</h2>${opts.sub ? `<p>${opts.sub}</p>` : ''}</div><div class="row">${opts.actions || ''}</div></div>` : ''}<div class="card-b ${opts.flush ? 'flush' : ''}">${body}</div></section>`; };
  const kpi = (label, value, sub, cls) => `<div class="card kpi ${cls || ''}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const empty = (title, text, action) => `<div class="empty"><h3>${title}</h3><p>${text}</p>${action || ''}</div>`;
  const clientName = id => { const c = Store.get.client(id); return c ? esc(c.name) : '<span class="muted">Unknown</span>'; };

  // ---------- Dashboard ----------
  function dashboard() {
    const s = S();
    if (!s.clients.length) {
      return head('Welcome to Ledger', 'A Metro 2–aware credit dispute workspace with CROA safeguards built in.') +
        card('', empty('Your workspace is empty', 'Add your first client, import a v1 backup, or explore with synthetic demo data.',
          `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" data-act="new-client">${icon('plus')} Add client</button><button class="btn" data-act="load-demo">Load demo data</button><button class="btn" data-act="import">${icon('upload')} Import backup</button></div>`));
    }
    const t = T();
    const open = openDisputes();
    const sent = open.filter(d => d.status === 'sent');
    const due7 = sent.filter(d => d.dueAt && d.dueAt >= t && d.dueAt <= Law.addDays(t, 7));
    const overdue = sent.filter(d => d.dueAt && d.dueAt < t);
    const resolved = s.disputes.filter(d => d.outcome);
    const wins = resolved.filter(d => ['deleted', 'corrected', 'blocked'].includes(d.outcome));
    const paid = s.invoices.filter(i => i.status === 'paid').reduce((a, i) => a + Number(i.amount || 0), 0);
    const outstanding = s.invoices.filter(i => i.status === 'issued').reduce((a, i) => a + Number(i.amount || 0), 0);
    const active = s.clients.filter(c => c.status === 'active').length;
    const al = alerts();

    const deadlines = sent.slice().sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))).slice(0, 7);
    const tasks = s.tasks.filter(x => !x.done).sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 6);
    const outcomes = ['deleted', 'corrected', 'verified', 'frivolous', 'no_response'].map(o => [o, s.disputes.filter(d => d.outcome === o).length]);
    const maxO = Math.max(1, ...outcomes.map(o => o[1]));

    return head('Dashboard', new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      `<button class="btn" data-act="new-task">${icon('plus')} Task</button><button class="btn" data-act="upload-report">${icon('upload')} Upload report</button><button class="btn primary" data-act="new-client">${icon('plus')} New client</button>`) +
      `<div class="grid g4">
        ${kpi('Active clients', active, `${s.clients.filter(c => c.status === 'onboarding').length} onboarding · ${s.clients.filter(c => c.status === 'lead').length} leads`)}
        ${kpi('Open disputes', open.length, `${sent.length} awaiting response`)}
        ${kpi('Responses due ≤ 7 days', due7.length, overdue.length ? `<span style="color:var(--high)">${overdue.length} overdue</span>` : 'None overdue', overdue.length ? 'alert' : '')}
        ${kpi('Resolution rate', resolved.length ? Math.round(wins.length / resolved.length * 100) + '%' : '—', `${wins.length} corrected or deleted of ${resolved.length}`)}
      </div>
      <div class="grid g-main" style="margin-top:16px">
        <div class="stack">
          ${card('Response deadlines', deadlines.length ? `<ul class="list">${deadlines.map(d => {
            const days = Law.daysBetween(t, d.dueAt);
            return `<li><span class="dot" style="background:${days < 0 ? 'var(--high)' : days <= 7 ? 'var(--med)' : 'var(--accent)'}"></span><div class="grow"><a href="#/disputes/${d.id}"><b>${esc(d.recipient)}</b> · ${esc(Law.DISPUTE_TYPES[d.type].label)} · round ${d.round}</a><div class="meta">${clientName(d.clientId)} · mailed ${date(d.sentAt)}${d.tracking ? ' · tracking ' + esc(d.tracking) : ''}</div></div><div class="right nowrap"><b>${date(d.dueAt)}</b><div class="meta">${days < 0 ? Math.abs(days) + ' days overdue' : days + ' days left'}</div></div></li>`;
          }).join('')}</ul>` : empty('Nothing in flight', 'Mailed disputes and their statutory deadlines appear here.'), { flush: true, sub: 'Calculated from the date each dispute was received' })}
          ${card('Dispute outcomes', `<div class="stack">${outcomes.map(([o, n]) => `<div><div class="row between small"><span>${UI.DSTATE[o][0]}</span><b>${n}</b></div><div class="bar"><i style="width:${n / maxO * 100}%;${['verified', 'frivolous', 'no_response'].includes(o) ? 'background:var(--med)' : ''}"></i></div></div>`).join('')}</div>`)}
        </div>
        <div class="stack">
          ${card('Compliance alerts', al.length ? `<ul class="list">${al.slice(0, 8).map(a => `<li><span class="dot" style="background:var(--${a.sev === 'high' ? 'high' : a.sev === 'medium' ? 'med' : 'low'})"></span><div class="grow"><a href="${a.link}">${esc(a.text)}</a></div></li>`).join('')}</ul>` : `<div class="callout good" style="margin:16px"><b>All clear</b>No CROA or deadline issues detected.</div>`, { flush: true, sub: `${al.filter(a => a.sev === 'high').length} need attention` })}
          ${card('Revenue', `<div class="row between"><div><div class="muted small">Collected</div><div class="score">${money(paid)}</div></div><div class="right"><div class="muted small">Outstanding</div><div style="font-size:18px;font-weight:600">${money(outstanding)}</div></div></div><p class="small muted" style="margin-top:8px">Billed only after services are performed (CROA § 1679b(b)).</p>`)}
          ${card('Tasks', tasks.length ? `<ul class="list">${tasks.map(x => `<li><input type="checkbox" data-act="toggle-task" data-id="${x.id}" style="margin-top:4px"><div class="grow">${esc(x.title)}<div class="meta">${x.clientId ? clientName(x.clientId) + ' · ' : ''}due ${date(x.due)}</div></div></li>`).join('')}</ul>` : empty('No open tasks', ''), { flush: true, actions: `<button class="btn sm" data-act="new-task">${icon('plus')}</button>` })}
          ${card('Recent activity', `<ul class="list">${s.activity.slice(0, 7).map(a => `<li><div class="grow">${esc(a.text)}<div class="meta">${a.clientId ? clientName(a.clientId) + ' · ' : ''}${ago(a.at)}</div></div></li>`).join('')}</ul>`, { flush: true })}
        </div>
      </div>`;
  }

  // ---------- Clients ----------
  function clients(params) {
    const filter = params.q || 'all';
    const kindF = params.kind || '';
    const list = S().clients.filter(c => (filter === 'all' || c.status === filter) && (!kindF || c.kind === kindF || (kindF !== 'personal' && c.kind === 'both'))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const tabs = ['all', 'lead', 'onboarding', 'active', 'paused', 'completed', 'cancelled'];
    const btn = (act, id, label, cls, title) => `<button class="btn sm ${cls || ''}" data-act="${act}" data-id="${id}" title="${title || label}">${label}</button>`;
    return head('Clients', `${S().clients.length} profiles · ${S().clients.filter(c => c.kind !== 'personal').length} with business credit`,
      `<button class="btn" data-act="onboarding-link">${icon('mail')} Client onboarding link</button><button class="btn" data-act="import-client-csv">${icon('upload')} Import</button><button class="btn primary" data-act="new-client">${icon('plus')} Add profile</button>`) +
      `<div class="tabs">${tabs.map(tb => `<a href="#/clients?q=${tb}${kindF ? '&kind=' + kindF : ''}" class="${tb === filter ? 'active' : ''}">${tb === 'all' ? 'All' : UI.CSTATE[tb][0]} <span class="muted">${tb === 'all' ? S().clients.length : S().clients.filter(c => c.status === tb).length}</span></a>`).join('')}
        <span style="margin-left:auto" class="row">${[['', 'All types'], ['personal', 'Personal'], ['business', 'Business']].map(([k, l]) => `<a href="#/clients?q=${filter}${k ? '&kind=' + k : ''}" class="${k === kindF ? 'active' : ''}">${l}</a>`).join('')}</span></div>` +
      `<div class="row" id="bulk-bar" style="margin-bottom:10px;display:none"><b class="small" id="bulk-count"></b><button class="btn sm" data-act="bulk-email">${icon('mail')} Email selected</button><button class="btn sm" data-act="bulk-export">${icon('download')} Export selected</button><button class="btn sm" data-act="bulk-task">${icon('plus')} Task for selected</button></div>` +
      card('', list.length ? `<div class="table-wrap"><table><thead><tr><th style="width:34px"><input type="checkbox" data-act="select-all" title="Select all"></th><th>Full name</th><th>Status</th><th>Added by</th><th>Email</th><th>Date added</th><th>CROA</th><th class="num" title="Metro 2 findings">Issues</th><th>Actions</th></tr></thead><tbody>
        ${list.map(c => {
          const cs = Store.croaStatus(c);
          const f = c.kind === 'business' ? 0 : clientFindings(c.id).filter(x => x.severity !== 'low').length;
          const docs = (S().documents || []).filter(d => d.clientId === c.id).length;
          return `<tr class="click" data-href="#/clients/${c.id}"><td><input type="checkbox" class="pick" value="${c.id}"></td>
            <td class="nowrap"><b>${esc(c.name)}</b>${c.kind !== 'personal' ? '<br>' + kindBadge(c.kind) : ''}<div class="small muted">${esc((c.business && c.business.legalName) || '')}</div></td><td>${cBadge(c.status)}</td>
            <td class="small">${esc(c.addedBy || (c.notes && c.notes.includes('Heard about us') ? 'Website' : '—'))}</td><td class="small" style="word-break:break-all;min-width:140px">${esc(c.email || '—')}</td><td class="small muted nowrap">${date(c.createdAt)}</td>
            <td>${!cs.required ? '<span class="badge b-low plain">N/A</span>' : cs.cancelled ? '<span class="badge b-high">Cancelled</span>' : cs.cleared ? '<span class="badge b-ok">Cleared</span>' : cs.inWindow ? `<span class="badge b-info">Until ${date(cs.deadline)}</span>` : `<span class="badge b-low">${cs.steps.filter(x => x.done).length}/6</span>`}</td>
            <td class="num">${f || '<span class="muted">0</span>'}</td>
            <td class="nowrap actions">${btn('message', c.id, 'SMS', '', 'Text message')}${btn('message-email', c.id, 'Email')}${btn('edit-client', c.id, '✎', '', 'Edit profile')}${btn('docs', c.id, '📄' + (docs ? ' ' + docs : ''), '', 'Documents')}${btn('upload-report', c.id, icon('upload') + ' Report', 'primary', 'Upload credit report')}</td></tr>`;
        }).join('')}</tbody></table></div>` : empty('No clients here', 'Share your onboarding link or add a profile.', `<button class="btn primary" data-act="new-client" style="margin-top:8px">${icon('plus')} Add profile</button>`), { flush: true });
  }

  function client(params) {
    const c = Store.get.client(params.id);
    if (!c) return empty('Client not found', '<a href="#/clients">Back to clients</a>');
    const tab = params.tab || 'overview';
    const tabs = [['overview', 'Overview']].concat(c.kind !== 'personal' ? [['business', 'Business credit'], ['acquisition', 'Buy a business']] : [], c.kind !== 'business' ? [['reports', 'Credit reports'], ['audit', 'Metro 2 audit']] : [],
      [['disputes', 'Disputes'], ['documents', 'Documents'], ['messages', 'Messages'], ['partners', 'Recommendations'], ['billing', 'Billing'], ['compliance', 'Agreements'], ['activity', 'Activity']]);
    const cs = Store.croaStatus(c);
    const nFind = clientFindings(c.id).filter(f => f.severity !== 'low').length;
    const body = ({ overview: clientOverview, business: clientBusiness, acquisition: clientAcquisition, reports: clientReports, audit: clientAudit, disputes: clientDisputes, partners: clientPartners, documents: clientDocuments, messages: clientMessages, billing: clientBilling, compliance: clientCompliance, activity: clientActivity }[tab] || clientOverview)(c, cs, params);
    return head(`${esc(c.name)} ${cBadge(c.status)} ${kindBadge(c.kind)}`, [c.business && c.business.legalName, c.email, c.phone, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).map(esc).join(' · '),
      `<button class="btn" data-act="ai" data-id="${c.id}">✦ Ask AI</button>${Store.remote ? `<button class="btn" data-act="portal-invite" data-id="${c.id}">Invite to portal</button>` : ''}${c.status === 'lead' ? `<button class="btn" data-act="analysis" data-id="${c.id}">${icon('print')} Credit analysis</button>` : `<button class="btn" data-act="progress-report" data-id="${c.id}">${icon('print')} Progress report</button>`}<button class="btn" data-act="edit-client" data-id="${c.id}">Edit</button><button class="btn primary" data-act="upload-report" data-id="${c.id}">${icon('upload')} Upload credit report</button>`,
      `<a href="#/clients">Clients</a> / ${esc(c.name)}`) +
      (cs.inWindow ? `<div class="callout" style="margin-bottom:16px"><b>Cancellation period open until midnight ${date(cs.deadline)}</b>No services may be performed and no fees collected until it ends (15 U.S.C. §§ 1679d(a)(2), 1679e).</div>` : '') +
      `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/clients/${c.id}/${k}" class="${k === tab ? 'active' : ''}">${l}${k === 'audit' && nFind ? ` <span class="badge b-high plain">${nFind}</span>` : ''}</a>`).join('')}</div>` + body;
  }

  function scoreCards(c) {
    const byB = {};
    Store.get.reportsFor(c.id).slice().reverse().forEach(r => Object.entries(r.scores || {}).forEach(([b, v]) => { if (v) { byB[b] = byB[b] || []; byB[b].push({ v: Number(v), d: r.date }); } }));
    const bs = ['Equifax', 'Experian', 'TransUnion'];
    return `<div class="grid g3">${bs.map(b => {
      const arr = byB[b] || [];
      if (!arr.length) return `<div class="card kpi"><div class="label">${b}</div><div class="value muted">—</div><div class="sub">No score recorded</div></div>`;
      const last = arr[arr.length - 1], first = arr[0], delta = last.v - first.v;
      return `<div class="card kpi"><div class="label">${b}</div><div class="value">${last.v}</div><div class="sub">${arr.length > 1 ? `<span class="${delta >= 0 ? 'delta-up' : 'delta-down'}">${delta >= 0 ? '+' : ''}${delta}</span> since ${date(first.d)}` : 'as of ' + date(last.d)}</div></div>`;
    }).join('')}</div>`;
  }

  function clientOverview(c, cs) {
    const ds = Store.get.disputesFor(c.id);
    const items = ds.reduce((a, d) => a + d.items.length, 0);
    const wins = ds.reduce((n, d) => n + d.items.filter(it => ['deleted', 'corrected'].includes(it.result) || (!it.result && ['deleted', 'corrected', 'blocked'].includes(d.outcome))).length, 0);
    const tasks = S().tasks.filter(x => x.clientId === c.id && !x.done);
    const ref = c.referralId && S().referrals.find(r => r.id === c.referralId);
    return (c.kind === 'business' ? '' : scoreCards(c)) + `<div class="grid g-main" style="${c.kind === 'business' ? '' : 'margin-top:16px'}"><div class="stack">
      ${!cs.required ? card('Business credit progress', (() => { const fz = root.Business.fundability(c); return `<div class="row between"><div><div class="muted small">Fundability foundation</div><div class="score">${fz.pct}%</div></div><a class="btn sm" href="#/clients/${c.id}/business">Open business credit</a></div><div class="bar" style="margin-top:10px"><i style="width:${fz.pct}%"></i></div><p class="small muted" style="margin-top:10px">Business-only services fall outside CROA. If you also work on the owner’s personal credit, change the client type to “Personal + business”.</p>`; })()) : ''}
      ${cs.required ? card('Onboarding (CROA)', `<ul class="steps">${cs.steps.map(s => `<li><span class="tick ${s.done ? 'on' : ''}">${s.done ? '✓' : ''}</span><div class="grow">${esc(s.label)}<div class="small muted">${s.date ? date(s.date) : 'Not recorded'}</div></div></li>`).join('')}</ul>`, { actions: `<a class="btn sm" href="#/clients/${c.id}/compliance">Manage</a>` }) : ''}
      ${card('Dispute summary', `<div class="grid g3"><div><div class="muted small">Disputes</div><div class="score">${ds.length}</div></div><div><div class="muted small">Items disputed</div><div class="score">${items}</div></div><div><div class="muted small">Items removed / corrected</div><div class="score" style="color:var(--ok)">${wins}</div></div></div>`, { actions: `<a class="btn sm" href="#/clients/${c.id}/audit">Run audit</a>` })}
    </div><div class="stack">
      ${card('Profile', `<div class="small stack" style="--gap:6px">
        <div><span class="muted">Address</span><br>${esc(c.address)}${c.city ? '<br>' + esc(c.city) + ', ' + esc(c.state) + ' ' + esc(c.zip) : ''}</div>
        <div class="row between"><span class="muted">Date of birth</span><span>${c.dob ? date(c.dob) : '—'}</span></div>
        <div class="row between"><span class="muted">SSN</span><span class="mono">${c.ssnLast4 ? '•••-••-' + esc(c.ssnLast4) : '—'}</span></div>
        <div class="row between"><span class="muted">Referred by</span><span>${ref ? esc(ref.name) : '—'}</span></div>
        ${c.notes ? `<div><span class="muted">Notes</span><br>${esc(c.notes)}</div>` : ''}</div>`)}
      ${card('Open tasks', tasks.length ? `<ul class="list">${tasks.map(x => `<li><input type="checkbox" data-act="toggle-task" data-id="${x.id}" style="margin-top:4px"><div class="grow">${esc(x.title)}<div class="meta">due ${date(x.due)}</div></div></li>`).join('')}</ul>` : empty('No open tasks', ''), { flush: true, actions: `<button class="btn sm" data-act="new-task" data-client="${c.id}">${icon('plus')}</button>` })}
    </div></div>`;
  }

  function clientReports(c) {
    const reps = Store.get.reportsFor(c.id);
    if (!reps.length) return pendingImports(c) + card('', empty('No reports yet', 'Upload a PDF or web page from MyFreeScoreNow, IdentityIQ or SmartCredit and AI reads every account, or import a CSV, or enter it by hand.', `<button class="btn primary" data-act="upload-report" data-id="${c.id}" style="margin-top:8px">${icon('upload')} Upload credit report</button>`));
    return `<div class="stack">${pendingImports(c)}${compareCard(c, reps)}${reps.map(r => card(`${esc(r.bureau)} · ${date(r.date)}`, r.accounts.length ? `<div class="table-wrap"><table><thead><tr><th>Creditor</th><th>Type</th><th>Status</th><th class="num">Balance</th><th class="num">Past due</th><th class="num">Limit / high</th><th>Opened</th><th>DOFD</th><th>24-mo history</th><th></th></tr></thead><tbody>
      ${r.accounts.map(a => `<tr><td><b>${esc(a.creditor)}</b><div class="small muted mono">${esc(a.accountNumber)}${a.originalCreditor ? ' · for ' + esc(a.originalCreditor) : ''}</div></td>
        <td class="small">${esc(Metro2.PORTFOLIO_TYPE[a.type] || a.type || '—')}</td>
        <td><span class="badge ${Metro2.DEROGATORY.includes(a.status) ? 'b-high' : Metro2.PAID_ZERO.includes(a.status) || a.status === '11' ? 'b-ok' : 'b-low'} plain" title="${esc(Metro2.ACCOUNT_STATUS[a.status] || '')}">${esc(a.status)}</span> <span class="small muted">${esc(Metro2.ACCOUNT_STATUS[a.status] || '')}</span></td>
        <td class="num">${money(a.balance)}</td><td class="num">${money(a.pastDue)}</td><td class="num">${money(a.limit)} / ${money(a.highCredit)}</td>
        <td class="small nowrap">${date(a.opened)}</td><td class="small nowrap">${date(a.dofd)}</td><td class="mono small">${esc(a.paymentHistory || '—')}</td>
        <td class="nowrap"><button class="btn sm ghost" data-act="edit-tradeline" data-report="${r.id}" data-id="${a.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : empty('No tradelines', 'Add tradelines to audit this report.'),
      { flush: true, sub: `${esc(r.source || '')}${r.scores && r.scores[r.bureau] ? ' · score ' + r.scores[r.bureau] : ''} · ${r.accounts.length} tradelines`,
        actions: `<button class="btn sm" data-act="edit-tradeline" data-report="${r.id}">${icon('plus')} Tradeline</button><button class="btn sm" data-act="edit-report" data-id="${r.id}">Edit</button><button class="btn sm ghost danger" data-act="delete-report" data-id="${r.id}">Delete</button>` })).join('')}</div>`;
  }

  function clientAudit(c) {
    const fs = clientFindings(c.id);
    const reps = Store.get.latestByBureau(c.id);
    if (!reps.length) return card('', empty('Nothing to audit yet', 'Add at least one credit report. With reports from all three bureaus the audit also compares each tradeline across bureaus.'));
    const counts = { high: 0, medium: 0, low: 0 };
    fs.forEach(f => counts[f.severity]++);
    const cmp = Metro2.compareBureaus(reps);
    return `<div class="callout" style="margin-bottom:16px"><b>How this audit works</b>Each tradeline is checked for Metro 2 fields that contradict each other, for cross-bureau differences, and for items past the FCRA § 605 reporting period. A negative item that is accurate is <i>not</i> flagged — only the consumer can confirm whether information is wrong, and accurate information cannot be removed.</div>
    <div class="grid g4" style="margin-bottom:16px">${kpi('High', counts.high, 'Internal contradictions / obsolete', counts.high ? 'alert' : '')}${kpi('Medium', counts.medium)}${kpi('Low / informational', counts.low)}${kpi('Bureaus compared', reps.length, reps.map(r => r.bureau).join(', '))}</div>
    <div class="stack"><div>${card('Findings', fs.length ? `<div>${fs.map((f, i) => `<div class="finding ${f.severity}"><div class="row between"><label class="check"><input type="checkbox" name="f" value="${i}" ${f.severity === 'low' ? '' : 'checked'}><span class="t">${esc(f.title)}</span></label>${sevBadge(f.severity)}</div>
      <div class="small muted" style="margin:2px 0 0 24px">${esc(f.creditor)} · ${esc(f.bureau)} · <span class="mono">${esc(f.code)}</span></div>
      <div class="d" style="margin-left:24px">${esc(f.detail)}</div>
      <div class="f" style="margin-left:24px">${f.fields && f.fields.length ? 'Fields: ' + esc(f.fields.join(', ')) + ' · ' : ''}Basis: ${esc(f.basis)} · Next step: ${esc(f.action)}</div></div>`).join('')}</div>` : `<div class="callout good"><b>No inconsistencies found</b>The reported data is internally consistent. If the consumer believes something is inaccurate, add it as an issue on the tradeline with their evidence.</div>`,
      { sub: 'Select the items the consumer confirms are inaccurate', actions: fs.length ? `<button class="btn primary" data-act="disputes-from-audit" data-id="${c.id}">${icon('mail')} Create disputes</button>` : '' })}</div>
    <div>${card('Cross-bureau comparison', `<div class="table-wrap"><table><thead><tr><th>Tradeline</th>${['Equifax', 'Experian', 'TransUnion'].map(b => `<th>${b}</th>`).join('')}</tr></thead><tbody>${cmp.map(g => `<tr><td><b>${esc(g.creditor)}</b>${g.differences.length ? `<div class="small" style="color:var(--med)">${g.differences.length} difference(s)</div>` : ''}</td>${['Equifax', 'Experian', 'TransUnion'].map(b => { const t = g.byBureau[b]; if (!t) return '<td class="muted small">Not reported</td>'; const diffs = g.differences.map(d => d.field); return `<td class="small ${diffs.length ? 'diff' : ''}">${esc(t.status)} · ${money(t.balance)}${t.dofd ? '<br>DOFD ' + esc(t.dofd) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`, { flush: true, sub: 'Latest report from each bureau' })}</div></div>`;
  }

  function disputeTable(list, showClient) {
    if (!list.length) return empty('No disputes', 'Create disputes from the Metro 2 audit.');
    return `<div class="table-wrap"><table><thead><tr>${showClient ? '<th>Client</th>' : ''}<th>Recipient</th><th>Type</th><th class="num">Round</th><th class="num">Items</th><th>Status</th><th>Mailed</th><th>Due</th></tr></thead><tbody>
      ${list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(d => `<tr class="click" data-href="#/disputes/${d.id}">${showClient ? `<td>${clientName(d.clientId)}</td>` : ''}<td><b>${esc(d.recipient)}</b></td><td class="small">${esc(Law.DISPUTE_TYPES[d.type].label)}</td><td class="num">${d.round}</td><td class="num">${d.items.length}</td><td>${dBadge(Store.disputeState(d))}</td><td class="small nowrap">${date(d.sentAt)}</td><td class="small nowrap">${date(d.dueAt)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function clientDisputes(c) {
    return clientViolationsCard(c) + (S().sequences || []).filter(q => q.clientId === c.id).map(q => seqCard(q, false)).join('') + card('Disputes', disputeTable(Store.get.disputesFor(c.id), false), { flush: true, actions: `<button class="btn sm primary" data-act="ai-plan" data-id="${c.id}">✦ AI plan next round</button><button class="btn sm primary" data-act="templates" data-client="${c.id}">Letter templates</button><button class="btn sm" data-act="new-dispute" data-client="${c.id}">${icon('plus')} Blank dispute</button><a class="btn sm primary" href="#/clients/${c.id}/audit">From audit</a>` });
  }

  function invoiceTable(list, showClient) {
    if (!list.length) return empty('No invoices', 'Invoices can only be issued for services already performed.');
    return `<div class="table-wrap"><table><thead><tr>${showClient ? '<th>Client</th>' : ''}<th>Description</th><th>Service completed</th><th>Issued</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${list.sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''))).map(i => `<tr>${showClient ? `<td>${clientName(i.clientId)}</td>` : ''}<td><span class="mono small muted">${esc(root.Invoices.number(i))}</span><br>${esc(i.description)}${i.emailedAt ? `<div class="small muted">Emailed ${date(i.emailedAt)}</div>` : ''}</td><td class="small nowrap">${date(i.serviceCompletedAt)}</td><td class="small nowrap">${date(i.issuedAt)}</td>
        <td><span class="badge ${i.status === 'paid' ? 'b-ok' : i.status === 'issued' ? 'b-info' : i.status === 'void' ? 'b-high' : 'b-low'}">${esc(i.status)}</span></td><td class="num">${money(i.amount)}</td>
        <td class="nowrap right">${i.status === 'issued' && i.payToken && Store.remote ? `<button class="btn sm ghost" data-act="invoice-link" data-id="${i.id}" title="Copy online payment link">Pay link</button><button class="btn sm ghost" data-act="invoice-check" data-id="${i.id}" title="Check Authorize.net for this payment">Check</button>` : ''}${i.status === 'issued' ? `<button class="btn sm" data-act="invoice-paid" data-id="${i.id}">Mark paid</button>` : ''}${i.status !== 'void' && i.status !== 'paid' ? `<button class="btn sm ghost danger" data-act="invoice-void" data-id="${i.id}">Void</button>` : ''}<button class="btn sm ghost" data-act="invoice-pdf" data-id="${i.id}" title="Download PDF">${icon('download')}</button>${i.status !== 'void' ? `<button class="btn sm ghost" data-act="invoice-email" data-id="${i.id}" title="Email to client">${icon('mail')}</button>` : ''}<button class="btn sm ghost" data-act="invoice-print" data-id="${i.id}" title="Print">${icon('print')}</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function clientBilling(c, cs) {
    const list = S().invoices.filter(i => i.clientId === c.id);
    return (cs.cleared ? '' : `<div class="callout warn" style="margin-bottom:16px"><b>Billing locked</b>Complete the disclosure, contract and cancellation period first. A credit repair organization may not charge or receive payment before a service is fully performed (§ 1679b(b)).</div>`) +
      card('Invoices', invoiceTable(list, false), { flush: true, actions: `<button class="btn sm primary" data-act="new-invoice" data-client="${c.id}" ${cs.cleared ? '' : 'disabled'}>${icon('plus')} Invoice</button>` });
  }

  function clientCompliance(c, cs) {
    const o = c.onboarding || {};
    const co = S().settings.company;
    return `<div class="grid g2"><div class="stack">
      ${card('Agreement record', `<form data-form="onboarding" data-id="${c.id}"><div class="form-grid">
        ${UI.field('Disclosure acknowledged', 'disclosureSignedAt', o.disclosureSignedAt, { type: 'date', help: 'Must be given as a separate document before the contract' })}
        ${UI.field('Contract signed', 'contractSignedAt', o.contractSignedAt, { type: 'date', help: cs.deadline ? 'Cancellation deadline: midnight ' + date(cs.deadline) : '' })}
        ${UI.field('Authorization to prepare disputes', 'authorizationAt', o.authorizationAt, { type: 'date' })}
        ${UI.field('Cancelled on', 'cancelledAt', o.cancelledAt, { type: 'date', help: 'If cancelled, refund anything paid' })}
        ${UI.field('Photo ID received', 'idReceived', o.idReceived, { type: 'date' })}
        ${UI.field('Proof of address received', 'addressProofReceived', o.addressProofReceived, { type: 'date' })}
      </div><div class="row" style="margin-top:14px"><button class="btn primary">Save record</button>${cs.retainUntil ? `<span class="small muted">Retain signed disclosure until ${date(cs.retainUntil)} (§ 1679c(c))</span>` : ''}</div></form>`)}
      ${!cs.disclosureOrder ? `<div class="callout bad"><b>Order problem</b>The disclosure must be provided before the contract is executed.</div>` : ''}
    </div><div class="stack">
      ${card('Client documents', `<ul class="list">
        <li><div class="grow"><b>Consumer Credit File Rights Under State and Federal Law</b><div class="meta">Required separate statement — 15 U.S.C. § 1679c</div></div><button class="btn sm" data-act="print-doc" data-doc="disclosure" data-id="${c.id}">${icon('print')}</button></li>
        <li><div class="grow"><b>Credit services agreement</b><div class="meta">Terms, total cost, timing, no-guarantee — § 1679d</div></div><button class="btn sm" data-act="print-doc" data-doc="contract" data-id="${c.id}">${icon('print')}</button></li>
        <li><div class="grow"><b>Notice of Cancellation (2 copies)</b><div class="meta">${cs.deadline ? 'Deadline ' + date(cs.deadline) : 'Set the contract date first'} — § 1679e(b)</div></div><button class="btn sm" data-act="print-doc" data-doc="cancel" data-id="${c.id}">${icon('print')}</button></li>
      </ul>`, { flush: true, sub: co.name ? esc(co.name) : 'Set your company details in Settings' })}
    </div></div>`;
  }

  const DOC_LABEL = { report: 'Credit report', id: 'Photo ID', address: 'Proof of address', 'bureau-response': 'Bureau response', agreement: 'Signed agreement', other: 'Other' };
  function clientDocuments(c) {
    const docs = (S().documents || []).filter(d => d.clientId === c.id);
    const sigs = (S().signatures || []).filter(x => x.clientId === c.id);
    return `<div class="grid g-main"><div>${card('Documents', docs.length ? `<ul class="list">${docs.map(d => `<li><div class="grow"><b>${esc(d.name)}</b><div class="meta">${esc(DOC_LABEL[d.type] || d.type)} · ${Math.max(1, Math.round(d.size / 1024))} KB · ${date(d.uploadedAt)} · by ${esc(d.uploadedBy || '')}</div></div>${Store.remote && d.type === 'report' ? `<button class="btn sm primary" data-act="ai-scan" data-client="${c.id}" data-id="${d.id}">✦ Scan with AI</button>` : ''}${Store.remote ? `<a class="btn sm" href="/api/files/${d.id}">${icon('download')} Download</a>` : ''}</li>`).join('')}</ul>` : empty('No documents yet', Store.remote ? 'Upload credit reports, ID, proof of address and bureau responses. Clients can also upload from their portal.' : 'File uploads are stored on the Ledger server. Run it with npm run ledger.'),
      { flush: true, actions: `<button class="btn sm primary" data-act="upload-doc" data-id="${c.id}">${icon('upload')} Upload</button>` })}</div>
      <div>${card('E-signatures', sigs.length ? `<ul class="list">${sigs.map(x => `<li><div class="grow"><b>${x.doc === 'disclosure' ? 'Rights disclosure' : 'Services agreement'}</b><div class="meta">Signed “${esc(x.typedName)}” · ${date(x.at)} ${new Date(x.at).toLocaleTimeString()} · IP ${esc(x.ip)}</div><div class="meta mono">SHA-256 ${esc(x.documentSha256.slice(0, 16))}…</div></div></li>`).join('')}</ul>` : empty('No e-signatures', 'Invite the client to the portal to sign electronically.'), { flush: true })}</div></div>`;
  }
  function clientMessages(c) {
    const msgs = (S().messages || []).filter(m => m.clientId === c.id);
    return card('Communication log', msgs.length ? `<ul class="list">${msgs.map(m => `<li><span class="badge ${m.channel === 'sms' ? 'b-info' : 'b-accent'} plain">${m.channel === 'sms' ? 'SMS' : 'Email'}</span><div class="grow">${m.subject ? `<b>${esc(m.subject)}</b><br>` : ''}<span class="small" style="white-space:pre-wrap">${esc(m.body)}</span><div class="meta">${date(m.at)} · ${esc(m.status === 'sent' ? 'sent by server' : 'opened in your ' + (m.channel === 'sms' ? 'messaging' : 'email') + ' app')} · ${esc(m.by || '')}</div></div></li>`).join('')}</ul>` : empty('No messages yet', 'Send updates by SMS or email. Every message is logged here.'),
      { flush: true, sub: c.smsConsent ? 'SMS consent on file' : 'No SMS consent recorded', actions: `<button class="btn sm" data-act="message" data-id="${c.id}">SMS</button><button class="btn sm primary" data-act="message-email" data-id="${c.id}">Email</button>` });
  }

  function clientActivity(c) {
    const acts = S().activity.filter(a => a.clientId === c.id);
    return card('Activity', acts.length ? `<ul class="list">${acts.map(a => `<li><div class="grow">${esc(a.text)}</div><div class="meta nowrap">${date(a.at)}</div></li>`).join('')}</ul>` : empty('No activity yet', ''), { flush: true });
  }

  // ---------- Disputes ----------
  function disputes(params) {
    const cid = params.client || '';
    const all = S().disputes.filter(d => !cid || d.clientId === cid);
    const cols = [['draft', 'Draft'], ['ready', 'Approved'], ['sent', 'Awaiting response'], ['overdue', 'Overdue'], ['done', 'Resolved']];
    const bucket = d => { const st = Store.disputeState(d); return d.outcome || st === 'closed' ? 'done' : st; };
    return head('Disputes', 'Every dispute, round and statutory deadline in one pipeline', `<select data-act="filter-client" style="width:auto"><option value="">All clients</option>${S().clients.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><button class="btn" data-act="mail-room">${icon('print')} Send round (${all.filter(d => d.status === 'ready').length} ready)</button><button class="btn" data-act="templates">Letter templates</button><button class="btn primary" data-act="new-dispute">${icon('plus')} New dispute</button>`) +
      `<div class="board">${cols.map(([k, l]) => { const items = all.filter(d => bucket(d) === k); return `<div class="col"><h3>${l}<span>${items.length}</span></h3>${items.map(d => `<a class="ticket" href="#/disputes/${d.id}"><div class="row between"><b>${esc(d.recipient)}</b>${k === 'done' ? dBadge(d.outcome || 'closed') : `<span class="small muted">R${d.round}</span>`}</div><div class="meta">${clientName(d.clientId)} · ${esc(Law.DISPUTE_TYPES[d.type].label)}</div><div class="meta">${d.items.length} item(s)${d.dueAt && !d.outcome ? ' · due ' + date(d.dueAt) : ''}</div></a>`).join('') || '<div class="small muted" style="padding:8px">—</div>'}</div>`; }).join('')}</div>`;
  }

  function dispute(params) {
    const d = Store.get.dispute(params.id);
    if (!d) return empty('Dispute not found', '<a href="#/disputes">Back</a>');
    const c = Store.get.client(d.clientId);
    const cs = c ? Store.croaStatus(c) : { cleared: false };
    const letter = d.letterId && Store.get.letter(d.letterId);
    const type = Law.DISPUTE_TYPES[d.type];
    const st = Store.disputeState(d);
    const lint = letter ? Law.lintText(letter.text) : [];
    const risks = repeatRisk(d);
    const t = T();
    const timeline = [
      ['Created', d.createdAt], ['Letter approved', letter && letter.approvedAt], ['Mailed', d.sentAt], ['Received (est.)', d.receivedAt],
      ['Response due', d.dueAt], ['Response recorded', d.respondedAt]
    ];
    const editable = !letter || letter.status === 'draft';
    return head(`${esc(type.label)} → ${esc(d.recipient)}`, `${esc(type.cite)} · round ${d.round}`,
      `${dBadge(st)}<button class="btn ghost danger" data-act="delete-dispute" data-id="${d.id}">Delete</button>`,
      `<a href="#/disputes">Disputes</a> / <a href="#/clients/${d.clientId}/disputes">${c ? esc(c.name) : ''}</a>`) +
      (!cs.cleared ? `<div class="callout warn" style="margin-bottom:16px"><b>Onboarding not cleared</b>This letter can be drafted but not approved or mailed until the disclosure, contract and 3-business-day cancellation period are complete.</div>` : '') +
      (risks.length ? `<div class="callout warn" style="margin-bottom:16px"><b>Possible repeat dispute</b>${risks.map(r => esc(r.item.creditor)).join(', ')} was already verified by ${esc(d.recipient)} in round ${risks[0].prior.round}. Re-sending the same dispute without new information may be treated as frivolous (FCRA § 611(a)(3)). Add new evidence, request the method of verification, or dispute directly with the furnisher.</div>` : '') +
      `<div class="grid g-main"><div class="stack">
        ${card('Disputed items', `<div>${d.items.map((it, i) => `<div class="finding ${it.result === 'deleted' || it.result === 'corrected' ? 'low' : 'medium'}"><div class="row between"><span class="t">${it.result ? `<span class="badge ${it.result === 'deleted' ? 'b-ok' : it.result === 'corrected' ? 'b-info' : 'b-med'}">${it.result === 'deleted' ? 'Removed' : it.result === 'corrected' ? 'Corrected' : 'Still reporting'}</span> ` : ''}${esc(it.creditor)}${it.accountNumber ? ' <span class="mono small muted">' + esc(it.accountNumber) + '</span>' : ''}</span>${editable ? `<button class="btn sm ghost" data-act="edit-item" data-id="${d.id}" data-i="${i}">Edit</button>` : ''}</div><div class="d">${esc(it.discrepancy)}</div><div class="f">${it.fields && it.fields.length ? 'Fields: ' + esc(it.fields.join(', ')) + ' · ' : ''}${it.evidence ? 'Evidence: ' + esc(it.evidence) : '<span style="color:var(--med)">No evidence listed</span>'}</div></div>`).join('') || '<p class="muted">No items.</p>'}</div>`,
          { actions: editable && d.type !== 'disclosure_609' ? `<button class="btn sm" data-act="edit-item" data-id="${d.id}">${icon('plus')} Item</button>` : '' })}
        ${card('Letter', letter ? `${lint.length ? `<div class="callout warn" style="margin-bottom:12px"><b>Review these phrases</b>${lint.map(l => `“${esc(l.phrase)}” — ${esc(l.why)}`).join('<br>')}</div>` : ''}
          <textarea class="letter" data-act="letter-edit" data-id="${letter.id}" ${editable ? '' : 'readonly'}>${esc(letter.text)}</textarea>`
          : empty('No letter yet', 'Generate a letter from the items above.'),
          { sub: letter ? `Status: ${esc(letter.status)}${letter.approvedAt ? ' · approved ' + date(letter.approvedAt) : ''}` : '', actions:
            `${editable ? `<button class="btn sm" data-act="gen-letter" data-id="${d.id}">${letter ? 'Regenerate' : 'Generate letter'}</button>` : ''}${letter ? `<button class="btn sm" data-act="print-letter" data-id="${letter.id}">${icon('print')} Print</button>` : ''}` })}
      </div><div class="stack">
        ${card('Strategy', (() => { const step = d.strategyStep || Law.strategyStep(d.type); return `<ul class="steps">${Law.STRATEGY.map(x => `<li><span class="tick ${x.step < step || (x.step === step && d.outcome && !['verified', 'frivolous', 'no_response'].includes(d.outcome)) ? 'on' : ''}" style="${x.step === step ? 'border-color:var(--accent);border-width:2px' : ''}">${x.step}</span><div class="grow"><b style="font-weight:${x.step === step ? 650 : 500}">${esc(x.title)}</b><div class="small muted">${esc(x.when)}</div></div></li>`).join('')}</ul>`; })(), { sub: 'Where this item stands on the escalation ladder' })}
        ${d.seqId && (S().sequences || []).find(q => q.id === d.seqId) ? card('Sequence', `<p class="small">Letter ${root.Sequences.stepOf(S(), d)} of the sequence “${esc((S().sequences.find(q => q.id === d.seqId) || {}).title)}”. Record the response when it arrives; the next letter is drafted automatically.</p><a class="btn sm" href="#/sequences">Open sequences</a>`) : card('Sequence', '<p class="small">Run this dispute as a sequence so Letters 2, 3 and the attorney review step are drafted automatically when they are due.</p>' + `<button class="btn sm" data-act="seq-start" data-id="${d.id}">Run as sequence</button>`)}
        ${card('Next step', nextStep(d, letter, cs, st))}
        ${card('Timeline', `<ul class="steps">${timeline.map(([l, v]) => { const on = v && String(v).slice(0, 10) <= t; return `<li><span class="tick ${on ? 'on' : ''}">${on ? '✓' : ''}</span><div class="grow">${l}<div class="small muted">${v ? date(v) : '—'}${l === 'Response due' && v && !d.outcome ? ` · ${Law.daysBetween(t, v) < 0 ? Math.abs(Law.daysBetween(t, v)) + ' days overdue' : Law.daysBetween(t, v) + ' days left'}` : ''}</div></div></li>`; }).join('')}</ul>${d.tracking ? `<p class="small">Tracking <span class="mono">${esc(d.tracking)}</span></p>` : ''}${d.mail ? `<div class="small" style="margin-bottom:8px"><b>Mailed online via Lob</b> (${esc(String(d.mail.service).replace(/_/g, ' '))})${d.mail.test ? ' <span class="badge b-med plain">test mode — not actually mailed</span>' : ''}${d.mail.expectedDelivery ? `<br>Expected delivery ${date(d.mail.expectedDelivery)}` : ''}${d.mail.deliveredAt ? `<br><b>Delivered ${date(d.mail.deliveredAt)}</b>` : ''}${(d.mail.events || []).length ? `<br>${d.mail.events.slice(-3).map(e => esc(e.name) + (e.at ? ' ' + date(e.at) : '')).join(' · ')}` : ''}<div class="row" style="margin-top:6px">${d.mail.url ? `<a class="btn sm ghost" href="${esc(d.mail.url)}" target="_blank" rel="noopener">Mailed PDF ↗</a>` : ''}<button class="btn sm" data-act="mail-refresh" data-id="${d.id}">Refresh tracking</button></div></div>` : ''}<p class="small muted">${esc(type.note)}</p>`)}
        ${card('Recipient', `<div class="small"><b>${esc((Law.BUREAUS[d.recipient] || {}).name || d.recipient)}</b><br>${esc((Law.BUREAUS[d.recipient] || {}).address || d.recipientAddress || 'Address not set').replace(/\n/g, '<br>')}</div>${!Law.BUREAUS[d.recipient] && !d.recipientAddress && root.Furnishers.lookup(S(), d.recipient) ? (() => { const f = root.Furnishers.lookup(S(), d.recipient); return `<div class="callout" style="margin-top:10px"><b>Address on file for ${esc(f.name)}</b><span style="white-space:pre-line">${esc(f.address)}</span><button class="btn sm" data-act="use-address" data-id="${d.id}" style="margin-top:6px">Use this address</button></div>`; })() : ''}`, { actions: `<button class="btn sm ghost" data-act="edit-recipient" data-id="${d.id}">Edit</button>` })}
        ${d.notes ? card('Notes', `<p class="small">${esc(d.notes)}</p>`) : ''}
      </div></div>`;
  }

  // ---------- report comparison & pending imports ----------
  function pendingImports(c) {
    const list = (S().pendingImports || []).filter(p => p.clientId === c.id);
    if (!list.length) return '';
    return card('Ready to import', `<ul class="list">${list.map(p => `<li><div class="grow"><b>${esc(p.docName)}</b><div class="meta">Uploaded by the client · read by AI ${UI.ago ? UI.ago(p.scannedAt) : date(p.scannedAt)} · ${(p.result.bureaus || []).map(b => `${esc(b.bureau)} (${b.accounts.length})`).join(', ')}</div></div><button class="btn sm primary" data-act="pending-import" data-id="${p.id}">Review & import</button><button class="btn sm ghost" data-act="pending-dismiss" data-id="${p.id}">Dismiss</button></li>`).join('')}</ul>`, { flush: true, sub: 'Credit reports the client uploaded in the portal' });
  }
  function compareCard(c, reps) {
    const byB = {};
    reps.filter(r => r.accounts.length).forEach(r => (byB[r.bureau] = byB[r.bureau] || []).push(r));
    const pairs = Object.entries(byB).filter(([, a]) => a.length > 1);
    if (!pairs.length) return '';
    const q = (location.hash.split('?')[1] || '');
    const params = Object.fromEntries(new URLSearchParams(q));
    const bureau = params.cmp && byB[params.cmp] && byB[params.cmp].length > 1 ? params.cmp : pairs[0][0];
    const list = byB[bureau].slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const next = list.find(r => r.id === params.to) || list[0];
    const prev = list.find(r => r.id === params.from && r.id !== next.id) || list.find(r => r.id !== next.id && String(r.date) <= String(next.date)) || list[1];
    const rows = root.Reports.sideBySide(prev, next);
    const cnt = k => rows.filter(r => r.kind === k).length;
    const KIND = { deleted: ['Removed', 'b-ok'], changed: ['Changed', 'b-med'], new: ['New', 'b-high'], unchanged: ['Same', 'b-low'] };
    const cell = (a, f) => a ? (f === 'balance' || f === 'pastDue' ? money(a[f]) : esc(a[f] || '—')) : '<span class="muted">—</span>';
    const sel = (name, val) => `<select data-act="cmp-pick" data-k="${name}" style="width:auto">${list.map(r => `<option value="${r.id}" ${r.id === val ? 'selected' : ''}>${date(r.date)}</option>`).join('')}</select>`;
    return card('Compare reports side by side', `<div class="row" style="padding:12px 16px;gap:8px;flex-wrap:wrap"><select data-act="cmp-pick" data-k="cmp" style="width:auto">${pairs.map(([b]) => `<option ${b === bureau ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select><span class="small muted">Older</span>${sel('from', prev.id)}<span class="small muted">Newer</span>${sel('to', next.id)}
        <span class="badge b-ok plain">${cnt('deleted')} removed</span><span class="badge b-med plain">${cnt('changed')} changed</span><span class="badge b-high plain">${cnt('new')} new</span><span class="badge b-low plain">${cnt('unchanged')} same</span></div>
      <div class="table-wrap"><table><thead><tr><th>Account</th><th></th><th>Status</th><th class="num">Balance</th><th class="num">Past due</th><th>What changed</th></tr></thead><tbody>
      ${rows.map(r => { const a = r.before || r.after; return `<tr class="cmp-${r.kind}"><td><b>${esc(a.creditor)}</b><div class="small muted mono">${esc(a.accountNumber || '')}</div></td><td><span class="badge ${KIND[r.kind][1]}">${KIND[r.kind][0]}</span></td>
        <td class="small">${cell(r.before, 'status')} → ${cell(r.after, 'status')}</td><td class="num small">${cell(r.before, 'balance')} → ${cell(r.after, 'balance')}</td><td class="num small">${cell(r.before, 'pastDue')} → ${cell(r.after, 'pastDue')}</td>
        <td class="small">${r.changes.map(ch => `${esc(ch.field)}: ${esc(ch.from || '—')} → ${esc(ch.to || '—')}`).join('<br>')}</td></tr>`; }).join('')}</tbody></table></div>`,
      { flush: true, sub: `${esc(bureau)}: ${date(prev.date)} vs ${date(next.date)}` });
  }

  // ---------- Sales pipeline ----------
  function pipeline() {
    const Sa = root.Sales, t = T();
    const leads = S().clients.filter(c => c.status === 'lead' || (c.leadStage && Sa.stageOf(c) === 'won' && Law.daysBetween(String(c.createdAt).slice(0, 10), t) <= 60) || c.status === 'cancelled' && c.leadStage);
    const cols = Sa.STAGES.map(([k, l]) => {
      const list = leads.filter(c => Sa.stageOf(c) === k).map(c => Object.assign({ c }, Sa.score(S(), c, t))).sort((a, b) => b.score - a.score);
      return `<div class="kan-col"><div class="kan-h"><b>${esc(l)}</b><span class="badge b-low plain">${list.length}</span></div>${list.map(x => `<div class="kan-card"><div class="row between"><a href="#/clients/${x.c.id}"><b>${esc(x.c.name)}</b></a><span class="badge ${x.heat === 'hot' ? 'b-high' : x.heat === 'warm' ? 'b-med' : 'b-low'}" title="${esc(x.reasons.join('\n'))}">${x.score}</span></div>
        <div class="small muted">${kindBadge(x.c.kind)} ${x.quiet > 0 ? x.quiet + 'd since last touch' : 'today'}${x.c.phone ? ' · ' + esc(x.c.phone) : ''}</div>
        <div class="row" style="margin-top:8px;gap:6px"><select data-act="lead-stage" data-id="${x.c.id}" style="width:auto;flex:1">${Sa.STAGES.map(([sk, sl]) => `<option value="${sk}" ${sk === k ? 'selected' : ''}>${esc(sl)}</option>`).join('')}</select>${S().reports.some(r => r.clientId === x.c.id && r.accounts.length) ? `<button class="btn sm" data-act="analysis" data-id="${x.c.id}" title="Free credit analysis for this prospect">Analysis</button>` : `<button class="btn sm" data-act="upload-report" data-id="${x.c.id}">Report</button>`}</div></div>`).join('') || '<p class="small muted" style="padding:6px 2px">—</p>'}</div>`;
    }).join('');
    const co = S().settings.company;
    return head('Sales pipeline', 'Leads from first contact to enrollment, scored by how ready they are', `<a class="btn" href="#/settings">${co.bookingUrl ? 'Booking link set' : 'Add booking link'}</a><button class="btn primary" data-act="new-client">+ New lead</button>`) +
      `<div class="callout" style="margin-bottom:14px"><b>How it works</b>Move leads between stages as you talk to them. The score (0–100) rises with contact details, an uploaded credit report, a near-term goal and progress through the stages, and drops after two weeks without contact — hover it to see why. Click <strong>Analysis</strong> for a free credit analysis you can send before they enroll. Setting a lead to <strong>Enrolled</strong> moves them to onboarding.</div>
      <div class="kanban">${cols}</div>`;
  }

  // ---------- Automations ----------
  function automations() {
    const Au = root.Automations;
    const rules = Au.rules(S());
    const log = Object.entries(S().automationLog || {}).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 40);
    const on = rules.filter(r => r.enabled && r.enabledAt).length;
    const chan = { email: 'Email', sms: 'Text', task: 'Task' };
    return head('Automations', 'Messages and tasks that go out on their own when something happens', `${on < rules.length ? `<button class="btn" data-act="auto-all">Turn on all recommended</button>` : ''}<button class="btn primary" data-act="auto-run">Run now</button>`) +
      `<div class="grid g-main"><div class="stack">${card('Rules', `<div class="table-wrap"><table><thead><tr><th>On</th><th>When</th><th>Wait</th><th>Then</th><th></th></tr></thead><tbody>${rules.map(r => `<tr><td><label class="switch"><input type="checkbox" data-act="auto-toggle" data-id="${r.id}" ${r.enabled && r.enabledAt ? 'checked' : ''}></label></td><td><b>${esc(Au.TRIGGERS[r.trigger] || r.trigger)}</b></td><td class="small nowrap">${Number(r.delayDays) ? r.delayDays + ' day' + (r.delayDays > 1 ? 's' : '') : 'Right away'}</td><td class="small"><span class="badge b-low plain">${chan[r.channel]}</span> ${esc(r.subject || r.body).slice(0, 90)}</td><td class="right"><button class="btn sm ghost" data-act="auto-edit" data-id="${r.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`, { flush: true, sub: `${on} of ${rules.length} on` })}</div>
      <div class="stack">${card('How sending works', `<p class="small">${Store.remote ? 'Emails and texts are sent from your Ledger server (Resend for email, Twilio for texts). Texts only go to clients with SMS consent on file. If sending isn’t set up, Ledger creates a task with the message instead.' : 'In this browser-only file, messages become tasks with the text ready to copy — sending needs the Ledger server.'}</p><p class="small muted">Rules only fire for events after you turn them on, and each event fires once. Template fields: {{first}}, {{name}}, {{company}}, {{phone}}, {{portal}}, {{booking}}, {{amount}}, {{due}}.</p>`)}
      ${card('Recent', log.length ? `<ul class="list">${log.map(([k, v]) => `<li><div class="grow small"><b>${esc(v.what || k)}</b><div class="meta">${esc(v.client || '')} · ${date(v.at)}${v.via ? ' · ' + esc(v.via) : ''}</div></div></li>`).join('')}</ul>` : '<p class="small muted" style="padding:16px">Nothing has run yet.</p>', { flush: true })}</div></div>`;
  }

  // ---------- Violation tracker ----------
  function violations(params) {
    const V = root.Violations, t = T();
    const list = V.scan(S(), t, params.client);
    const statusLabel = Object.fromEntries(V.STATUS);
    const byClient = {};
    list.forEach(x => (byClient[x.clientId] = byClient[x.clientId] || []).push(x));
    const open = list.filter(x => !['closed', 'declined'].includes(x.review.status));
    return head('FCRA violation tracker', 'Missed deadlines, reinsertions and reporting failures — documented for attorney review', params.client ? `<a class="btn" href="#/violations">All clients</a>` : '') +
      `<div class="grid g4" style="margin-bottom:16px">${kpi('Open flags', open.length)}${kpi('High severity', open.filter(x => x.severity === 'high').length)}${kpi('Sent to attorney', list.filter(x => ['referred', 'accepted'].includes(x.review.status)).length)}${kpi('Clients affected', Object.keys(byClient).length)}</div>` +
      `<div class="callout" style="margin-bottom:16px"><b>These are flags, not legal conclusions</b>Ledger compares your recorded dates, responses and reports with the deadlines in the FCRA and FDCPA. A consumer attorney decides whether there is a claim. Under FCRA §§ 616–617 consumers can recover damages and attorney’s fees, so many attorneys review these cases at no cost to the client. Get the client’s written permission before sharing their file, and check your state’s rules before accepting any referral fee.</div>` +
      (Object.keys(byClient).length ? Object.entries(byClient).map(([cid, xs]) => card(`<a href="#/clients/${cid}/disputes">${clientName(cid)}</a>`, `<div class="table-wrap"><table><thead><tr><th>What happened</th><th>Law</th><th>Status</th></tr></thead><tbody>${xs.map(x => `<tr><td>${sevBadge(x.severity)} <b>${esc(x.title)}</b><div class="small muted">${esc(x.detail)}</div>${x.review.attorney ? `<div class="small">Attorney: ${esc(x.review.attorney)}</div>` : ''}</td><td class="small">${esc(x.law)}</td><td><select data-act="vio-status" data-key="${esc(x.key)}" style="width:auto">${V.STATUS.map(([k, l]) => `<option value="${k}" ${k === x.review.status ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`,
        { flush: true, sub: `${xs.length} flag${xs.length > 1 ? 's' : ''}`, actions: `<button class="btn sm" data-act="vio-attorney" data-client="${cid}">Attorney</button><button class="btn sm primary" data-act="vio-packet" data-client="${cid}">${icon('print')} Attorney packet</button>` })).join('') : card('', empty('No violations flagged', 'Ledger checks every dispute for missed 30-day and 15-day deadlines, items that came back after deletion, accounts not marked disputed, and items reported past 7 years. Record responses and import new reports to keep this accurate.')));
  }
  function clientViolationsCard(c) {
    const n = root.Violations.scan(S(), T(), c.id).filter(x => !['closed', 'declined'].includes(x.review.status));
    return n.length ? `<div class="callout warn" style="margin-bottom:16px"><b>${n.length} possible FCRA violation${n.length > 1 ? 's' : ''}</b>${esc(n[0].title)}${n.length > 1 ? ` and ${n.length - 1} more` : ''}. <a href="#/violations?client=${c.id}">Review in the violation tracker</a></div>` : '';
  }

  // ---------- Address book (library tab) ----------
  function addressBook(q) {
    return `<div class="row" style="margin-bottom:12px"><input id="addr-q" type="search" placeholder="Search creditors, collectors, servicers…" value="${esc(q || '')}" style="max-width:420px"><button class="btn" data-act="addr-add">+ Add address</button></div><div id="addr-results">${addressList(q)}</div>`;
  }
  function addressList(q) {
    const F = root.Furnishers;
    const list = F.search(S(), q || '');
    const origin = { research: 'Researched', saved: 'Saved', history: 'Used before' };
    return card('', list.length ? `<div class="table-wrap"><table><thead><tr><th>Company</th><th>Type</th><th>Dispute / correspondence address</th><th>Source</th></tr></thead><tbody>${list.map(e => `<tr><td><b>${esc(e.name)}</b>${(e.aliases || []).length ? `<div class="small muted">${esc(e.aliases.join(', '))}</div>` : ''}</td><td class="small">${esc(e.category || '')}</td><td class="small" style="white-space:pre-line">${esc(e.address)}${e.phone ? '\n' + esc(e.phone) : ''}</td><td class="small">${e.source ? `<a href="${esc(e.source)}" target="_blank" rel="noopener">${esc(origin[e.origin] || e.origin)} ↗</a>` : esc(origin[e.origin] || e.origin)}${e.verifiedOn ? `<div class="muted">checked ${esc(e.verifiedOn)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No matches', 'Add the address once and Ledger fills it in on every future letter.'), { flush: true }) +
      `<p class="small muted">Addresses change. Check the company’s website or the address printed on its most recent statement or collection letter before mailing.</p>`;
  }

  // ---------- Dispute sequences ----------
  const SEQ_BADGE = { due: 'b-accent', active: 'b-info', won: 'b-ok', attorney: 'b-med', stopped: 'b-low' };
  function seqCard(q, showClient) {
    const Sq = root.Sequences, t = T();
    const c = Store.get.client(q.clientId);
    const st = Sq.status(S(), q, t);
    const list = S().disputes.filter(d => d.seqId === q.id).sort((a, b) => Sq.stepOf(S(), a) - Sq.stepOf(S(), b) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const rows = list.map(d => {
      const n = Sq.stepOf(S(), d);
      const ds = Store.disputeState(d);
      const until = !d.outcome && !list.some(x => x.parentId === d.id) && Sq.waitUntil(d);
      return `<tr><td><b>Letter ${n}</b></td><td><a href="#/disputes/${d.id}">${esc(Law.DISPUTE_TYPES[d.type].label)}</a></td><td>${esc(d.recipient)}</td><td>${dBadge(ds)}</td><td class="small muted">${d.sentAt ? 'mailed ' + date(d.sentAt) : 'not mailed'}${until ? ' · next letter ' + date(until) : ''}</td></tr>`;
    }).join('');
    const actions = q.status === 'stopped'
      ? `<button class="btn sm" data-act="seq-resume" data-id="${q.id}">Resume</button>`
      : `${st.state === 'due' ? `<button class="btn sm primary" data-act="seq-run" data-id="${q.id}">Draft next letters</button>` : ''}<button class="btn sm" data-act="seq-preview" data-id="${q.id}">Preview all letters</button><button class="btn sm ghost" data-act="seq-stop" data-id="${q.id}">Stop</button>`;
    return card(`${showClient && c ? `<a href="#/clients/${c.id}/disputes">${esc(c.name)}</a> · ` : ''}${esc(q.title)}`,
      `<div class="table-wrap"><table><thead><tr><th>Step</th><th>Letter</th><th>To</th><th>Status</th><th>Dates</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      { flush: true, sub: `<span class="badge plain ${SEQ_BADGE[st.state] || ''}">${esc(st.label)}</span>${st.next ? ' · next check ' + date(st.next) : ''} · started ${date(q.startedAt)}`, actions });
  }

  function sequences() {
    const Sq = root.Sequences, t = T();
    const all = (S().sequences || []).slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const due = all.filter(q => Sq.status(S(), q, t).state === 'due').length;
    const how = card('How sequences work', `<ul class="steps">${Sq.PLAN.map(p => `<li><span class="tick on">${p.n}</span><div class="grow"><b>${esc(p.title)}</b><div class="small muted">${esc(p.text)}</div></div></li>`).join('')}</ul>
      <p class="small muted">Ledger checks every sequence when you open the app and drafts the next letters when they are due. Each letter still needs the client’s confirmation and your approval, then goes out in <b>Send round</b>. Record each response (Deleted, Verified, No response…) on the dispute so the sequence knows what to do next. Removed items stop automatically.</p>`);
    return head('Dispute sequences', 'Letter 1 → 2 → 3 → attorney review, drafted automatically on schedule',
      `${due ? `<button class="btn primary" data-act="seq-run">Draft all due letters (${due})</button>` : ''}<button class="btn${due ? '' : ' primary'}" data-act="templates" data-seq="1">+ New sequence</button>`) +
      `<div class="grid g-main"><div class="stack">${all.length ? all.map(q => seqCard(q, true)).join('') : card('', empty('No sequences yet', 'Click <b>New sequence</b>, pick a letter template, and tick <b>Run as a sequence</b>. Or open any dispute and click <b>Run as sequence</b>.'))}</div><div class="stack">${how}</div></div>`;
  }

  function nextStep(d, letter, cs, st) {
    if (!letter) return `<p class="small">Generate the letter, review every statement with the client, then approve it.</p><button class="btn primary" data-act="gen-letter" data-id="${d.id}">Generate letter</button>`;
    if (letter.status === 'draft') return `<p class="small">The client must confirm every statement is true before approval.</p><label class="check small" style="margin-bottom:10px"><input type="checkbox" id="confirm-true"> Client reviewed and confirmed this letter</label><button class="btn primary" data-act="approve-letter" data-id="${d.id}" ${cs.cleared ? '' : 'disabled'}>${icon('check')} Approve letter</button>`;
    if (d.status === 'ready') return `<p class="small">${Store.remote ? 'Mail it online (Lob prints and mails it, certified if you choose, and saves the tracking number), or mail it yourself and record the mailing.' : 'Mail by certified mail with return receipt and record the tracking number.'}</p>${Store.remote ? `<button class="btn primary" data-act="mail-lob" data-id="${d.id}" ${cs.cleared ? '' : 'disabled'}>${icon('mail')} Mail online</button> ` : ''}<button class="btn ${Store.remote ? '' : 'primary'}" data-act="mark-sent" data-id="${d.id}" ${cs.cleared ? '' : 'disabled'}>${Store.remote ? 'I mailed it myself' : icon('mail') + ' Record mailing'}</button><button class="btn" data-act="unapprove" data-id="${d.id}" style="margin-left:6px">Back to draft</button>`;
    if (!d.outcome) return `<p class="small">${st === 'overdue' ? '<b style="color:var(--high)">The response period has passed.</b> Record “no response” and follow up.' : 'Waiting for the response. Record it when the results arrive.'}</p><button class="btn primary" data-act="record-response" data-id="${d.id}">Record response</button>${['cra_611', 'furnisher_623', 'obsolete_605', 'reinsertion_611'].includes(d.type) ? `<button class="btn" data-act="mark-received" data-id="${d.id}" style="margin-left:6px">Set received date</button>` : ''}`;
    const follow = { verified: 'Request the method of verification, dispute directly with the furnisher with new evidence, or add a consumer statement (§ 611(b)).', frivolous: 'The bureau must say what information it needs. Provide it and re-submit.', no_response: 'Information that cannot be verified within the period must be deleted (§ 611(a)(5)(A)). Send a follow-up and consider a CFPB complaint.', deleted: 'Watch for reinsertion — the bureau must notify the consumer within 5 business days if it is reinserted.', corrected: 'Pull updated reports to confirm the correction at every bureau.' }[d.outcome] || '';
    return `<p class="small">${dBadge(d.outcome)} ${date(d.respondedAt)}</p><p class="small">${esc(follow)}</p>${['verified', 'frivolous', 'no_response'].includes(d.outcome) ? (() => { const n = Law.nextStrategy(d.type, d.outcome, (Law.DISPUTE_TYPES[d.type] || {}).recipient); return n && n.type ? `<button class="btn primary" data-act="next-round" data-id="${d.id}">Draft Letter ${n.step}: ${esc(Law.DISPUTE_TYPES[n.type].label)}</button>` : `<div class="callout warn"><b>Step 4 — attorney review</b>${esc(n ? n.reason : '')}</div>`; })() : ''}`;
  }

  // ---------- Audit queue ----------
  function audit() {
    const rows = [];
    S().clients.filter(c => !['cancelled', 'completed'].includes(c.status)).forEach(c => clientFindings(c.id).forEach(f => rows.push(Object.assign({ client: c }, f))));
    const high = rows.filter(r => r.severity === 'high');
    return head('Metro 2 audit queue', `${high.length} high-severity findings across ${new Set(rows.map(r => r.client.id)).size} clients`) +
      card('', rows.length ? `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Client</th><th>Tradeline</th><th>Finding</th><th>Basis</th></tr></thead><tbody>${rows.map(r => `<tr class="click" data-href="#/clients/${r.client.id}/audit"><td>${sevBadge(r.severity)}</td><td>${esc(r.client.name)}</td><td><b>${esc(r.creditor)}</b><div class="small muted">${esc(r.bureau)}</div></td><td><b>${esc(r.title)}</b><div class="small muted">${esc(r.detail)}</div></td><td class="small">${esc(r.basis)}</td></tr>`).join('')}</tbody></table></div>` : empty('No findings', 'Import credit reports to run the audit.'), { flush: true });
  }

  // ---------- Billing ----------
  function billing() {
    const inv = S().invoices;
    const sum = st => inv.filter(i => i.status === st).reduce((a, i) => a + Number(i.amount || 0), 0);
    return head('Billing', 'Fees are invoiced only after the service is fully performed', `<button class="btn" data-act="export-invoices">${icon('download')} CSV</button><button class="btn primary" data-act="new-invoice">${icon('plus')} Invoice</button>`) +
      `<div class="grid g4" style="margin-bottom:16px">${kpi('Collected', money(sum('paid')))}${kpi('Outstanding', money(sum('issued')))}${kpi('Invoices', inv.length)}${kpi('Voided', inv.filter(i => i.status === 'void').length)}</div>` +
      `<div class="callout" style="margin-bottom:16px"><b>CROA billing rules built in</b>An invoice must point to a completed service (for example, a dispute already mailed) dated after the cancellation period. Ledger refuses to issue invoices that would be advance fees (15 U.S.C. § 1679b(b)). If services are sold by telephone, the FTC Telemarketing Sales Rule imposes a similar advance-fee ban.</div>` +
      (() => { const B = root.Billing, bs = B.settings(S()), dueList = B.due(S(), T()); return card('Automatic billing', `<form data-form="billing"><div class="form-grid">
        ${UI.field('Billing model', 'model', bs.model, { type: 'select', options: B.MODELS, cls: 'span2', help: 'Each client can override this on their profile' })}
        ${UI.field('Per letter ($)', 'perLetter', bs.perLetter, { type: 'number', attrs: 'step="0.01" min="0"' })}${UI.field('Per deletion ($)', 'perDelete', bs.perDelete, { type: 'number', attrs: 'step="0.01" min="0"' })}
        ${UI.field('Monthly ($)', 'monthly', bs.monthly, { type: 'number', attrs: 'step="0.01" min="0"' })}${UI.field('Days to pay', 'dueDays', bs.dueDays, { type: 'number', attrs: 'min="0"' })}
        ${UI.field('Online payments', 'provider', bs.provider, { type: 'select', options: [['none', 'Off — mark invoices paid by hand'], ['authorizenet', 'Authorize.net (connect in Settings)'], ['link', 'My own payment link']], cls: 'span2' })}
        ${UI.field('Payment link (if using your own)', 'payLink', bs.payLink, { cls: 'span2', placeholder: 'https://…', help: 'e.g. a payment page from your processor. Clients see it on invoice emails.' })}
        </div><div class="row" style="margin-top:12px"><button class="btn primary">Save</button>${dueList.length ? `<button type="button" class="btn" data-act="bill-now">Create ${dueList.length} due invoice${dueList.length > 1 ? 's' : ''} now</button>` : '<span class="small muted">No invoices due right now.</span>'}</div></form>
        <p class="small muted" style="margin-top:10px">With a billing model on, Ledger creates invoices automatically each time you open the app — only for work already done and only after the cancellation period. Turn on the “Invoice issued” automation to email them.</p>`, { sub: 'Invoices are created only after the work is done' }); })() +
      card('All invoices', invoiceTable(inv.slice(), true), { flush: true });
  }

  // ---------- Compliance ----------
  function compliance() {
    const s = S();
    const co = s.settings.company;
    const al = alerts();
    const program = [
      ['Separate rights disclosure before contract (§ 1679c)', s.clients.filter(c => c.status !== 'lead' && c.kind !== 'business').every(c => c.onboarding && c.onboarding.disclosureSignedAt)],
      ['Written contract with terms, total cost, timing and cancellation form (§ 1679d, § 1679e)', s.clients.filter(c => c.status !== 'lead' && c.kind !== 'business').every(c => c.onboarding && c.onboarding.contractSignedAt)],
      ['No fees before services are fully performed (§ 1679b(b))', !al.some(a => a.text.includes('1679b'))],
      ['No services during the 3-business-day cancellation period (§ 1679d(a)(2))', !al.some(a => a.text.includes('before onboarding'))],
      ['Company details on file for documents', !!(co.name && co.address)],
      ['State registration / surety bond recorded (where required)', !!(co.registration || co.bondNumber)]
    ];
    return head('Compliance center', 'CROA, FCRA and state-law safeguards for the whole program') +
      `<div class="grid g-main"><div class="stack">
        ${card('Open alerts', al.length ? `<ul class="list">${al.map(a => `<li><span class="dot" style="background:var(--${a.sev === 'high' ? 'high' : a.sev === 'medium' ? 'med' : 'low'})"></span><div class="grow"><a href="${a.link}">${esc(a.text)}</a></div>${sevBadge(a.sev)}</li>`).join('')}</ul>` : `<div class="callout good" style="margin:16px"><b>No open alerts</b></div>`, { flush: true })}
        ${card('Letter & marketing checker', `<p class="small muted">Paste any letter, ad, script or web copy. Ledger flags claims that are deceptive under CROA § 1679b(a) or the FTC Act.</p><textarea id="lint-in" rows="6" placeholder="e.g. We guarantee to remove all negative items in 30 days…"></textarea><div class="row" style="margin-top:10px"><button class="btn primary" data-act="lint">Check text</button></div><div id="lint-out" style="margin-top:12px"></div>`)}
        ${card('Client agreement status', `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Disclosure</th><th>Contract</th><th>Cancel deadline</th><th>Retain records until</th></tr></thead><tbody>${s.clients.filter(c => c.status !== 'lead' && c.kind !== 'business').map(c => { const cs = Store.croaStatus(c); const o = c.onboarding || {}; return `<tr class="click" data-href="#/clients/${c.id}/compliance"><td>${esc(c.name)}</td><td>${o.disclosureSignedAt ? date(o.disclosureSignedAt) : '<span class="badge b-high">Missing</span>'}</td><td>${o.contractSignedAt ? date(o.contractSignedAt) : '<span class="badge b-high">Missing</span>'}</td><td>${cs.deadline ? date(cs.deadline) : '—'}</td><td>${cs.retainUntil ? date(cs.retainUntil) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No enrolled clients</td></tr>'}</tbody></table></div>`, { flush: true })}
      </div><div class="stack">
        ${card('Program checklist', `<ul class="steps">${program.map(([l, ok]) => `<li><span class="tick ${ok ? 'on' : ''}">${ok ? '✓' : ''}</span><div class="grow small">${esc(l)}</div></li>`).join('')}</ul>`)}
        ${card('Standing rules', `<ul class="small" style="padding-left:18px;margin:0">
          <li>Never advise a client to make an untrue or misleading statement to a bureau or creditor (§ 1679b(a)(1)).</li>
          <li>Never suggest a new identity, CPN or EIN in place of an SSN (§ 1679b(a)(2)).</li>
          <li>Never promise results or a score increase (§ 1679b(a)(3)–(4)).</li>
          <li>Dispute only what the consumer identifies as inaccurate, with the reason. Mass or repeat disputes of accurate items can be ignored as frivolous and have led to enforcement.</li>
          <li>Many states require registration and a surety bond; some prohibit fees entirely. Check your state before enrolling clients.</li>
          <li>Protect SSNs, reports and IDs: encrypt devices, limit access, and delete what you no longer need.</li></ul>`)}
        ${card('Documents', `<ul class="list"><li><div class="grow">Rights disclosure (§ 1679c)</div><button class="btn sm" data-act="print-doc" data-doc="disclosure">${icon('print')}</button></li><li><div class="grow">Agreement template</div><button class="btn sm" data-act="print-doc" data-doc="contract">${icon('print')}</button></li><li><div class="grow">Notice of Cancellation</div><button class="btn sm" data-act="print-doc" data-doc="cancel">${icon('print')}</button></li></ul>`, { flush: true })}
      </div></div>`;
  }

  // ---------- Library ----------
  function sectionTab(tab) {
    const secs = root.Library.SECTIONS.filter(x => x.tab === tab);
    if (!secs.length) return '';
    return `<div class="stack">${secs.map(sec => card(esc(sec.title), `${sec.intro ? `<p class="small muted" style="margin-bottom:10px">${esc(sec.intro)}</p>` : ''}<dl class="lib-dl">${sec.items.map(([t, b]) => `<div><dt>${esc(t)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>`)).join('')}</div>`;
  }
  function libraryResults(q) {
    const hits = root.Library.search(q);
    if (String(q || '').trim().length < 2) return '';
    if (!hits.length) return '<p class="small muted" style="padding:8px 2px">No matches.</p>';
    const label = Object.fromEntries(root.Library.TABS);
    return `<ul class="list card" style="margin-top:8px">${hits.slice(0, 25).map(h => `<li><div class="grow"><a href="#/library?tab=${h.tab}"><b>${esc(h.term)}</b></a> <span class="badge b-low plain">${esc(label[h.tab] || h.tab)}</span><div class="small">${esc(h.text)}</div></div></li>`).join('')}</ul>`;
  }

  function library(params) {
    const tab = params.tab || 'overview';
    const tabs = root.Library.TABS;
    const table = (obj, h1, h2) => `<div class="table-wrap"><table><thead><tr><th style="width:90px">${h1}</th><th>${h2}</th></tr></thead><tbody>${Object.entries(obj).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
    const body = {
      metro2: `<div class="grid g2">${card('Account Status (Base 17A)', table(Metro2.ACCOUNT_STATUS, 'Code', 'Meaning'), { flush: true })}<div class="stack">${card('Payment History Profile (Base 18)', table(Metro2.PAYMENT_HISTORY, 'Char', 'Meaning'), { flush: true, sub: '24 months, most recent month first' })}${card('Compliance Condition Codes (Base 20)', table(Metro2.COMPLIANCE_CONDITION, 'Code', 'Meaning'), { flush: true })}</div>
        ${card('ECOA (Base 37)', table(Metro2.ECOA, 'Code', 'Meaning'), { flush: true })}${card('Consumer Information Indicator (Base 38)', table(Metro2.CONSUMER_INFO_INDICATOR, 'Code', 'Meaning'), { flush: true })}
        ${card('Portfolio type', table(Metro2.PORTFOLIO_TYPE, 'Code', 'Meaning'), { flush: true })}${card('Special comments (selected)', table(Metro2.SPECIAL_COMMENT, 'Code', 'Meaning'), { flush: true })}</div>`,
      letters: card('Strategy ladder', `<ul class="steps">${Law.STRATEGY.map(x => `<li><span class="tick">${x.step}</span><div class="grow"><b>${esc(x.title)}</b><div class="small muted">${esc(x.when)}</div></div></li>`).join('')}</ul>`) + '<div style="height:16px"></div>' + card('Letter types and response windows', `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Law</th><th>Recipient</th><th>Window</th><th>Notes</th></tr></thead><tbody>${Object.values(Law.DISPUTE_TYPES).map(t => `<tr><td><b>${esc(t.label)}</b></td><td class="small">${esc(t.cite)}</td><td class="small">${esc(t.recipient)}</td><td class="small nowrap">${t.days ? t.days + (t.businessDays ? ' business days' : ' days') : '—'}</td><td class="small">${esc(t.note)}</td></tr>`).join('')}</tbody></table></div>`, { flush: true }) +
        `<div class="grid g3" style="margin-top:16px">${card('Reporting periods', '<ul class="small" style="padding-left:18px;margin:0"><li>Most negative items: 7 years from 180 days after the DOFD (§ 605(a), (c))</li><li>Bankruptcies: 10 years from the order for relief</li><li>Hard inquiries: generally 2 years (bureau policy)</li></ul>')}${card('Bureau duties', '<ul class="small" style="padding-left:18px;margin:0"><li>Notify the furnisher within 5 business days of a dispute</li><li>Delete information that cannot be verified</li><li>Send results within 5 business days of completion</li><li>Notice of a frivolous determination within 5 business days</li></ul>')}${card('Furnisher duties', '<ul class="small" style="padding-left:18px;margin:0"><li>Investigate disputes forwarded by a bureau (§ 623(b))</li><li>Report the account as disputed (§ 623(a)(3))</li><li>Report the DOFD within 90 days (§ 623(a)(5))</li><li>Correct and update inaccurate data (§ 623(a)(2))</li></ul>')}</div>`,
      overview: card('How Metro 2 dispute software works', `<div class="prose">
        <p>Furnishers (banks, lenders, collectors) send account data to Equifax, Experian and TransUnion every month in the <b>Metro 2® format</b> published by the Consumer Data Industry Association in its Credit Reporting Resource Guide. Each tradeline is a fixed-length Base Segment of 426 characters with fields such as Account Status, Payment Rating, a 24-month Payment History Profile, Current Balance, Amount Past Due, Date of First Delinquency, Compliance Condition Code and ECOA code.</p>
        <p>Because the fields depend on each other, many errors are detectable: an account cannot be “current” (status 11) and also show an amount past due; a paid account (status 13 or 61–65) must report a zero balance; a charged-off or collection account must carry a Date of First Delinquency. When the same account looks different at each bureau, at least one bureau has it wrong.</p>
        <h3>The workflow Ledger implements</h3>
        <ol><li><b>Intake & onboarding</b> — rights disclosure, contract, 3-business-day cancellation period, identity documents (CROA).</li>
        <li><b>Import reports</b> — one per bureau, tradelines mapped to Metro 2 fields.</li>
        <li><b>Audit</b> — internal-consistency rules, cross-bureau comparison, duplicate-debt detection and obsolescence dates.</li>
        <li><b>Client review</b> — the consumer confirms which items are actually inaccurate. Accurate negative items are not disputed.</li>
        <li><b>Letters</b> — specific, evidence-backed disputes to the right party: bureau (§ 611), furnisher (§ 623 / Reg V § 1022.43), collector (FDCPA § 809), identity-theft block (§ 605B).</li>
        <li><b>Tracking</b> — certified-mail tracking, received date, 30/45-day deadline, outcomes, method-of-verification and follow-up rounds, with a guard against frivolous repeat disputes.</li>
        <li><b>Billing</b> — invoices only for completed work, after the cancellation period.</li></ol>
        <h3>What “Metro 2 compliance” does not mean</h3>
        <p>Some products sell “Metro 2 letters” that claim any technical formatting flaw forces deletion of accurate debts. That is not what the law says: bureaus and furnishers must correct or delete <i>inaccurate, incomplete or unverifiable</i> information, and a dispute of accurate data can be dismissed as frivolous. Ledger uses Metro 2 knowledge to find real errors and explain them precisely.</p></div>`),
      addresses: addressBook(params.q),
      templates: (() => { const Tp = root.Templates; return `<p class="muted small" style="margin:0 0 14px">Click a template, choose the client, answer a few questions and Ledger writes the letter with the client’s name, address, date of birth and SSN last 4. One letter is created for each recipient you tick. Every statement must be confirmed true by the client.</p>` + Tp.CATS.map(([k, l, d]) => card(l, `<p class="small muted" style="margin:0 0 10px">${esc(d)}</p><div class="tpl-grid">${Tp.TEMPLATES.filter(t => t.cat === k).map(t => `<button type="button" class="tpl-card" data-act="use-template" data-tpl="${t.id}"><b>${esc(t.title)}</b><small>${esc(t.when)}</small><span class="small muted">${esc((Law.DISPUTE_TYPES[t.type] || {}).cite || '')}</span></button>`).join('')}</div>`)).join(''); })(),
      sources: card('Research sources', `<ul class="small" style="padding-left:18px;margin:0;line-height:1.9">
        <li><a href="https://www.law.cornell.edu/uscode/text/15/1679c" target="_blank" rel="noopener">15 U.S.C. § 1679c — CROA disclosures (Cornell LII)</a></li>
        <li><a href="https://www.law.cornell.edu/uscode/text/15/1679e" target="_blank" rel="noopener">15 U.S.C. § 1679e — Right to cancel (Cornell LII)</a></li>
        <li><a href="https://law.justia.com/codes/us/title-15/chapter-41/subchapter-ii-a" target="_blank" rel="noopener">15 U.S.C. ch. 41 subch. II-A — Credit Repair Organizations (Justia)</a></li>
        <li><a href="https://www.govinfo.gov/link/uscode/15/1679b" target="_blank" rel="noopener">15 U.S.C. § 1679b — Prohibited practices (GovInfo)</a></li>
        <li><a href="https://www.law.cornell.edu/uscode/text/15/1681i" target="_blank" rel="noopener">15 U.S.C. § 1681i — FCRA reinvestigations</a> · <a href="https://www.law.cornell.edu/uscode/text/15/1681s-2" target="_blank" rel="noopener">§ 1681s-2 — furnisher duties</a> · <a href="https://www.law.cornell.edu/uscode/text/15/1681c" target="_blank" rel="noopener">§ 1681c — obsolete information</a> · <a href="https://www.law.cornell.edu/uscode/text/15/1681c-2" target="_blank" rel="noopener">§ 1681c-2 — identity theft block</a></li>
        <li><a href="https://www.law.cornell.edu/uscode/text/15/1692g" target="_blank" rel="noopener">15 U.S.C. § 1692g — FDCPA validation</a> · <a href="https://www.law.cornell.edu/uscode/text/15/1692e" target="_blank" rel="noopener">§ 1692e — false representations</a> · <a href="https://www.law.cornell.edu/cfr/text/12/part-1006" target="_blank" rel="noopener">12 C.F.R. part 1006 — Regulation F</a></li>
        <li><a href="https://www.ftc.gov/news-events/news/press-releases/2023/10/ftc-cfpb-settlement-require-trans-union-pay-15-million-over-charges-it-failed-ensure-accuracy-tenant" target="_blank" rel="noopener">FTC/CFPB $15M TransUnion Rental Screening settlement — eviction records (2023)</a></li>
        <li><a href="https://www.consumerfinance.gov/rules-policy/final-rules/prohibition-on-creditors-and-consumer-reporting-agencies-concerning-medical-information-regulation-v/" target="_blank" rel="noopener">CFPB medical debt rule — vacated July 11, 2025 (CFPB page)</a></li>
        <li><a href="https://www.law.cornell.edu/cfr/text/12/1022.43" target="_blank" rel="noopener">12 C.F.R. § 1022.43 — direct disputes (Regulation V)</a></li>
        <li><a href="https://docs.tech.sofi.com/pro/page/metro-2-base-segment" target="_blank" rel="noopener">Metro 2 Base Segment field layout & compliance condition codes (Galileo/SoFi furnisher docs)</a></li>
        <li><a href="https://metro2.switchlabs.dev/metro2/glossary" target="_blank" rel="noopener">Metro 2 glossary — DOFD, account status, CRRG (Switch Labs)</a></li>
        <li><a href="https://www.consumerfinancemonitor.com/2017/09/06/the-cfpb-shuts-down-another-credit-repair-service/" target="_blank" rel="noopener">CFPB enforcement against mass-dispute credit repair (Ballard Spahr)</a></li>
        <li><a href="https://intercom.help/crc-support/en/articles/9190950" target="_blank" rel="noopener">Credit Repair Cloud help — client-selected disputes</a> · <a href="https://dupple.com/reviews/credit" target="_blank" rel="noopener">Credit repair software feature review</a></li></ul>
        <p class="small muted" style="margin-top:12px">The CDIA Credit Reporting Resource Guide is the authoritative Metro 2 specification and is licensed by CDIA. Ledger is workflow software, not legal advice.</p>`)
    }[tab] || sectionTab(tab);
    return head('Library', 'Credit repair reference: Metro 2, the law, evidence, scores, business credit and scripts', '') + `<div class="lib-search"><input id="lib-q" type="search" placeholder="Search the library — e.g. judgment, eviction, validation, DOFD…" autocomplete="off"><div id="lib-results"></div></div><div class="tabs">${tabs.map(([k, l]) => `<a href="#/library?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div>` + body;
  }

  // ---------- Business credit ----------
  const KIND = { personal: ['Personal', 'b-low'], business: ['Business', 'b-info'], both: ['Personal + business', 'b-accent'] };
  const kindBadge = k => { const [l, c] = KIND[k] || KIND.personal; return `<span class="badge ${c} plain">${l}</span>`; };

  function clientBusiness(c) {
    const B = root.Business;
    const b = c.business || {};
    const fz = B.fundability(c);
    const done = c.businessChecklist || {};
    const scores = (c.businessScores || []).slice().sort((x, y) => String(y.date).localeCompare(String(x.date)));
    const latest = {};
    scores.forEach(s => { if (!latest[s.model]) latest[s.model] = s; });
    const vendors = c.vendorAccounts || [];
    return `<div class="grid g4" style="margin-bottom:16px">
      ${kpi('Fundability foundation', fz.pct + '%', `${fz.done} of ${fz.total} items in place`)}
      ${B.SCORE_MODELS.filter(m => ['paydex', 'intelliscore', 'eqx-payment'].includes(m.key)).map(m => { const s = latest[m.key]; return kpi(m.bureau + ' · ' + m.name, s ? s.score : '—', s ? `as of ${date(s.date)} · ${m.lowerIsBetter ? (s.score <= m.good ? 'strong' : 'needs work') : (s.score >= m.good ? 'strong' : 'needs work')}` : `Range ${m.min}–${m.max}`); }).join('')}
    </div>
    <div class="grid g-main"><div class="stack">
      ${planCard(c)}
      ${card('Fundability checklist', `<form data-form="biz-checklist" data-id="${c.id}"><ul class="steps">${B.FOUNDATION.map(f => `<li><input type="checkbox" name="${f.key}" ${done[f.key] ? 'checked' : ''} style="margin-top:3px"><div class="grow"><b style="font-weight:550">${esc(f.label)}</b><div class="small muted">${esc(f.why)}${done[f.key] ? ' · done ' + date(done[f.key]) : ''}</div></div></li>`).join('')}</ul><div class="row" style="margin-top:8px"><button class="btn primary">Save checklist</button><div class="bar" style="flex:1;max-width:260px"><i style="width:${fz.pct}%"></i></div></div></form>`, { sub: 'What lenders and business bureaus check before extending credit' })}
      ${card('Vendor & credit tradelines', vendors.length ? `<div class="table-wrap"><table><thead><tr><th>Account</th><th>Terms</th><th>Reports to</th><th class="num">Limit</th><th>Opened</th><th>Status</th><th></th></tr></thead><tbody>${vendors.map(v => `<tr><td><b>${esc(v.vendor)}</b><div class="small muted">${esc(v.category || '')}</div></td><td class="small">${esc(v.terms || '')}</td><td class="small">${esc(v.reportsTo || '')}</td><td class="num">${money(v.limit)}</td><td class="small nowrap">${date(v.opened)}</td><td><span class="badge ${v.status === 'current' ? 'b-ok' : v.status === 'late' ? 'b-high' : 'b-low'}">${esc(v.status || 'applied')}</span></td><td class="right"><button class="btn sm ghost" data-act="edit-vendor" data-id="${c.id}" data-vid="${v.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : empty('No tradelines yet', 'Track net-30 vendors and business cards as they start reporting.'),
        { flush: true, actions: `<button class="btn sm" data-act="edit-vendor" data-id="${c.id}">${icon('plus')} Account</button>` })}
      ${card('Starter vendors', `<p class="small muted" style="margin-bottom:10px">Reporting practices change. Confirm with the vendor that it reports, and to which bureau, before counting on it.</p><div class="table-wrap"><table><tbody>${B.STARTER_VENDORS.map((v, i) => `<tr><td><b>${esc(v.vendor)}</b><div class="small muted">${esc(v.category)} · ${esc(v.terms)}</div></td><td class="small">${esc(v.reportsTo)}</td><td class="right"><button class="btn sm" data-act="add-starter-vendor" data-id="${c.id}" data-i="${i}">Track</button></td></tr>`).join('')}</tbody></table></div>`, { flush: false })}
    </div><div class="stack">
      ${card('Business profile', `<div class="small stack">${[['Legal name', b.legalName], ['DBA', b.dba], ['Entity', b.entityType], ['State of formation', b.stateOfFormation], ['Formed', b.formedOn ? date(b.formedOn) : ''], ['EIN', b.einLast4 ? '••-•••' + esc(b.einLast4) : ''], ['NAICS', b.naics], ['D-U-N-S', b.duns], ['Business phone', b.phone], ['Website', b.website]].map(([l, v]) => `<div class="row between"><span class="muted">${l}</span><span>${v ? esc(v) : '—'}</span></div>`).join('')}</div>`, { actions: `<button class="btn sm" data-act="edit-client" data-id="${c.id}">Edit</button>` })}
      ${card('Business scores', scores.length ? `<ul class="list">${scores.map(s => { const m = B.SCORE_MODELS.find(x => x.key === s.model) || {}; return `<li><div class="grow"><b>${esc(m.bureau || '')} ${esc(m.name || s.model)}</b><div class="meta">${date(s.date)}${s.source ? ' · ' + esc(s.source) : ''}</div></div><div class="score" style="font-size:20px">${esc(s.score)}</div></li>`; }).join('')}</ul>` : empty('No scores recorded', 'Pull business reports from Nav or the bureaus and log scores here.'), { flush: true, actions: `<button class="btn sm" data-act="add-biz-score" data-id="${c.id}">${icon('plus')} Score</button>` })}
      ${card('Correcting business files', `<p class="small">Business credit is not covered by the FCRA, so business bureaus take corrections through their own processes:</p><ul class="small" style="padding-left:18px;margin:6px 0">${Object.entries(B.BUREAU_CONTACTS).map(([k, v]) => `<li><b>${esc(k)}</b> — ${esc(v)}</li>`).join('')}</ul><button class="btn sm" data-act="new-dispute" data-client="${c.id}" data-type="business_correction">Draft correction request</button>`)}
      ${card('Score guide', `<ul class="small" style="padding-left:18px;margin:0">${B.SCORE_MODELS.map(m => `<li><b>${esc(m.name)}</b> (${esc(m.bureau)}, ${m.min}–${m.max}): ${esc(m.note)}</li>`).join('')}</ul>`)}
    </div></div>`;
  }

  function planCard(c) {
    const B = root.Business, t = T();
    const ps = B.planStatus(c, t);
    if (!ps) return card('90-day business credit plan', `<p class="small">A dated, step-by-step plan for a new business: foundation, free D-U-N-S Number, monitoring, starter vendor accounts that report, a credit-builder account, then store/fleet accounts and a 90-day review. Ledger creates a task for every step and ticks steps off as the checklist below is completed.</p><button class="btn primary" data-act="plan-start" data-id="${c.id}">Start the 90-day plan</button>`, { sub: 'Fast track for new companies — built on real, reporting accounts' });
    const pct = Math.round(ps.done / ps.total * 100);
    return card('90-day business credit plan', `<div class="row" style="margin-bottom:10px"><div class="bar" style="flex:1"><i style="width:${pct}%"></i></div><span class="small muted">${ps.done} of ${ps.total} steps</span></div><ul class="steps">${ps.steps.map(st => `<li><span class="tick ${st.complete ? 'on' : ''}" style="${st.overdue ? 'border-color:var(--high)' : ''}">${st.complete ? '✓' : ''}</span><div class="grow"><b style="font-weight:550">Day ${st.day} · ${esc(st.title)}</b><div class="small muted">${esc(st.how)}${st.url ? ` <a href="${esc(st.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div><div class="small ${st.overdue ? '' : 'muted'}" style="${st.overdue ? 'color:var(--high)' : ''}">${st.complete ? 'Done' : (st.overdue ? 'Overdue · was due ' : 'Due ') + date(st.due)}</div></div>${st.checklist ? '' : `<label class="check small"><input type="checkbox" data-act="plan-step" data-id="${c.id}" data-key="${st.key}" ${st.complete ? 'checked' : ''}> Done</label>`}</li>`).join('')}</ul>`,
      { sub: `Started ${date(ps.startedAt)}`, actions: `<button class="btn sm" data-act="plan-print" data-id="${c.id}">${icon('print')} Print plan</button>` });
  }

  // ---------- Buy a business (acquisition due diligence) ----------
  function clientAcquisition(c, cs, params) {
    const Aq = root.Acquisition, t = T();
    const deals = c.deals || [];
    const sel = deals.find(d => d.id === (params && params.deal)) || deals[0];
    const st = (c.business || {}).stateOfFormation || c.state || '';
    const finder = card('Find a business to buy', `<p class="small">Search live listings of operating businesses for sale, then add the ones worth a closer look and work through due diligence here.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><select id="aq-state" style="width:auto"><option value="">All states</option>${Object.entries(Aq.STATES).map(([k, v]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><button class="btn" data-act="aq-listings">Open live listings ↗</button><a class="btn ghost" href="${Aq.LINKS.sba()}" target="_blank" rel="noopener">SBA guide to buying a business ↗</a><button class="btn primary" data-act="aq-add" data-id="${c.id}">+ Add a business</button></div>
      <p class="small muted" style="margin-top:10px">Business credit history belongs to the legal entity. In a stock or membership-interest purchase the entity keeps its EIN, D-U-N-S Number and history; in an asset purchase the buyer’s company starts its own file. Always disclose the change of ownership accurately to lenders.</p>`);
    if (!sel) return `<div class="stack">${finder}${card('', empty('No target businesses yet', 'Add a business you are considering to start the due-diligence checklist.'))}</div>`;
    const e = Aq.evaluate(sel, t);
    const checks = sel.checks || {};
    const groups = [...new Set(Aq.CHECKS.map(x => x.group))];
    const list = deals.length > 1 ? `<div class="tabs" style="margin-bottom:12px">${deals.map(d => `<a href="#/clients/${c.id}/acquisition?deal=${d.id}" class="${d.id === sel.id ? 'active' : ''}">${esc(d.name)}</a>`).join('')}</div>` : '';
    return `<div class="stack">${finder}${list}
      <div class="grid g4">${kpi('Due diligence', e.pct + '%', `${e.done} of ${e.total} checks`)}${kpi('Issues found', e.issues, e.issues ? 'Resolve before closing' : 'None so far')}${kpi('Years in business', e.years === null ? '—' : e.years, sel.formedOn ? 'formed ' + date(sel.formedOn) : 'add formation date')}${kpi('Price ÷ earnings', e.multiple === null ? '—' : e.multiple + '×', e.revMultiple !== null ? e.revMultiple + '× revenue' : 'add SDE or revenue')}</div>
      ${e.flags.length ? `<div class="callout warn"><b>Red flags</b>${e.flags.map(f => esc(f.text)).join('<br>')}</div>` : ''}
      ${card(esc(sel.name), `<div class="small muted" style="margin-bottom:8px">${[sel.state && Aq.STATES[sel.state], sel.entityNumber && 'Entity # ' + sel.entityNumber, sel.askingPrice && 'Asking ' + money(sel.askingPrice), sel.structure].filter(Boolean).map(esc).join(' · ')}${sel.listingUrl ? ` · <a href="${esc(sel.listingUrl)}" target="_blank" rel="noopener">Listing ↗</a>` : ''}</div>
        ${groups.map(g => `<h3 style="margin:14px 0 6px">${esc(g)}</h3><div class="table-wrap"><table><tbody>${Aq.CHECKS.filter(x => x.group === g).map(x => { const s = checks[x.key] || {}; return `<tr><td><b style="font-weight:550">${esc(x.label)}</b><div class="small muted">${esc(x.why)}</div>${s.note ? `<div class="small">Note: ${esc(s.note)}</div>` : ''}</td><td class="nowrap">${x.link ? `<a class="btn sm ghost" href="${esc(x.link(sel))}" target="_blank" rel="noopener">${esc(x.linkText || 'Search')} ↗</a>` : ''}</td><td class="nowrap"><select data-act="aq-check" data-id="${c.id}" data-deal="${sel.id}" data-key="${x.key}" style="width:auto">${Aq.STATUS.map(([k, l]) => `<option value="${k}" ${k === (s.status || 'pending') ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn sm ghost" data-act="aq-note" data-id="${c.id}" data-deal="${sel.id}" data-key="${x.key}">Note</button></td></tr>`; }).join('')}</tbody></table></div>`).join('')}`,
        { actions: `<button class="btn sm" data-act="aq-edit" data-id="${c.id}" data-deal="${sel.id}">Edit</button><button class="btn sm" data-act="aq-print" data-id="${c.id}" data-deal="${sel.id}">${icon('print')} Report</button><button class="btn sm ghost danger" data-act="aq-delete" data-id="${c.id}" data-deal="${sel.id}">Remove</button>` })}
      <p class="small muted">This checklist organizes the review; it is not legal, tax or accounting advice. Have an attorney and CPA review the purchase agreement and structure before closing.</p></div>`;
  }
  // ---------- Partner recommendations ----------
  const stageLabel = k => (root.Partners.REFERRAL_STAGES.find(s => s[0] === k) || [k, k])[1];
  const offerStatus = st => { const [l, c] = root.Partners.STATUS_LABEL[st] || [st, 'b-low']; return `<span class="badge ${c}">${esc(l)}</span>`; };
  const trackedLink = r => (Store.remote ? location.origin : '') + '/go/' + r.id;
  function referralRows(list, showClient) {
    if (!list.length) return empty('No recommendations yet', 'Recommend a credit-builder or monitoring service that fits the client’s goals.');
    return `<div class="table-wrap"><table><thead><tr>${showClient ? '<th>Client</th>' : ''}<th>Offer</th><th>Stage</th><th>Recommended</th><th class="num">Clicks</th><th class="num">Commission</th><th></th></tr></thead><tbody>${list.map(r => {
      const o = S().offers.find(x => x.id === r.offerId) || {};
      return `<tr>${showClient ? `<td>${clientName(r.clientId)}</td>` : ''}<td><b>${esc(o.name || 'Removed offer')}</b><div class="small muted">${esc(o.category || '')}</div></td>
        <td><select data-act="ref-stage" data-id="${r.id}" style="width:auto;padding:4px 8px">${root.Partners.REFERRAL_STAGES.map(([k, l]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td class="small nowrap">${date(r.recommendedAt)}</td><td class="num">${r.clicks || 0}</td><td class="num">${r.payout ? money(r.payout) : '—'}</td>
        <td class="right nowrap"><button class="btn sm ghost" data-act="copy-ref-link" data-id="${r.id}" title="Copy tracked link">Copy link</button><button class="btn sm ghost" data-act="edit-ref" data-id="${r.id}">Edit</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function clientPartners(c) {
    const list = (S().partnerReferrals || []).filter(r => r.clientId === c.id);
    return `<div class="callout" style="margin-bottom:16px"><b>Recommend on merit</b>Only suggest products that help this client's goals, and tell the client you may be paid a referral fee. Products are always optional. Recommendations appear in the client portal with a disclosure.</div>` +
      card('Recommendations', referralRows(list, false), { flush: true, actions: `<button class="btn sm primary" data-act="new-ref" data-client="${c.id}">${icon('plus')} Recommend</button>` });
  }
  function partners() {
    const s = S();
    const refs = s.partnerReferrals || [];
    const earned = refs.filter(r => ['approved', 'paid'].includes(r.status)).reduce((a, r) => a + Number(r.payout || 0), 0);
    const paid = refs.filter(r => r.status === 'paid').reduce((a, r) => a + Number(r.payout || 0), 0);
    const clicks = refs.reduce((a, r) => a + (r.clicks || 0), 0) + s.offers.reduce((a, o) => a + (o.clicks || 0), 0);
    return head('Partner offers', 'Credit-builder, monitoring and business-credit programs you can refer clients to', `<button class="btn" data-act="new-offer">${icon('plus')} Custom offer</button><button class="btn primary" data-act="new-ref">${icon('plus')} Recommend to client</button>`) +
      `<div class="grid g4" style="margin-bottom:16px">${kpi('Recommendations', refs.length, `${refs.filter(r => r.status === 'signed_up' || r.status === 'approved' || r.status === 'paid').length} signed up`)}${kpi('Link clicks', clicks)}${kpi('Commissions earned', money(earned), 'approved + paid')}${kpi('Paid out', money(paid))}</div>
      <div class="callout warn" style="margin-bottom:16px"><b>Check terms before promoting</b>Affiliate payouts change often and third-party listings disagree. Each offer shows how well its terms were confirmed as of the research date. Paste your own affiliate link from each program's dashboard. Tracked links (<span class="mono">/go/…</span>) count clicks, then redirect.</div>
      <div class="grid g2">${s.offers.map(o => card(`${esc(o.name)} ${kindBadge(o.audience === 'business' ? 'business' : 'personal')}`, `
        <div class="row between small" style="margin-bottom:6px"><span class="muted">${esc(o.category)}</span>${offerStatus(o.status)}</div>
        <div class="grid g2 small" style="gap:6px 16px;margin-bottom:10px"><div><span class="muted">Program</span><br>${esc(o.program)}</div><div><span class="muted">Referral bonus</span><br><b>${esc(o.bonus)}</b></div><div><span class="muted">Cookie</span><br>${esc(o.cookie)}</div><div><span class="muted">Clicks</span><br>${(o.clicks || 0) + refs.filter(r => r.offerId === o.id).reduce((a, r) => a + (r.clicks || 0), 0)}</div></div>
        <p class="small">${esc(o.note || '')}</p>
        <form data-form="offer" data-id="${o.id}" class="row" style="margin-top:8px;flex-wrap:nowrap"><input name="affiliateUrl" value="${esc(o.affiliateUrl || '')}" placeholder="Paste your affiliate / referral link (https://…)" class="small"><button class="btn sm">Save</button></form>
        <div class="row small" style="margin-top:10px">${o.joinUrl ? `<a href="${esc(o.joinUrl)}" target="_blank" rel="noopener">Join program ↗</a>` : ''}<a href="${esc(o.url)}" target="_blank" rel="noopener">Website ↗</a>${(o.sources || []).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener" class="muted">source ${i + 1}</a>`).join('')}<label class="check" style="margin-left:auto"><input type="checkbox" data-act="offer-toggle" data-id="${o.id}" ${o.enabled ? 'checked' : ''}> Show to clients</label></div>`)).join('')}</div>
      <div style="margin-top:16px">${card('Referral pipeline', referralRows(refs.slice().sort((a, b) => String(b.recommendedAt).localeCompare(String(a.recommendedAt))), true), { flush: true })}</div>
      <div style="margin-top:16px">${card('Client-facing disclosure', `<p class="small">${esc(root.Partners.DISCLOSURE)}</p><p class="small muted">This appears next to recommendations in the client portal. The FTC requires clear disclosure of material connections such as referral fees.</p>`)}</div>`;
  }

  // ---------- Team (server mode) ----------
  function team() {
    return head('Team & security', 'Staff accounts, client portal access and the audit log') + `<div id="team-root">${card('', '<p class="muted">Loading…</p>')}</div>`;
  }

  // ---------- Referrals ----------
  function referrals() {
    const list = S().referrals;
    return head('Referral sources', 'Mortgage brokers, realtors, dealers and others who send clients to you', `<button class="btn primary" data-act="new-referral">${icon('plus')} Partner</button>`) +
      card('', list.length ? `<div class="table-wrap"><table><thead><tr><th>Partner</th><th>Company</th><th>Commission</th><th class="num">Referred</th><th class="num">Active</th><th class="num">Earned</th><th class="num">Owed</th><th></th></tr></thead><tbody>${list.map(r => { const cl = S().clients.filter(c => c.referralId === r.id); const k = root.Sales.commissions(S(), r, T()); return `<tr><td><b>${esc(r.name)}</b><div class="small muted">${esc(r.email || '')}</div></td><td>${esc(r.company || '')}</td><td class="small">${esc(r.commissionType === 'flat' ? money(r.commissionAmount) + ' per enrolled client' : r.commissionType === 'percent' ? r.commissionAmount + '% of paid invoices' : r.commission || '—')}</td><td class="num">${cl.length}</td><td class="num">${cl.filter(c => c.status === 'active').length}</td><td class="num">${money(k.earned)}</td><td class="num"><b>${money(k.owed)}</b></td>
        <td class="right nowrap"><button class="btn sm ghost" data-act="ref-link" data-id="${r.id}" title="Copy this partner's sign-up link">Link</button>${Store.remote ? `<button class="btn sm ghost" data-act="ref-invite" data-id="${r.id}">Portal invite</button>` : ''}${k.owed > 0 ? `<button class="btn sm ghost" data-act="ref-payout" data-id="${r.id}">Record payout</button>` : ''}<button class="btn sm ghost" data-act="edit-referral" data-id="${r.id}">Edit</button></td></tr>`; }).join('')}</tbody></table></div>` : empty('No partners yet', 'Track who refers clients and what you owe them.'), { flush: true }) +
      `<p class="small muted">Partners can log in to a partner portal to get their link, see their referrals’ stage and their commissions. A referred client’s progress is shown only if the client agreed (Edit client → “Share progress with referrer”). Some states restrict paying referral fees — check yours.</p>`;
  }

  // ---------- Settings ----------
  function settings() {
    const s = S().settings;
    const co = s.company;
    return head('Settings', 'Company profile, defaults and your data') + `<div class="grid g2"><div class="stack">
      ${card('Company', `<form data-form="company"><div class="form-grid">
        ${UI.field('Company name', 'name', co.name, { cls: 'span2' })}
        ${UI.field('Mailing address', 'address', co.address, { type: 'textarea', rows: 2, cls: 'span2', help: 'Printed on the Notice of Cancellation' })}
        ${UI.field('Phone', 'phone', co.phone)}${UI.field('Email', 'email', co.email)}
        ${UI.field('State', 'state', co.state)}${UI.field('Website', 'website', co.website)}
        ${UI.field('Booking link', 'bookingUrl', co.bookingUrl, { cls: 'span2', placeholder: 'https://calendly.com/…', help: 'Used in lead follow-up messages so prospects can book a consultation' })}
        ${UI.field('State registration #', 'registration', co.registration)}${UI.field('Surety bond #', 'bondNumber', co.bondNumber)}
        ${UI.field('Default fee terms', 'defaultFee', s.defaultFee, { type: 'textarea', rows: 2, cls: 'span2', help: 'Used in the agreement template' })}
        ${UI.field('Mail transit days', 'mailTransitDays', s.mailTransitDays, { type: 'number', help: 'Estimated delivery used to compute deadlines until the received date is known' })}
      </div><div class="row" style="margin-top:14px"><button class="btn primary">Save</button></div></form>`)}
    </div><div class="stack">
      ${card('Your data', `<p class="small muted">${Store.remote ? 'Everything is saved on your Ledger server, encrypted. Export a backup now and then for your records — the file contains client personal information, so keep it private.' : 'Everything is stored in this browser only. Export regular backups — the file contains client personal information, so keep it encrypted and private.'}</p>
        <div class="row" style="margin-top:10px"><button class="btn" data-act="export">${icon('download')} Export backup</button><button class="btn" data-act="import">${icon('upload')} Import backup</button><button class="btn" data-act="csv-template">${icon('download')} Tradeline CSV template</button></div>
        <p class="small muted" style="margin-top:10px">Imports accept Ledger v1 backups (<span class="mono">ledger-workspace-backup.json</span>) and v2 workspaces. v1 letters become round-1 disputes so their deadlines can be tracked.</p>`)}
      ${Store.remote ? card('Print & mail', '<div id="mail-settings"><p class="small muted">Loading…</p></div>', { sub: 'Mail letters (first-class or certified) from Ledger through Lob' }) : ''}
      ${Store.remote ? card('Online payments', '<div id="pay-settings"><p class="small muted">Loading…</p></div>', { sub: 'Clients pay invoices on Authorize.net’s secure page' }) : ''}
      ${Store.remote ? card('AI settings', '<div id="ai-settings"><p class="small muted">Loading…</p></div>', { sub: 'Anthropic API key for Ledger AI, report scanning and round planning' }) : ''}
      ${Store.remote ? '' : card('AI in this browser', `<p class="small">${root.AIDirect && root.AIDirect.getKey() ? '<span class="badge b-ok">On</span> AI scanning works in this file using your Anthropic API key.' : 'Add your own Anthropic API key to scan credit reports with AI right here — no server needed. The key stays in this browser and is never included in backups.'}</p><div class="row" style="margin-top:10px"><button class="btn primary" data-act="ai-key">${root.AIDirect && root.AIDirect.getKey() ? 'Change key' : 'Add API key'}</button><a class="btn ghost" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Get a key ↗</a></div>`)}
      ${card('Demo & reset', `<div class="row"><button class="btn" data-act="load-demo">Load demo data</button><button class="btn danger" data-act="reset">Erase workspace</button></div>`)}
    </div></div>`;
  }

  root.Views = { pipeline, automations, violations, addressBook, addressList, sequences, seqCard, libraryResults, dashboard, clients, client, disputes, dispute, audit, billing, compliance, library, referrals, partners, team, settings, kindBadge, clientFindings, alerts, openDisputes, repeatRisk };
})(typeof window !== 'undefined' ? window : globalThis);
