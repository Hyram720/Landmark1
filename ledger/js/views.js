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
      `<button class="btn" data-act="new-task">${icon('plus')} Task</button><button class="btn primary" data-act="new-client">${icon('plus')} New client</button>`) +
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
    const list = S().clients.filter(c => filter === 'all' || c.status === filter).sort((a, b) => a.name.localeCompare(b.name));
    const tabs = ['all', 'lead', 'onboarding', 'active', 'paused', 'completed', 'cancelled'];
    return head('Clients', `${S().clients.length} total`, `<button class="btn" data-act="import-client-csv">${icon('upload')} Import</button><button class="btn primary" data-act="new-client">${icon('plus')} New client</button>`) +
      `<div class="tabs">${tabs.map(tb => `<a href="#/clients?q=${tb}" class="${tb === filter ? 'active' : ''}">${tb === 'all' ? 'All' : UI.CSTATE[tb][0]} <span class="muted">${tb === 'all' ? S().clients.length : S().clients.filter(c => c.status === tb).length}</span></a>`).join('')}</div>` +
      card('', list.length ? `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Status</th><th>CROA onboarding</th><th class="num">Findings</th><th class="num">Open disputes</th><th>Latest scores</th><th>Added</th></tr></thead><tbody>
        ${list.map(c => {
          const cs = Store.croaStatus(c);
          const f = clientFindings(c.id).filter(x => x.severity !== 'low').length;
          const od = openDisputes().filter(d => d.clientId === c.id).length;
          const scores = Store.get.latestByBureau(c.id).map(r => r.scores && r.scores[r.bureau] ? `${r.bureau[0]}${r.bureau === 'TransUnion' ? 'U' : r.bureau === 'Equifax' ? 'Q' : 'X'} ${r.scores[r.bureau]}` : '').filter(Boolean).join(' · ');
          return `<tr class="click" data-href="#/clients/${c.id}"><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.email || c.phone || '')}</div></td><td>${cBadge(c.status)}</td>
            <td>${cs.cancelled ? '<span class="badge b-high">Cancelled</span>' : cs.cleared ? '<span class="badge b-ok">Cleared</span>' : cs.inWindow ? `<span class="badge b-info">Window to ${date(cs.deadline)}</span>` : `<span class="badge b-low">${cs.steps.filter(x => x.done).length}/6 steps</span>`}</td>
            <td class="num">${f || '<span class="muted">0</span>'}</td><td class="num">${od || '<span class="muted">0</span>'}</td><td class="small">${scores || '<span class="muted">—</span>'}</td><td class="small muted nowrap">${date(c.createdAt)}</td></tr>`;
        }).join('')}</tbody></table></div>` : empty('No clients here', 'Add a client to start onboarding.', `<button class="btn primary" data-act="new-client" style="margin-top:8px">${icon('plus')} New client</button>`), { flush: true });
  }

  function client(params) {
    const c = Store.get.client(params.id);
    if (!c) return empty('Client not found', '<a href="#/clients">Back to clients</a>');
    const tab = params.tab || 'overview';
    const tabs = [['overview', 'Overview'], ['reports', 'Credit reports'], ['audit', 'Metro 2 audit'], ['disputes', 'Disputes'], ['billing', 'Billing'], ['compliance', 'Agreements'], ['activity', 'Activity']];
    const cs = Store.croaStatus(c);
    const nFind = clientFindings(c.id).filter(f => f.severity !== 'low').length;
    const body = { overview: clientOverview, reports: clientReports, audit: clientAudit, disputes: clientDisputes, billing: clientBilling, compliance: clientCompliance, activity: clientActivity }[tab](c, cs);
    return head(`${esc(c.name)} ${cBadge(c.status)}`, [c.email, c.phone, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).map(esc).join(' · '),
      `<button class="btn" data-act="progress-report" data-id="${c.id}">${icon('print')} Progress report</button><button class="btn" data-act="edit-client" data-id="${c.id}">Edit</button><button class="btn primary" data-act="add-report" data-id="${c.id}">${icon('plus')} Add report</button>`,
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
    const wins = ds.filter(d => ['deleted', 'corrected', 'blocked'].includes(d.outcome)).length;
    const tasks = S().tasks.filter(x => x.clientId === c.id && !x.done);
    const ref = c.referralId && S().referrals.find(r => r.id === c.referralId);
    return scoreCards(c) + `<div class="grid g-main" style="margin-top:16px"><div class="stack">
      ${card('Onboarding (CROA)', `<ul class="steps">${cs.steps.map(s => `<li><span class="tick ${s.done ? 'on' : ''}">${s.done ? '✓' : ''}</span><div class="grow">${esc(s.label)}<div class="small muted">${s.date ? date(s.date) : 'Not recorded'}</div></div></li>`).join('')}</ul>`, { actions: `<a class="btn sm" href="#/clients/${c.id}/compliance">Manage</a>` })}
      ${card('Dispute summary', `<div class="grid g3"><div><div class="muted small">Disputes</div><div class="score">${ds.length}</div></div><div><div class="muted small">Items disputed</div><div class="score">${items}</div></div><div><div class="muted small">Corrected / deleted</div><div class="score" style="color:var(--ok)">${wins}</div></div></div>`, { actions: `<a class="btn sm" href="#/clients/${c.id}/audit">Run audit</a>` })}
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
    if (!reps.length) return card('', empty('No reports yet', 'Add a report manually, paste CSV tradelines, or import from a monitoring-service export.', `<button class="btn primary" data-act="add-report" data-id="${c.id}" style="margin-top:8px">${icon('plus')} Add report</button>`));
    return `<div class="stack">${reps.map(r => card(`${esc(r.bureau)} · ${date(r.date)}`, r.accounts.length ? `<div class="table-wrap"><table><thead><tr><th>Creditor</th><th>Type</th><th>Status</th><th class="num">Balance</th><th class="num">Past due</th><th class="num">Limit / high</th><th>Opened</th><th>DOFD</th><th>24-mo history</th><th></th></tr></thead><tbody>
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
    return card('Disputes', disputeTable(Store.get.disputesFor(c.id), false), { flush: true, actions: `<button class="btn sm" data-act="new-dispute" data-client="${c.id}">${icon('plus')} Blank dispute</button><a class="btn sm primary" href="#/clients/${c.id}/audit">From audit</a>` });
  }

  function invoiceTable(list, showClient) {
    if (!list.length) return empty('No invoices', 'Invoices can only be issued for services already performed.');
    return `<div class="table-wrap"><table><thead><tr>${showClient ? '<th>Client</th>' : ''}<th>Description</th><th>Service completed</th><th>Issued</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${list.sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''))).map(i => `<tr>${showClient ? `<td>${clientName(i.clientId)}</td>` : ''}<td>${esc(i.description)}</td><td class="small nowrap">${date(i.serviceCompletedAt)}</td><td class="small nowrap">${date(i.issuedAt)}</td>
        <td><span class="badge ${i.status === 'paid' ? 'b-ok' : i.status === 'issued' ? 'b-info' : i.status === 'void' ? 'b-high' : 'b-low'}">${esc(i.status)}</span></td><td class="num">${money(i.amount)}</td>
        <td class="nowrap right">${i.status === 'issued' ? `<button class="btn sm" data-act="invoice-paid" data-id="${i.id}">Mark paid</button>` : ''}${i.status !== 'void' && i.status !== 'paid' ? `<button class="btn sm ghost danger" data-act="invoice-void" data-id="${i.id}">Void</button>` : ''}<button class="btn sm ghost" data-act="invoice-print" data-id="${i.id}">${icon('print')}</button></td></tr>`).join('')}</tbody></table></div>`;
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
    return head('Disputes', 'Every dispute, round and statutory deadline in one pipeline', `<select data-act="filter-client" style="width:auto"><option value="">All clients</option>${S().clients.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><button class="btn primary" data-act="new-dispute">${icon('plus')} New dispute</button>`) +
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
        ${card('Disputed items', `<div>${d.items.map((it, i) => `<div class="finding medium"><div class="row between"><span class="t">${esc(it.creditor)}${it.accountNumber ? ' <span class="mono small muted">' + esc(it.accountNumber) + '</span>' : ''}</span>${editable ? `<button class="btn sm ghost" data-act="edit-item" data-id="${d.id}" data-i="${i}">Edit</button>` : ''}</div><div class="d">${esc(it.discrepancy)}</div><div class="f">${it.fields && it.fields.length ? 'Fields: ' + esc(it.fields.join(', ')) + ' · ' : ''}${it.evidence ? 'Evidence: ' + esc(it.evidence) : '<span style="color:var(--med)">No evidence listed</span>'}</div></div>`).join('') || '<p class="muted">No items.</p>'}</div>`,
          { actions: editable && d.type !== 'disclosure_609' ? `<button class="btn sm" data-act="edit-item" data-id="${d.id}">${icon('plus')} Item</button>` : '' })}
        ${card('Letter', letter ? `${lint.length ? `<div class="callout warn" style="margin-bottom:12px"><b>Review these phrases</b>${lint.map(l => `“${esc(l.phrase)}” — ${esc(l.why)}`).join('<br>')}</div>` : ''}
          <textarea class="letter" data-act="letter-edit" data-id="${letter.id}" ${editable ? '' : 'readonly'}>${esc(letter.text)}</textarea>`
          : empty('No letter yet', 'Generate a letter from the items above.'),
          { sub: letter ? `Status: ${esc(letter.status)}${letter.approvedAt ? ' · approved ' + date(letter.approvedAt) : ''}` : '', actions:
            `${editable ? `<button class="btn sm" data-act="gen-letter" data-id="${d.id}">${letter ? 'Regenerate' : 'Generate letter'}</button>` : ''}${letter ? `<button class="btn sm" data-act="print-letter" data-id="${letter.id}">${icon('print')} Print</button>` : ''}` })}
      </div><div class="stack">
        ${card('Next step', nextStep(d, letter, cs, st))}
        ${card('Timeline', `<ul class="steps">${timeline.map(([l, v]) => { const on = v && String(v).slice(0, 10) <= t; return `<li><span class="tick ${on ? 'on' : ''}">${on ? '✓' : ''}</span><div class="grow">${l}<div class="small muted">${v ? date(v) : '—'}${l === 'Response due' && v && !d.outcome ? ` · ${Law.daysBetween(t, v) < 0 ? Math.abs(Law.daysBetween(t, v)) + ' days overdue' : Law.daysBetween(t, v) + ' days left'}` : ''}</div></div></li>`; }).join('')}</ul>${d.tracking ? `<p class="small">Tracking <span class="mono">${esc(d.tracking)}</span></p>` : ''}<p class="small muted">${esc(type.note)}</p>`)}
        ${card('Recipient', `<div class="small"><b>${esc((Law.BUREAUS[d.recipient] || {}).name || d.recipient)}</b><br>${esc((Law.BUREAUS[d.recipient] || {}).address || d.recipientAddress || 'Address not set').replace(/\n/g, '<br>')}</div>`, { actions: `<button class="btn sm ghost" data-act="edit-recipient" data-id="${d.id}">Edit</button>` })}
        ${d.notes ? card('Notes', `<p class="small">${esc(d.notes)}</p>`) : ''}
      </div></div>`;
  }

  function nextStep(d, letter, cs, st) {
    if (!letter) return `<p class="small">Generate the letter, review every statement with the client, then approve it.</p><button class="btn primary" data-act="gen-letter" data-id="${d.id}">Generate letter</button>`;
    if (letter.status === 'draft') return `<p class="small">The client must confirm every statement is true before approval.</p><label class="check small" style="margin-bottom:10px"><input type="checkbox" id="confirm-true"> Client reviewed and confirmed this letter</label><button class="btn primary" data-act="approve-letter" data-id="${d.id}" ${cs.cleared ? '' : 'disabled'}>${icon('check')} Approve letter</button>`;
    if (d.status === 'ready') return `<p class="small">Mail by certified mail with return receipt and record the tracking number.</p><button class="btn primary" data-act="mark-sent" data-id="${d.id}" ${cs.cleared ? '' : 'disabled'}>${icon('mail')} Record mailing</button><button class="btn" data-act="unapprove" data-id="${d.id}" style="margin-left:6px">Back to draft</button>`;
    if (!d.outcome) return `<p class="small">${st === 'overdue' ? '<b style="color:var(--high)">The response period has passed.</b> Record “no response” and follow up.' : 'Waiting for the response. Record it when the results arrive.'}</p><button class="btn primary" data-act="record-response" data-id="${d.id}">Record response</button>${['cra_611', 'furnisher_623', 'obsolete_605', 'reinsertion_611'].includes(d.type) ? `<button class="btn" data-act="mark-received" data-id="${d.id}" style="margin-left:6px">Set received date</button>` : ''}`;
    const follow = { verified: 'Request the method of verification, dispute directly with the furnisher with new evidence, or add a consumer statement (§ 611(b)).', frivolous: 'The bureau must say what information it needs. Provide it and re-submit.', no_response: 'Information that cannot be verified within the period must be deleted (§ 611(a)(5)(A)). Send a follow-up and consider a CFPB complaint.', deleted: 'Watch for reinsertion — the bureau must notify the consumer within 5 business days if it is reinserted.', corrected: 'Pull updated reports to confirm the correction at every bureau.' }[d.outcome] || '';
    return `<p class="small">${dBadge(d.outcome)} ${date(d.respondedAt)}</p><p class="small">${esc(follow)}</p>${['verified', 'frivolous', 'no_response'].includes(d.outcome) ? `<button class="btn primary" data-act="next-round" data-id="${d.id}">Start round ${d.round + 1}</button>` : ''}`;
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
      card('All invoices', invoiceTable(inv.slice(), true), { flush: true });
  }

  // ---------- Compliance ----------
  function compliance() {
    const s = S();
    const co = s.settings.company;
    const al = alerts();
    const program = [
      ['Separate rights disclosure before contract (§ 1679c)', s.clients.filter(c => c.status !== 'lead').every(c => c.onboarding && c.onboarding.disclosureSignedAt)],
      ['Written contract with terms, total cost, timing and cancellation form (§ 1679d, § 1679e)', s.clients.filter(c => c.status !== 'lead').every(c => c.onboarding && c.onboarding.contractSignedAt)],
      ['No fees before services are fully performed (§ 1679b(b))', !al.some(a => a.text.includes('1679b'))],
      ['No services during the 3-business-day cancellation period (§ 1679d(a)(2))', !al.some(a => a.text.includes('before onboarding'))],
      ['Company details on file for documents', !!(co.name && co.address)],
      ['State registration / surety bond recorded (where required)', !!(co.registration || co.bondNumber)]
    ];
    return head('Compliance center', 'CROA, FCRA and state-law safeguards for the whole program') +
      `<div class="grid g-main"><div class="stack">
        ${card('Open alerts', al.length ? `<ul class="list">${al.map(a => `<li><span class="dot" style="background:var(--${a.sev === 'high' ? 'high' : a.sev === 'medium' ? 'med' : 'low'})"></span><div class="grow"><a href="${a.link}">${esc(a.text)}</a></div>${sevBadge(a.sev)}</li>`).join('')}</ul>` : `<div class="callout good" style="margin:16px"><b>No open alerts</b></div>`, { flush: true })}
        ${card('Letter & marketing checker', `<p class="small muted">Paste any letter, ad, script or web copy. Ledger flags claims that are deceptive under CROA § 1679b(a) or the FTC Act.</p><textarea id="lint-in" rows="6" placeholder="e.g. We guarantee to remove all negative items in 30 days…"></textarea><div class="row" style="margin-top:10px"><button class="btn primary" data-act="lint">Check text</button></div><div id="lint-out" style="margin-top:12px"></div>`)}
        ${card('Client agreement status', `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Disclosure</th><th>Contract</th><th>Cancel deadline</th><th>Retain records until</th></tr></thead><tbody>${s.clients.filter(c => c.status !== 'lead').map(c => { const cs = Store.croaStatus(c); const o = c.onboarding || {}; return `<tr class="click" data-href="#/clients/${c.id}/compliance"><td>${esc(c.name)}</td><td>${o.disclosureSignedAt ? date(o.disclosureSignedAt) : '<span class="badge b-high">Missing</span>'}</td><td>${o.contractSignedAt ? date(o.contractSignedAt) : '<span class="badge b-high">Missing</span>'}</td><td>${cs.deadline ? date(cs.deadline) : '—'}</td><td>${cs.retainUntil ? date(cs.retainUntil) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No enrolled clients</td></tr>'}</tbody></table></div>`, { flush: true })}
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
  function library(params) {
    const tab = params.tab || 'metro2';
    const tabs = [['metro2', 'Metro 2 codes'], ['timelines', 'Dispute types & deadlines'], ['bureaus', 'Bureau addresses'], ['how', 'How it works'], ['sources', 'Sources']];
    const table = (obj, h1, h2) => `<div class="table-wrap"><table><thead><tr><th style="width:90px">${h1}</th><th>${h2}</th></tr></thead><tbody>${Object.entries(obj).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
    const body = {
      metro2: `<div class="grid g2">${card('Account Status (Base 17A)', table(Metro2.ACCOUNT_STATUS, 'Code', 'Meaning'), { flush: true })}<div class="stack">${card('Payment History Profile (Base 18)', table(Metro2.PAYMENT_HISTORY, 'Char', 'Meaning'), { flush: true, sub: '24 months, most recent month first' })}${card('Compliance Condition Codes (Base 20)', table(Metro2.COMPLIANCE_CONDITION, 'Code', 'Meaning'), { flush: true })}</div>
        ${card('ECOA (Base 37)', table(Metro2.ECOA, 'Code', 'Meaning'), { flush: true })}${card('Consumer Information Indicator (Base 38)', table(Metro2.CONSUMER_INFO_INDICATOR, 'Code', 'Meaning'), { flush: true })}
        ${card('Portfolio type', table(Metro2.PORTFOLIO_TYPE, 'Code', 'Meaning'), { flush: true })}${card('Special comments (selected)', table(Metro2.SPECIAL_COMMENT, 'Code', 'Meaning'), { flush: true })}</div>`,
      timelines: card('', `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Law</th><th>Recipient</th><th>Window</th><th>Notes</th></tr></thead><tbody>${Object.values(Law.DISPUTE_TYPES).map(t => `<tr><td><b>${esc(t.label)}</b></td><td class="small">${esc(t.cite)}</td><td class="small">${esc(t.recipient)}</td><td class="small nowrap">${t.days ? t.days + (t.businessDays ? ' business days' : ' days') : '—'}</td><td class="small">${esc(t.note)}</td></tr>`).join('')}</tbody></table></div>`, { flush: true }) +
        `<div class="grid g3" style="margin-top:16px">${card('Reporting periods', '<ul class="small" style="padding-left:18px;margin:0"><li>Most negative items: 7 years from 180 days after the DOFD (§ 605(a), (c))</li><li>Bankruptcies: 10 years from the order for relief</li><li>Hard inquiries: generally 2 years (bureau policy)</li></ul>')}${card('Bureau duties', '<ul class="small" style="padding-left:18px;margin:0"><li>Notify the furnisher within 5 business days of a dispute</li><li>Delete information that cannot be verified</li><li>Send results within 5 business days of completion</li><li>Notice of a frivolous determination within 5 business days</li></ul>')}${card('Furnisher duties', '<ul class="small" style="padding-left:18px;margin:0"><li>Investigate disputes forwarded by a bureau (§ 623(b))</li><li>Report the account as disputed (§ 623(a)(3))</li><li>Report the DOFD within 90 days (§ 623(a)(5))</li><li>Correct and update inaccurate data (§ 623(a)(2))</li></ul>')}</div>`,
      bureaus: `<div class="grid g3">${Object.entries(Law.BUREAUS).map(([k, b]) => card(k, `<p><b>${esc(b.name)}</b><br>${esc(b.address).replace(/\n/g, '<br>')}</p><p class="small muted">Dispute mailing address. Confirm on the bureau’s current dispute page before mailing.</p>`)).join('')}</div>`,
      how: card('How Metro 2 dispute software works', `<div class="prose">
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
      sources: card('Research sources', `<ul class="small" style="padding-left:18px;margin:0;line-height:1.9">
        <li><a href="https://www.law.cornell.edu/uscode/text/15/1679c" target="_blank" rel="noopener">15 U.S.C. § 1679c — CROA disclosures (Cornell LII)</a></li>
        <li><a href="https://www.law.cornell.edu/uscode/text/15/1679e" target="_blank" rel="noopener">15 U.S.C. § 1679e — Right to cancel (Cornell LII)</a></li>
        <li><a href="https://law.justia.com/codes/us/title-15/chapter-41/subchapter-ii-a" target="_blank" rel="noopener">15 U.S.C. ch. 41 subch. II-A — Credit Repair Organizations (Justia)</a></li>
        <li><a href="https://www.govinfo.gov/link/uscode/15/1679b" target="_blank" rel="noopener">15 U.S.C. § 1679b — Prohibited practices (GovInfo)</a></li>
        <li><a href="https://www.law.cornell.edu/uscode/text/15/1681i" target="_blank" rel="noopener">15 U.S.C. § 1681i — FCRA reinvestigations</a> · <a href="https://www.law.cornell.edu/uscode/text/15/1681s-2" target="_blank" rel="noopener">§ 1681s-2 — furnisher duties</a> · <a href="https://www.law.cornell.edu/uscode/text/15/1681c" target="_blank" rel="noopener">§ 1681c — obsolete information</a> · <a href="https://www.law.cornell.edu/uscode/text/15/1681c-2" target="_blank" rel="noopener">§ 1681c-2 — identity theft block</a></li>
        <li><a href="https://www.law.cornell.edu/cfr/text/12/1022.43" target="_blank" rel="noopener">12 C.F.R. § 1022.43 — direct disputes (Regulation V)</a></li>
        <li><a href="https://docs.tech.sofi.com/pro/page/metro-2-base-segment" target="_blank" rel="noopener">Metro 2 Base Segment field layout & compliance condition codes (Galileo/SoFi furnisher docs)</a></li>
        <li><a href="https://metro2.switchlabs.dev/metro2/glossary" target="_blank" rel="noopener">Metro 2 glossary — DOFD, account status, CRRG (Switch Labs)</a></li>
        <li><a href="https://www.consumerfinancemonitor.com/2017/09/06/the-cfpb-shuts-down-another-credit-repair-service/" target="_blank" rel="noopener">CFPB enforcement against mass-dispute credit repair (Ballard Spahr)</a></li>
        <li><a href="https://intercom.help/crc-support/en/articles/9190950" target="_blank" rel="noopener">Credit Repair Cloud help — client-selected disputes</a> · <a href="https://dupple.com/reviews/credit" target="_blank" rel="noopener">Credit repair software feature review</a></li></ul>
        <p class="small muted" style="margin-top:12px">The CDIA Credit Reporting Resource Guide is the authoritative Metro 2 specification and is licensed by CDIA. Ledger is workflow software, not legal advice.</p>`)
    }[tab];
    return head('Library', 'Reference material used by the audit engine and letter builder') + `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/library?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</div>` + body;
  }

  // ---------- Referrals ----------
  function referrals() {
    const list = S().referrals;
    return head('Referral partners', 'Mortgage brokers, realtors and auto dealers who send clients', `<button class="btn primary" data-act="new-referral">${icon('plus')} Partner</button>`) +
      card('', list.length ? `<div class="table-wrap"><table><thead><tr><th>Partner</th><th>Company</th><th>Commission</th><th class="num">Clients referred</th><th class="num">Active</th><th></th></tr></thead><tbody>${list.map(r => { const cl = S().clients.filter(c => c.referralId === r.id); return `<tr><td><b>${esc(r.name)}</b><div class="small muted">${esc(r.email || '')}</div></td><td>${esc(r.company || '')}</td><td class="small">${esc(r.commission || '—')}</td><td class="num">${cl.length}</td><td class="num">${cl.filter(c => c.status === 'active').length}</td><td class="right"><button class="btn sm ghost" data-act="edit-referral" data-id="${r.id}">Edit</button></td></tr>`; }).join('')}</tbody></table></div>` : empty('No partners yet', 'Track who refers clients and what you owe them.'), { flush: true });
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
        ${UI.field('State registration #', 'registration', co.registration)}${UI.field('Surety bond #', 'bondNumber', co.bondNumber)}
        ${UI.field('Default fee terms', 'defaultFee', s.defaultFee, { type: 'textarea', rows: 2, cls: 'span2', help: 'Used in the agreement template' })}
        ${UI.field('Mail transit days', 'mailTransitDays', s.mailTransitDays, { type: 'number', help: 'Estimated delivery used to compute deadlines until the received date is known' })}
      </div><div class="row" style="margin-top:14px"><button class="btn primary">Save</button></div></form>`)}
    </div><div class="stack">
      ${card('Your data', `<p class="small muted">Everything is stored in this browser only. Export regular backups — the file contains client personal information, so keep it encrypted and private.</p>
        <div class="row" style="margin-top:10px"><button class="btn" data-act="export">${icon('download')} Export backup</button><button class="btn" data-act="import">${icon('upload')} Import backup</button><button class="btn" data-act="csv-template">${icon('download')} Tradeline CSV template</button></div>
        <p class="small muted" style="margin-top:10px">Imports accept Ledger v1 backups (<span class="mono">ledger-workspace-backup.json</span>) and v2 workspaces. v1 letters become round-1 disputes so their deadlines can be tracked.</p>`)}
      ${card('Demo & reset', `<div class="row"><button class="btn" data-act="load-demo">Load demo data</button><button class="btn danger" data-act="reset">Erase workspace</button></div>`)}
    </div></div>`;
  }

  root.Views = { dashboard, clients, client, disputes, dispute, audit, billing, compliance, library, referrals, settings, clientFindings, alerts, openDisputes, repeatRisk };
})(typeof window !== 'undefined' ? window : globalThis);
