import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-bridge-'));
const KEYS = {
  owner: 'owner-key-0123456789abcdefghijkl',
  claude: 'claude-key-0123456789abcdefghijk',
  chatgpt: 'chatgpt-key-0123456789abcdefghij',
  grok: 'grok-key-0123456789abcdefghijklmn',
  viewer: 'viewer-key-0123456789abcdefghijk',
};
const PORT = 49000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let serverOutput = '';
test.before(async () => {
  server = spawn(process.execPath, ['--no-warnings', path.join(root, 'src/server.js')], {
    env: {
      ...process.env, RECALL_DATA_DIR: dataDir, RECALL_TOKEN: KEYS.owner, PORT: String(PORT), HOST: '127.0.0.1', RECALL_AI: 'off',
      RECALL_AGENT_TOKENS: `claude=${KEYS.claude}, chatgpt=${KEYS.chatgpt},grok=${KEYS.grok},viewer:read=${KEYS.viewer}`,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => {
      serverOutput += d;
      if (serverOutput.includes('listening')) resolve();
    });
    server.on('exit', code => reject(new Error(`server exited ${code}`)));
  });
});
test.after(() => server.kill());

let nextId = 1;
// Each assistant connects the way its platform does: Claude and ChatGPT with the key in the
// URL path, Grok (xAI API) with an Authorization header.
async function call(who, name, args = {}) {
  const viaHeader = who === 'grok';
  const res = await fetch(viaHeader ? `${BASE}/mcp` : `${BASE}/${KEYS[who]}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(viaHeader ? { authorization: `Bearer ${KEYS[who]}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  return { text: result.content[0].text, isError: !!result.isError };
}
const ok = async (...a) => {
  const r = await call(...a);
  assert.ok(!r.isError, r.text);
  return r.text;
};

test('the project registry with version tracking and conflict detection', async () => {
  const p = 'Bridge';
  assert.match(await ok('claude', 'update_project', {
    project: p, description: 'Shared memory for three assistants', repo: 'Hyram720/Landmark1', stack: 'Node 22, SQLite', status: 'Building', expected_version: 0,
  }), /version 1/);
  const record = await ok('chatgpt', 'get_project', { project: p });
  assert.match(record, /# Bridge \(version 1, last changed by claude/);
  assert.match(record, /Repository: Hyram720\/Landmark1/);
  assert.match(record, /Stack: Node 22, SQLite/);

  // ChatGPT and Grok both read version 1; ChatGPT writes first, so Grok's stale write is refused.
  assert.match(await ok('chatgpt', 'update_project', { project: p, status: 'Testing', expected_version: 1 }), /version 2/);
  const stale = await call('grok', 'update_project', { project: p, status: 'Deployed', expected_version: 1 });
  assert.ok(stale.isError);
  assert.match(stale.text, /Conflict: project Bridge is at version 2, not 1/);
  assert.match(await ok('claude', 'get_project', { project: p }), /Status: Testing/);
});

test('task writes detect conflicts too', async () => {
  const p = 'Bridge';
  assert.match(await ok('claude', 'create_task', { project: p, title: 'Deploy to Railway' }), /Created task #(\d+)/);
  const id = Number((await ok('claude', 'list_tasks', { project: p })).match(/task #(\d+) .*Deploy to Railway.*v1\)/)[1]);
  assert.match(await ok('grok', 'update_task', { task_id: id, status: 'in_progress', note: 'Starting', expected_version: 1 }), /version 2/);
  const stale = await call('claude', 'update_task', { task_id: id, status: 'blocked', expected_version: 1 });
  assert.match(stale.text, /Conflict: task #\d+ is at version 2, not 1/);
  assert.match(await ok('claude', 'claim_task', { task_id: id, reason: 'I have Railway access', expected_version: 2 }), /You now lead/);
});

test('a key signs as its own assistant, whatever the call claims', async () => {
  await ok('chatgpt', 'post_update', { project: 'Bridge', agent: 'claude', text: 'Pretending to be Claude' });
  const feed = await ok('owner', 'whats_new', { project: 'Bridge', limit: 5 });
  assert.match(feed, /chatgpt \[update\] Pretending to be Claude/);
  assert.doesNotMatch(feed, /claude \[update\] Pretending/);
  // The owner key still signs with the name it passes.
  await ok('owner', 'post_update', { project: 'Bridge', agent: 'hyram', text: 'Owner note' });
  assert.match(await ok('owner', 'whats_new', { project: 'Bridge', limit: 1 }), /hyram \[update\] Owner note/);
});

test('read-only keys can read but not write', async () => {
  assert.match(await ok('viewer', 'get_project', { project: 'Bridge' }), /# Bridge/);
  const write = await call('viewer', 'post_update', { project: 'Bridge', text: 'hi' });
  assert.ok(write.isError);
  assert.match(write.text, /viewer has read-only access/);
  const hook = await fetch(`${BASE}/${KEYS.viewer}/hook`, { method: 'POST', body: '{}' });
  assert.equal(hook.status, 403);
});

test('development history and the audit log', async () => {
  const history = await ok('chatgpt', 'project_history', { project: 'Bridge' });
  assert.match(history, /claude \[registry\] Updated project description, repo, stack, status \(now version 1\)/);
  assert.match(history, /chatgpt \[registry\] Updated project status \(now version 2\)/);
  assert.match(history, /grok \[task\] Task #\d+ \(open → in_progress\)/);
  assert.ok(history.indexOf('now version 1') < history.indexOf('now version 2'), 'oldest first');

  const audit = await ok('owner', 'audit_log', { limit: 100 });
  assert.match(audit, /grok update_project \(Bridge\) FAILED: Conflict/);
  assert.match(audit, /viewer post_update \(Bridge\) FAILED: viewer has read-only access/);
  assert.match(audit, /chatgpt get_project \(Bridge\) ok/);
  assert.match(await ok('owner', 'audit_log', { agent: 'grok' }), /^[^\n]*grok/);
});

test('the dashboard is for the owner key only', async () => {
  assert.equal((await fetch(`${BASE}/${KEYS.owner}/`)).status, 200);
  assert.equal((await fetch(`${BASE}/${KEYS.claude}/`)).status, 403);
  assert.equal((await fetch(`${BASE}/${KEYS.chatgpt}/api/board`)).status, 403);
  assert.equal((await fetch(`${BASE}/not-a-key-0123456789abcdefghij/mcp`, { method: 'POST', body: '{}' })).status, 401);
});

test('health check and access log', async () => {
  const health = await fetch(`${BASE}/health`);
  assert.deepEqual(await health.json(), { ok: true });
  assert.match(serverOutput, /Assistant keys: claude, chatgpt, grok, viewer \(read-only\)/);
  assert.match(serverOutput, /POST \/mcp 200 grok \d+ms/);
  assert.match(serverOutput, /POST \/<redacted> 401 anonymous/);
  for (const key of Object.values(KEYS)) assert.ok(!serverOutput.includes(key), 'keys never reach the log');
});
