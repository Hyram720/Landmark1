// Read-only web dashboard: the shared board (goal, tasks, live feed) plus session history.
// Served locally by `recall web` and by the shared server behind its token.
import http from 'node:http';
import { Store } from './db.js';

export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recall Board</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c;--accent:#f59e0b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}h1{margin:0 0 4px;font-size:22px}h2{font-size:16px;margin:20px 0 8px}
.muted{color:var(--muted);font-size:13px}form,.bar{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap}
input,select,button{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
input{flex:1;min-width:180px}button{cursor:pointer;border-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:8px 0}
.tag{display:inline-block;font-size:12px;padding:0 6px;border:1px solid var(--line);border-radius:4px;margin-right:6px;color:var(--muted)}
.agent{font-weight:600;color:var(--accent)}.goal{border-left:3px solid var(--accent)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media (max-width:760px){.grid{grid-template-columns:1fr}}
pre{white-space:pre-wrap;word-break:break-word;font-size:13px;margin:6px 0 0;color:var(--muted)}
details summary{cursor:pointer}
</style></head><body><main>
<h1>Recall Board</h1><div class="muted" id="stats"></div>
<div class="bar"><select id="p"></select><button id="refresh">Refresh</button></div>
<div id="board"></div>
<h2>Search</h2>
<form id="f"><input id="q" placeholder="Search everything…"><button>Search</button></form>
<div id="out"></div>
<h2>Claude Code sessions</h2><div id="sessions"></div>
</main><script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=t=>new Date(t).toLocaleString();
const api=async u=>(await fetch(u)).json();
const proj=()=>document.getElementById('p').value;
const row=o=>'<div class="card"><span class="tag">'+esc(o.kind||o.type)+'</span>'+(o.agent?'<span class="agent">'+esc(o.agent)+'</span> ':'')+(o.type==='observation'||!o.type?'#'+o.id+' ':'')+esc(o.title)+' <span class="muted">'+esc(when(o.created_at))+'</span>'+(o.detail&&o.detail!==o.title?'<pre>'+esc(o.detail)+'</pre>':'')+'</div>';
async function init(){
  const s=await api('api/stats');document.getElementById('stats').textContent=s.sessions+' sessions · '+s.observations+' observations · '+s.tasks+' tasks';
  const ps=await api('api/projects');const sel=document.getElementById('p');
  sel.innerHTML='<option value="">All projects</option>'+ps.map(p=>'<option>'+esc(p.project)+'</option>').join('');
  if(ps[0])sel.value=ps[0].project;
  load();
}
async function load(){
  const b=await api('api/board?project='+encodeURIComponent(proj()));
  document.getElementById('board').innerHTML=
    (b.goal?'<div class="card goal"><b>Goal</b> <span class="muted">set by '+esc(b.goal.updated_by)+'</span><div>'+esc(b.goal.goal)+'</div></div>':'')
    +'<div class="grid"><div><h2>Tasks</h2>'+(b.tasks.map(t=>'<div class="card"><span class="tag">'+esc(t.status)+'</span>task #'+t.id+' '+esc(t.title)+'<div class="muted">lead: <span class="agent">'+esc(t.lead||'nobody yet')+'</span> · '+esc(t.project)+'</div></div>').join('')||'<p class="muted">No open tasks.</p>')
    +'</div><div><h2>Latest activity</h2>'+(b.feed.map(row).join('')||'<p class="muted">Nothing yet.</p>')+'</div></div>';
  const rows=await api('api/sessions?project='+encodeURIComponent(proj()));
  document.getElementById('sessions').innerHTML=rows.map(s=>'<div class="card"><div><b>'+esc(s.project)+'</b> <span class="muted">'+esc(when(s.updated_at))+' · '+s.prompt_count+' prompts · '+s.observation_count+' observations</span></div>'
   +(s.request?'<div>'+esc(s.request)+'</div>':'')+(s.completed?'<pre>'+esc(s.completed)+'</pre>':'')
   +'<details data-id="'+esc(s.id)+'"><summary class="muted">Activity</summary><div></div></details></div>').join('')||'<p class="muted">None yet.</p>';
  for(const d of document.querySelectorAll('details[data-id]'))d.addEventListener('toggle',async()=>{
    if(!d.open||d.dataset.loaded)return;d.dataset.loaded=1;
    d.querySelector('div').innerHTML=(await api('api/session?id='+encodeURIComponent(d.dataset.id))).map(row).join('');
  });
}
document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();
  const q=document.getElementById('q').value.trim();if(!q){document.getElementById('out').innerHTML='';return}
  const rows=await api('api/search?q='+encodeURIComponent(q)+'&project='+encodeURIComponent(proj()));
  document.getElementById('out').innerHTML=rows.map(row).join('')||'<p class="muted">No matches.</p>';
});
document.getElementById('p').addEventListener('change',load);
document.getElementById('refresh').addEventListener('click',load);
setInterval(load,30000);
init();
</script></body></html>`;

// Answers dashboard requests under `route` ("/" or "/api/..."). Returns false when the route isn't ours.
export function viewerRoute(store, route, url, res) {
  const project = url.searchParams.get('project') || null;
  const json = data => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  switch (route) {
    case '/':
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return true;
    case '/api/stats': json(store.stats()); return true;
    case '/api/projects': json(store.projects()); return true;
    case '/api/sessions': json(store.sessions(project, 30)); return true;
    case '/api/session': json(store.observationsFor(url.searchParams.get('id') ?? '')); return true;
    case '/api/search': json(store.search(url.searchParams.get('q') ?? '', { project, limit: 50 })); return true;
    case '/api/board':
      json({ goal: project ? store.goal(project) : null, tasks: store.tasks(project), feed: store.feed({ project, limit: 40 }).reverse() });
      return true;
    default:
      return false;
  }
}

export function serve(port = 37778) {
  const store = new Store();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!viewerRoute(store, url.pathname, url, res)) {
        res.writeHead(404);
        res.end('Not found');
      }
    } catch (err) {
      res.writeHead(500);
      res.end(String(err.message));
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Recall board: http://127.0.0.1:${port}`));
  return server;
}
