#!/usr/bin/env node
// Runs the four cross-assistant workflows against a deployed Recall server, each assistant
// using its own key the way its platform sends it (Claude and ChatGPT: key in the URL path;
// Grok via the xAI API: Authorization header). Everything is written to the project
// "bridge-selftest" so real projects are untouched.
//
//   RECALL_URL=https://your-host RECALL_KEY_CLAUDE=... RECALL_KEY_CHATGPT=... RECALL_KEY_GROK=... \
//     node plugins/recall/scripts/verify-deployment.mjs
const base = (process.env.RECALL_URL ?? '').replace(/\/+$/, '');
const keys = { claude: process.env.RECALL_KEY_CLAUDE, chatgpt: process.env.RECALL_KEY_CHATGPT, grok: process.env.RECALL_KEY_GROK };
if (!base || Object.values(keys).some(k => !k)) {
  console.error('Set RECALL_URL, RECALL_KEY_CLAUDE, RECALL_KEY_CHATGPT and RECALL_KEY_GROK.');
  process.exit(2);
}
const PROJECT = 'bridge-selftest';
const stamp = new Date().toISOString();

let id = 1;
async function rpc(who, method, params) {
  const header = who === 'grok';
  const res = await fetch(header ? `${base}/mcp` : `${base}/${keys[who]}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(header ? { authorization: `Bearer ${keys[who]}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
  });
  if (res.status !== 200) throw new Error(`${who} ${method}: HTTP ${res.status}`);
  return (await res.json()).result;
}
async function tool(who, name, args) {
  const r = await rpc(who, 'tools/call', { name, arguments: { project: PROJECT, ...args } });
  if (r.isError) throw new Error(`${who} ${name}: ${r.content[0].text}`);
  return r.content[0].text;
}
const versionOf = text => Number(text.match(/version (\d+)/)[1]);

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([name, 'PASS', '']);
  } catch (err) {
    results.push([name, 'FAIL', err.message]);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('health', async () => {
  const r = await fetch(`${base}/health`);
  expect(r.ok && (await r.json()).ok === true, `health answered ${r.status}`);
});

await check('each assistant connects (initialize + tools/list)', async () => {
  for (const who of Object.keys(keys)) {
    const init = await rpc(who, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: who, version: '1' } });
    expect(init.serverInfo.name === 'recall', `${who} initialize`);
    const tools = (await rpc(who, 'tools/list', {})).tools.map(t => t.name);
    expect(tools.includes('get_project') && tools.includes('update_project'), `${who} tools/list`);
  }
});

await check('TEST 1: Claude updates the project record, ChatGPT retrieves it', async () => {
  const v = versionOf(await tool('chatgpt', 'get_project', {}));
  await tool('claude', 'update_project', { expected_version: v, status: `Self-test by Claude at ${stamp}`, repo: 'Hyram720/Landmark1' });
  const seen = await tool('chatgpt', 'get_project', {});
  expect(seen.includes(`Self-test by Claude at ${stamp}`), 'ChatGPT did not see Claude\'s status');
  expect(seen.includes('last changed by claude'), 'change not attributed to claude');
});

await check('TEST 2: Grok updates a task, Claude retrieves the change', async () => {
  const created = await tool('claude', 'create_task', { title: `Self-test task ${stamp}` });
  const taskId = Number(created.match(/task #(\d+)/)[1]);
  await tool('grok', 'update_task', { task_id: taskId, status: 'review', note: `Grok checked it at ${stamp}`, expected_version: 1 });
  const seen = await tool('claude', 'fetch', { id: `task-${taskId}` });
  expect(new RegExp(`task #${taskId} · review`).test(seen), 'Claude did not see the new status');
  expect(seen.includes(`Grok checked it at ${stamp}`) && /grok \[task\]/.test(seen), 'Claude did not see Grok\'s note');
  // A stale write is refused instead of overwriting Grok's change.
  const stale = await rpc('claude', 'tools/call', { name: 'update_task', arguments: { task_id: taskId, status: 'open', expected_version: 1 } });
  expect(stale.isError && /Conflict/.test(stale.content[0].text), 'stale write was not refused');
});

await check('TEST 3: ChatGPT retrieves the development history', async () => {
  const history = await tool('chatgpt', 'project_history', { limit: 100 });
  expect(history.includes('claude [registry]'), 'history lacks Claude\'s registry change');
  expect(/grok \[task\] Task #\d+ \(open → review\)/.test(history), 'history lacks Grok\'s task change');
});

await check('TEST 4: all three see the same project status', async () => {
  const views = await Promise.all(Object.keys(keys).map(who => tool(who, 'get_project', {})));
  const status = v => v.match(/^Status: .*$/m)[0];
  const version = v => versionOf(v);
  expect(new Set(views.map(status)).size === 1, `status differs: ${views.map(status).join(' | ')}`);
  expect(new Set(views.map(version)).size === 1, 'version differs');
  const boards = await Promise.all(Object.keys(keys).map(who => tool(who, 'list_tasks', {})));
  expect(new Set(boards).size === 1, 'task boards differ');
});

await check('identity: a key cannot sign as another assistant', async () => {
  await tool('grok', 'post_update', { agent: 'claude', text: `Impersonation probe ${stamp}` });
  const feed = await tool('claude', 'whats_new', { limit: 5 });
  expect(feed.includes(`grok [update] Impersonation probe ${stamp}`), 'post was not signed as grok');
});

for (const [name, verdict, why] of results) console.log(`${verdict}  ${name}${why ? `\n      ${why}` : ''}`);
process.exit(results.every(r => r[1] === 'PASS') ? 0 : 1);
