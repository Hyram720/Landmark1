import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-team-'));
const TOKEN = 'test-token-0123456789abcdefghij';
const PORT = 48000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

let server;
test.before(async () => {
  server = spawn(process.execPath, ['--no-warnings', path.join(root, 'src/server.js')], {
    env: { ...process.env, RECALL_DATA_DIR: dataDir, RECALL_TOKEN: TOKEN, PORT: String(PORT), HOST: '127.0.0.1', RECALL_AI: 'off' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => String(d).includes('listening') && resolve());
    server.on('exit', code => reject(new Error(`server exited ${code}`)));
  });
});
test.after(() => server.kill());

let nextId = 1;
async function rpc(method, params, { auth = 'path', agentArgs } = {}) {
  const url = auth === 'path' ? `${BASE}/${TOKEN}/mcp` : `${BASE}/mcp`;
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (auth === 'bearer') headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }) });
  return { status: res.status, headers: res.headers, body: res.status === 200 ? await res.json() : await res.text() };
}
const call = async (name, args, opts) => {
  const r = await rpc('tools/call', { name, arguments: args }, opts);
  assert.equal(r.status, 200);
  return r.body.result.content[0].text;
};

test('rejects requests without the token', async () => {
  assert.equal((await fetch(`${BASE}/mcp`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(`${BASE}/wrong-token-0123456789abcdefgh/mcp`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
});

test('MCP over HTTP: initialize, list tools, notifications', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'chatgpt', version: '1' } });
  assert.equal(init.status, 200);
  assert.ok(init.headers.get('mcp-session-id'));
  assert.equal(init.body.result.serverInfo.name, 'recall');
  const note = await fetch(`${BASE}/${TOKEN}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(note.status, 202);
  const list = await rpc('tools/list', {}, { auth: 'bearer' });
  const names = list.body.result.tools.map(t => t.name);
  for (const n of ['project_brief', 'whats_new', 'post_update', 'set_goal', 'create_task', 'claim_task', 'update_task', 'search', 'fetch']) assert.ok(names.includes(n), n);
});

test('three assistants coordinate on one project', async () => {
  const p = 'Landmark1';
  assert.match(await call('set_goal', { agent: 'User Hyram', goal: 'Launch the pet portrait store before Black Friday', project: p }), /saved/);
  assert.match(await call('create_task', { agent: 'chatgpt', title: 'Write product page copy', project: p }), /task #1/);
  assert.match(await call('create_task', { agent: 'chatgpt', title: 'Fix checkout bug', lead: 'claude', project: p }), /task #2.*led by claude/);

  assert.match(await call('claim_task', { agent: 'Grok', task_id: 1 }), /You now lead task #1/);
  // Taking over someone else's task needs a reason.
  assert.match(await call('claim_task', { agent: 'chatgpt', task_id: 1 }), /led by grok/);
  assert.match(await call('claim_task', { agent: 'chatgpt', task_id: 1, reason: 'I drafted the brand voice already' }), /You now lead/);

  assert.match(await call('update_task', { agent: 'claude', task_id: 2, status: 'review', note: 'Fixed in src/stripe.js, needs a second look' }), /review, lead: claude/);
  assert.match(await call('post_update', { agent: 'claude', kind: 'handoff', to: 'grok', task_id: 2, text: 'Please review the checkout fix', project: p }), /Posted #\d+/);

  const brief = await call('project_brief', { project: p });
  assert.match(brief, /Goal: Launch the pet portrait store/);
  assert.match(brief, /task #1 · in_progress · lead: chatgpt/);
  assert.match(brief, /task #2 · review · lead: claude/);
  assert.match(brief, /claude \[handoff\] → grok · task #2: Please review/);
  assert.match(brief, /chatgpt \[task\] Took over task #1 from grok/);

  const sinceId = Number(brief.match(/since_id (\d+)/)[1]);
  assert.equal(await call('whats_new', { project: p, since_id: sinceId }), 'Nothing new.');
  await call('post_update', { agent: 'grok', text: 'Reviewed, looks good', task_id: 2, project: p });
  assert.match(await call('whats_new', { project: p, since_id: sinceId }), /grok \[update\] task #2: Reviewed/);

  const task = await call('fetch', { id: 'task-2' });
  assert.match(task, /Fix checkout bug/);
  assert.match(task, /Reviewed, looks good/);
  assert.match(await call('search', { query: 'checkout', project: p }), /checkout/i);
  assert.match(await call('list_tasks', { project: '*' }), /task #1/);
});

test('Claude Code hooks and MCP relay to the shared server', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'Landmark1-'));
  fs.mkdirSync(path.join(project, '.git'));
  const localData = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-local-'));
  const env = { ...process.env, RECALL_REMOTE_URL: BASE, RECALL_TOKEN: TOKEN, RECALL_DATA_DIR: localData, RECALL_PROJECT: 'Landmark1' };
  // Hooks run synchronously from Claude Code's point of view; use async spawn so the server can answer.
  const hook = (event, payload) => new Promise(resolve => {
    const child = spawn(process.execPath, ['--no-warnings', path.join(root, 'src/hook.js'), event], { env });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('exit', () => resolve(out));
    child.stdin.end(JSON.stringify(payload));
  });
  const s = { session_id: 'cc-session-1', cwd: project };
  const start = JSON.parse(await hook('session-start', s));
  assert.match(start.hookSpecificOutput.additionalContext, /Shared goal.*\n.*Launch the pet portrait store/);
  assert.match(start.hookSpecificOutput.additionalContext, /task #2 · review · claude/);
  await hook('user-prompt', { ...s, prompt: 'make the hero image bigger' });
  await hook('post-tool', { ...s, tool_name: 'Edit', tool_input: { file_path: path.join(project, 'public/index.html'), old_string: 'a', new_string: 'b' }, tool_response: {} });
  await hook('session-end', s);
  assert.ok(!fs.existsSync(path.join(localData, 'recall.db')), 'nothing written locally in remote mode');

  const feed = await call('whats_new', { project: 'Landmark1', agent: 'claude-code' });
  assert.match(feed, /claude-code \[change\] Edited public\/index\.html/);

  // The plugin's stdio MCP server relays to the shared server.
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cc', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } },
  ].map(m => JSON.stringify(m)).join('\n');
  const replies = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--no-warnings', path.join(root, 'src/mcp.js')], { env, cwd: project });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('exit', () => resolve(out.trim().split('\n').map(l => JSON.parse(l))));
    child.stdin.end(`${lines}\n`);
  });
  assert.equal(replies.length, 2);
  assert.match(replies[1].result.content[0].text, /Fix checkout bug/);
});

test('dashboard is served behind the token', async () => {
  const redirect = await fetch(`${BASE}/${TOKEN}`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  const page = await fetch(`${BASE}/${TOKEN}/`);
  assert.match(await page.text(), /Recall Board/);
  const board = await (await fetch(`${BASE}/${TOKEN}/api/board?project=Landmark1`)).json();
  assert.equal(board.goal.goal, 'Launch the pet portrait store before Black Friday');
  assert.ok(board.tasks.length >= 2);
});

test('dashboard posts updates for read-only assistants', async () => {
  const post = body => fetch(`${BASE}/${TOKEN}/api/post`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ok = await post({ agent: 'chatgpt', kind: 'proposal', text: 'Lead with the memorial portrait angle', project: 'Landmark1' });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).message, /Posted #\d+/);
  assert.match(await call('whats_new', { project: 'Landmark1', agent: 'chatgpt' }), /chatgpt \[proposal\] Lead with the memorial portrait angle/);
  assert.equal((await post({ agent: 'chatgpt', text: '' })).status, 400);
  const form = await fetch(`${BASE}/${TOKEN}/api/post`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(form.status, 415);
  assert.equal((await fetch(`${BASE}/api/post`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});

test('old databases are upgraded in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-old-'));
  const script = `
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(path.join(dir, 'recall.db'))});
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, project TEXT NOT NULL, cwd TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ended_at INTEGER)");
    db.exec("CREATE TABLE observations (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, project TEXT NOT NULL, tool TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)");
    db.exec("INSERT INTO observations (session_id, project, tool, kind, title, created_at) VALUES ('s', 'p', 'Bash', 'command', 'Ran: ls', 1)");
    db.close();
    process.env.RECALL_DATA_DIR = ${JSON.stringify(dir)};
    const { Store } = await import(${JSON.stringify(path.join(root, 'src/db.js'))});
    const store = new Store();
    console.log(store.feed({}).map(o => o.agent).join(','), store.stats().tasks);
  `;
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.stderr, '');
  assert.equal(r.stdout.trim(), 'claude-code 0');
});
