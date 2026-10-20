// Owner dashboard: the same data as the JSON admin endpoint, rendered as a readable page.
// Browsers get HTML; add ?format=json (or ask for JSON) to get the raw data.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const label = (k) => esc(String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()));

function value(v) {
  if (v === true) return '✅';
  if (v === false) return '—';
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${label(k)}: ${value(x)}`).join(' · ');
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return esc(new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC');
  return esc(v);
}

function section(key, v) {
  if (Array.isArray(v)) {
    if (!v.length) return `<h2>${label(key)}</h2><p class="muted">Nothing yet.</p>`;
    const cols = [...new Set(v.flatMap((row) => Object.keys(row)))];
    return `<h2>${label(key)}</h2><div class="scroll"><table><tr>${cols.map((c) => `<th>${label(c)}</th>`).join('')}</tr>${v
      .map((row) => `<tr>${cols.map((c) => `<td>${value(row[c])}</td>`).join('')}</tr>`)
      .join('')}</table></div>`;
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v);
    return `<h2>${label(key)}</h2>${entries.length ? `<div class="cards">${entries.map(([k, x]) => `<div class="card"><div class="num">${value(x)}</div><div class="muted">${label(k)}</div></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}`;
  }
  return null;
}

// setup: [{ name, ok, hint }] - what's configured and what's still missing.
// actions: [{ label, path }] - POST buttons (authorized by the admin session cookie).
export function sendAdmin(req, res, { title, data, setup = [], actions = [] }) {
  if (req.query.format === 'json' || !req.accepts('html')) return res.json(data);
  const top = Object.entries(data).filter(([, v]) => v === null || typeof v !== 'object');
  const rest = Object.entries(data).filter(([, v]) => v !== null && typeof v === 'object').map(([k, v]) => section(k, v));
  const missing = setup.filter((s) => !s.ok).length;
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} admin</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --fg: #111; --muted: #6b7280; --card: #fff; --line: #e5e7eb; --ok: #16a34a; --warn: #d97706; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1115; --fg: #e8ebf0; --muted: #8b93a1; --card: #171a21; --line: #262b35; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 24px; margin: 8px 0 4px; } h2 { font-size: 17px; margin: 28px 0 10px; }
  .muted { color: var(--muted); font-size: 13px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
  .num { font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
  .scroll { overflow-x: auto; } table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 10px; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; } th { color: var(--muted); font-weight: 600; }
  .setup li { margin: 6px 0; } .ok { color: var(--ok); } .warn { color: var(--warn); }
  form { display: inline; } button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; margin: 4px 6px 4px 0; }
  .note { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--ok); padding: 10px 12px; border-radius: 8px; }
</style></head><body><div class="wrap">
  <h1>${esc(title)} admin</h1>
  <p class="muted">Live numbers. <a href="?format=json">Raw data</a> <form method="post" action="/admin/logout"><button>Sign out</button></form></p>
  ${req.query.msg ? `<p class="note">${esc(req.query.msg)}</p>` : ''}
  ${setup.length ? `<h2>Setup ${missing ? `<span class="warn">(${missing} to do)</span>` : '<span class="ok">(all set)</span>'}</h2><ul class="setup">${setup.map((s) => `<li>${s.ok ? '<span class="ok">✅</span>' : '<span class="warn">⚠️</span>'} <strong>${esc(s.name)}</strong>${s.ok ? '' : ` <span class="muted">${esc(s.hint || '')}</span>`}</li>`).join('')}</ul>` : ''}
  ${top.length ? `<div class="cards" style="margin-top:16px">${top.map(([k, v]) => `<div class="card"><div class="num">${value(v)}</div><div class="muted">${label(k)}</div></div>`).join('')}</div>` : ''}
  ${rest.join('')}
  ${actions.length ? `<h2>Actions</h2>${actions.map((a) => `<form method="post" action="${esc(a.path)}"><button>${esc(a.label)}</button></form>`).join('')}` : ''}
</div></body></html>`);
}
