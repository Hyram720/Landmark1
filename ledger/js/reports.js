/*
 * Printable client documents: the monthly progress report, the free credit analysis for
 * prospects, and the side-by-side report comparison data. Returns HTML strings.
 */
(function (root) {
  'use strict';
  const Law = root.Law, Metro2 = root.Metro2, Results = root.Results;
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (n === '' || n === null || n === undefined || isNaN(Number(n))) ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const BUREAUS = ['Equifax', 'Experian', 'TransUnion'];
  const COLORS = { Equifax: '#b42318', Experian: '#1d4ed8', TransUnion: '#0f766e' };
  const NEG = ['61', '62', '63', '64', '65', '71', '78', '80', '82', '83', '84', '93', '94', '95', '96', '97', 'DA', 'DF'];
  const isNeg = a => NEG.includes(String(a.status || '').toUpperCase()) || Number(a.pastDue) > 0;

  const STYLE = `<style>body{font:11pt/1.5 -apple-system,'Segoe UI',Inter,Arial,sans-serif;color:#0b1220;margin:0;background:#fff}
    .doc{max-width:7.2in;margin:0.5in auto;padding:0 0.2in}h1{font-size:20pt;margin:0 0 4px}h2{font-size:13pt;margin:22px 0 8px;border-bottom:2px solid #0f766e;padding-bottom:4px}
    .muted{color:#64748b}.small{font-size:9pt}table{width:100%;border-collapse:collapse;font-size:9.5pt}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e4e7ec;vertical-align:top}th{background:#f5f6f8;font-weight:600}
    .kpis{display:flex;gap:10px;margin:14px 0}.kpi{flex:1;border:1px solid #e4e7ec;border-radius:8px;padding:10px 12px}.kpi b{display:block;font-size:18pt}.ok{color:#067647}.bad{color:#b42318}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e4e7ec;padding-bottom:12px}.tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:8.5pt;background:#eef1f5}
    .tag.del{background:#e7f6ee;color:#067647}.tag.cor{background:#e8f0fe;color:#1d4ed8}.tag.new{background:#fdecea;color:#b42318}.tag.chg{background:#fef3e2;color:#b54708}
    .note{background:#f5f6f8;border-radius:8px;padding:10px 12px;font-size:9pt;margin-top:18px}@page{margin:0.5in}@media print{.doc{margin:0 auto}}</style>`;

  function wrap(title, body) { return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${STYLE}</head><body><div class="doc">${body}</div></body></html>`; }
  function header(co, title, sub) {
    return `<div class="head"><div><h1>${esc(title)}</h1><div class="muted">${esc(sub)}</div></div><div class="small" style="text-align:right"><b>${esc(co.name || '')}</b><br>${esc(co.phone || '')}<br>${esc(co.email || '')}</div></div>`;
  }

  /** Score history per bureau: { Equifax: [{date, score}], ... } */
  function scoreHistory(ws, cid) {
    const h = {};
    ws.reports.filter(r => r.clientId === cid).forEach(r => Object.entries(r.scores || {}).forEach(([b, v]) => { if (Number(v)) (h[b] = h[b] || []).push({ date: String(r.date), score: Number(v) }); }));
    Object.values(h).forEach(a => a.sort((x, y) => x.date.localeCompare(y.date)));
    return h;
  }

  function chart(hist) {
    const pts = Object.values(hist).flat();
    if (pts.length < 2) return '';
    const W = 640, H = 180, P = 32;
    const dates = [...new Set(pts.map(p => p.date))].sort();
    const min = Math.min(...pts.map(p => p.score)) - 15, max = Math.max(...pts.map(p => p.score)) + 15;
    const x = d => dates.length === 1 ? W / 2 : P + (dates.indexOf(d) / (dates.length - 1)) * (W - 2 * P);
    const y = s => H - P + 8 - ((s - min) / (max - min)) * (H - 2 * P);
    const lines = Object.entries(hist).map(([b, a]) => `<polyline fill="none" stroke="${COLORS[b] || '#334155'}" stroke-width="2.5" points="${a.map(p => x(p.date) + ',' + y(p.score)).join(' ')}"/>${a.map(p => `<circle cx="${x(p.date)}" cy="${y(p.score)}" r="3.5" fill="${COLORS[b] || '#334155'}"/><text x="${x(p.date)}" y="${y(p.score) - 8}" font-size="10" text-anchor="middle" fill="#334155">${p.score}</text>`).join('')}`).join('');
    const axis = dates.map(d => `<text x="${x(d)}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#64748b">${esc(d)}</text>`).join('');
    const legend = Object.keys(hist).map((b, i) => `<rect x="${P + i * 110}" y="2" width="10" height="10" fill="${COLORS[b] || '#334155'}"/><text x="${P + i * 110 + 14}" y="11" font-size="10" fill="#334155">${esc(b)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Credit score history">${legend}${lines}${axis}</svg>`;
  }

  function wins(ws, cid) {
    const out = [];
    ws.disputes.filter(d => d.clientId === cid).forEach(d => d.items.forEach(it => {
      const res = it.result || (['deleted', 'corrected'].includes(d.outcome) ? d.outcome : null);
      if (['deleted', 'corrected'].includes(res)) out.push({ creditor: it.creditor, bureau: it.bureau || d.recipient, result: res, at: it.resultAt || d.respondedAt });
    }));
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  /** Monthly progress report (HTML). */
  function progress(ws, cid, today) {
    const c = ws.clients.find(x => x.id === cid) || {};
    const co = ws.settings.company || {};
    const hist = scoreHistory(ws, cid);
    const w = wins(ws, cid);
    const open = ws.disputes.filter(d => d.clientId === cid && d.sentAt && !d.outcome);
    const change = Object.entries(hist).map(([b, a]) => ({ b, from: a[0].score, to: a[a.length - 1].score }));
    const tasks = ws.tasks.filter(t => t.clientId === cid && !t.done && /upload|send|sign|id|address|report/i.test(t.title));
    return wrap(`Progress report — ${c.name}`, header(co, 'Credit progress report', `${c.name} · ${today}`) +
      `<div class="kpis"><div class="kpi"><span class="muted small">Items removed or corrected</span><b class="ok">${w.length}</b></div><div class="kpi"><span class="muted small">Disputes in progress</span><b>${open.length}</b></div>${change.map(s => `<div class="kpi"><span class="muted small">${esc(s.b)} score</span><b class="${s.to >= s.from ? 'ok' : 'bad'}">${s.to}</b><span class="small muted">${s.to - s.from >= 0 ? '+' : ''}${s.to - s.from} since ${esc(hist[s.b][0].date)}</span></div>`).join('')}</div>` +
      (chart(hist) ? `<h2>Score history</h2>${chart(hist)}` : '') +
      `<h2>Results</h2>${w.length ? `<table><thead><tr><th>Account</th><th>Bureau</th><th>Result</th><th>Date</th></tr></thead><tbody>${w.map(x => `<tr><td>${esc(x.creditor)}</td><td>${esc(x.bureau)}</td><td><span class="tag ${x.result === 'deleted' ? 'del' : 'cor'}">${x.result === 'deleted' ? 'Removed' : 'Corrected'}</span></td><td>${esc(x.at || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No results yet — the first responses usually arrive 30–45 days after letters are mailed.</p>'}` +
      `<h2>In progress</h2>${open.length ? `<table><thead><tr><th>Sent to</th><th>Letter</th><th>Mailed</th><th>Response due</th></tr></thead><tbody>${open.map(d => `<tr><td>${esc(d.recipient)}</td><td>${esc((Law.DISPUTE_TYPES[d.type] || {}).label || d.type)}</td><td>${esc(d.sentAt)}</td><td>${esc(d.dueAt || '—')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing waiting on a response right now.</p>'}` +
      (tasks.length ? `<h2>What we need from you</h2><ul>${tasks.map(t => `<li>${esc(t.title)}</li>`).join('')}</ul>` : '') +
      `<div class="note">Results depend on what the credit bureaus and creditors find. Accurate, timely information can stay on a report for the period the law allows. You can always dispute information with the credit bureaus yourself at no cost.</div>`);
  }

  /** Free credit analysis for a prospect (HTML) — what a review found, with no promises. */
  function analysis(ws, cid, today) {
    const c = ws.clients.find(x => x.id === cid) || {};
    const co = ws.settings.company || {};
    const latest = {};
    ws.reports.filter(r => r.clientId === cid && (r.accounts || []).length).forEach(r => { if (!latest[r.bureau] || String(r.date) > String(latest[r.bureau].date)) latest[r.bureau] = r; });
    const reps = Object.values(latest);
    if (!reps.length) return null;
    const accts = reps.flatMap(r => r.accounts.map(a => Object.assign({ bureau: r.bureau }, a)));
    const neg = accts.filter(isNeg);
    const revolving = accts.filter(a => String(a.type).toUpperCase() === 'R' && Number(a.limit) > 0 && !['13', '97', '64'].includes(String(a.status)));
    const util = revolving.length ? Math.round(100 * revolving.reduce((s, a) => s + Number(a.balance || 0), 0) / revolving.reduce((s, a) => s + Number(a.limit || 0), 0)) : null;
    const findings = reps.flatMap(r => Metro2.auditReport(r, { today }).map(f => Object.assign({ bureau: r.bureau }, f)));
    const high = findings.filter(f => f.severity === 'high'), med = findings.filter(f => f.severity === 'medium');
    const diffs = Metro2.compareBureaus(reps).filter(g => g.differences.length);
    const scores = reps.map(r => [r.bureau, (r.scores || {})[r.bureau]]).filter(x => x[1]);
    return wrap(`Credit analysis — ${c.name}`, header(co, 'Credit report analysis', `Prepared for ${c.name} · ${today}`) +
      `<div class="kpis">${scores.map(([b, s]) => `<div class="kpi"><span class="muted small">${esc(b)}</span><b>${esc(s)}</b></div>`).join('')}<div class="kpi"><span class="muted small">Negative accounts</span><b class="${neg.length ? 'bad' : 'ok'}">${neg.length}</b></div><div class="kpi"><span class="muted small">Card utilization</span><b class="${util !== null && util > 30 ? 'bad' : 'ok'}">${util === null ? '—' : util + '%'}</b></div></div>` +
      `<h2>Possible reporting errors</h2><p class="small muted">Items where the data a creditor reports does not add up under the Metro 2 reporting standard, or differs between bureaus. These are worth checking against your own records — only information that is actually inaccurate, incomplete or unverifiable can be disputed.</p>` +
      (high.length + med.length ? `<table><thead><tr><th>Account</th><th>Bureau</th><th>What we noticed</th></tr></thead><tbody>${high.concat(med).slice(0, 25).map(f => `<tr><td>${esc((f.tradeline && f.tradeline.creditor) || f.creditor || '')}</td><td>${esc(f.bureau)}</td><td><b>${esc(f.title)}</b><div class="small muted">${esc(f.detail)}</div></td></tr>`).join('')}</tbody></table>` : '<p>No obvious data errors were found in the reports reviewed.</p>') +
      (diffs.length ? `<p class="small">${diffs.length} account${diffs.length > 1 ? 's are' : ' is'} reported differently by different bureaus.</p>` : '') +
      `<h2>Negative accounts</h2>${neg.length ? `<table><thead><tr><th>Account</th><th>Bureau</th><th>Status</th><th>Balance</th></tr></thead><tbody>${neg.map(a => `<tr><td>${esc(a.creditor)}</td><td>${esc(a.bureau)}</td><td>${esc((Metro2.ACCOUNT_STATUS || {})[a.status] || a.status)}</td><td>${money(a.balance)}</td></tr>`).join('')}</tbody></table>` : '<p>None found.</p>'}` +
      `<h2>Recommended plan</h2><ol><li>Confirm each possible error with your own statements and records.</li><li>Dispute only items that are inaccurate, incomplete or cannot be verified, with documents.</li><li>${util !== null && util > 30 ? `Bring card balances below 30% of limits (currently ${util}%) — often the fastest score improvement.` : 'Keep card balances low and pay every account on time.'}</li><li>Add positive history (for example a credit-builder account) while disputes are in progress.</li></ol>` +
      `<div class="note"><b>Your rights.</b> You can dispute inaccurate information with the credit bureaus yourself, for free. No one can legally remove accurate, current and verifiable information from your credit report. We do not promise specific results or score increases.</div>`);
  }

  /** Side-by-side comparison rows for two reports from the same bureau. */
  function sideBySide(prev, next) {
    const rows = Results.compareReports(prev, next);
    const order = { deleted: 0, changed: 1, new: 2, unchanged: 3 };
    return rows.sort((a, b) => order[a.kind] - order[b.kind] || String((a.before || a.after).creditor).localeCompare(String((b.before || b.after).creditor)));
  }

  const api = { progress, analysis, sideBySide, scoreHistory, chart, wins, isNeg };
  root.Reports = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
