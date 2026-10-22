// Local, read-only web viewer for the memory database (bound to 127.0.0.1).
import http from 'node:http';
import { Store } from './db.js';

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recall</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c;--accent:#f59e0b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px}h1{margin:0 0 4px;font-size:22px}
.muted{color:var(--muted);font-size:13px}form{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap}
input,select,button{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
input{flex:1;min-width:180px}button{cursor:pointer;border-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0}
.kind{display:inline-block;font-size:12px;padding:0 6px;border:1px solid var(--line);border-radius:4px;margin-right:6px;color:var(--muted)}
pre{white-space:pre-wrap;word-break:break-word;font-size:13px;margin:6px 0 0;color:var(--muted)}
details summary{cursor:pointer}
</style></head><body><main>
<h1>Recall</h1><div class="muted" id="stats"></div>
<form id="f"><input id="q" placeholder="Search memory…"><select id="p"><option value="">All projects</option></select><button>Search</button></form>
<div id="out"></div>
</main><script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=t=>new Date(t).toLocaleString();
const api=async(u)=>(await fetch(u)).json();
async function init(){
  const s=await api('/api/stats');document.getElementById('stats').textContent=s.sessions+' sessions · '+s.observations+' observations · '+s.prompts+' prompts';
  const ps=await api('/api/projects');const sel=document.getElementById('p');
  for(const p of ps){const o=document.createElement('option');o.value=p.project;o.textContent=p.project;sel.append(o)}
  showSessions();
}
async function showSessions(){
  const p=document.getElementById('p').value;
  const rows=await api('/api/sessions?project='+encodeURIComponent(p));
  document.getElementById('out').innerHTML=rows.map(s=>'<div class="card"><div><b>'+esc(s.project)+'</b> <span class="muted">'+esc(when(s.updated_at))+' · '+s.prompt_count+' prompts · '+s.observation_count+' observations</span></div>'
   +(s.request?'<div>'+esc(s.request)+'</div>':'')+(s.completed?'<pre>'+esc(s.completed)+'</pre>':'')
   +'<details data-id="'+esc(s.id)+'"><summary class="muted">Activity</summary><div></div></details></div>').join('')||'<p class="muted">Nothing remembered yet.</p>';
  for(const d of document.querySelectorAll('details[data-id]'))d.addEventListener('toggle',async()=>{
    if(!d.open||d.dataset.loaded)return;d.dataset.loaded=1;
    const obs=await api('/api/session?id='+encodeURIComponent(d.dataset.id));
    d.querySelector('div').innerHTML=obs.map(row).join('');
  });
}
const row=o=>'<div class="card"><span class="kind">'+esc(o.kind||o.type)+'</span>'+(o.id&&o.type!=='session'&&o.type!=='prompt'?'#'+o.id+' ':'')+esc(o.title)+' <span class="muted">'+esc(when(o.created_at))+(o.project?' · '+esc(o.project):'')+'</span>'+(o.detail?'<pre>'+esc(o.detail)+'</pre>':'')+'</div>';
document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();
  const q=document.getElementById('q').value.trim();if(!q)return showSessions();
  const rows=await api('/api/search?q='+encodeURIComponent(q)+'&project='+encodeURIComponent(document.getElementById('p').value));
  document.getElementById('out').innerHTML=rows.map(row).join('')||'<p class="muted">No matches.</p>';
});
document.getElementById('p').addEventListener('change',()=>document.getElementById('f').requestSubmit());
init();
</script></body></html>`;

export function serve(port = 37778) {
  const store = new Store();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const project = url.searchParams.get('project') || null;
    const json = data => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      switch (url.pathname) {
        case '/':
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(PAGE);
        case '/api/stats': return json(store.stats());
        case '/api/projects': return json(store.projects());
        case '/api/sessions': return json(store.sessions(project, 50));
        case '/api/session': return json(store.observationsFor(url.searchParams.get('id') ?? ''));
        case '/api/search': return json(store.search(url.searchParams.get('q') ?? '', { project, limit: 50 }));
        default:
          res.writeHead(404);
          return res.end('Not found');
      }
    } catch (err) {
      res.writeHead(500);
      res.end(String(err.message));
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Recall viewer: http://127.0.0.1:${port}`));
  return server;
}
