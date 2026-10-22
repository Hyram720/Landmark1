import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-test-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-proj-'));
fs.mkdirSync(path.join(project, '.git'));
const env = { ...process.env, RECALL_DATA_DIR: dataDir, RECALL_AI: 'off' };

process.env.RECALL_DATA_DIR = dataDir;
const { Store, ftsQuery } = await import('../src/db.js');
const { redact } = await import('../src/util.js');

function hook(event, payload) {
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(root, 'src/hook.js'), event], {
    input: JSON.stringify(payload), env, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout;
}

const cli = (...args) => execFileSync(process.execPath, ['--no-warnings', path.join(root, 'src/cli.js'), ...args], { env, cwd: project, encoding: 'utf8' });

const transcript = path.join(project, 'transcript.jsonl');
fs.writeFileSync(transcript, [
  JSON.stringify({ type: 'user', message: { content: 'add a health check' } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Added GET /health returning ok, and a test.' }] } }),
].join('\n'));

test('redacts secrets and private blocks', () => {
  const out = redact('key sk-ant-abcdefghijklmnopqrstuv and <private>my password</private> STRIPE_SECRET_KEY=sk_live_123456789');
  assert.ok(!out.includes('abcdefghijklmnop'));
  assert.ok(!out.includes('my password'));
  assert.ok(!out.includes('sk_live_123456789'));
});

test('fts query escapes operators', () => {
  assert.equal(ftsQuery('health "check" OR -x'), '"health"* "check"* "OR"* "x"*');
  assert.equal(ftsQuery('!!!'), '');
});

test('a full session is captured, summarized, and injected into the next one', () => {
  const s1 = { session_id: 'aaaaaaaa-1111', cwd: project, transcript_path: transcript };
  assert.equal(hook('session-start', { ...s1, hook_event_name: 'SessionStart' }), '');
  hook('user-prompt', { ...s1, prompt: 'Add a health check endpoint <private>token 123</private>' });
  hook('post-tool', { ...s1, tool_name: 'Edit', tool_input: { file_path: path.join(project, 'src/server.js'), old_string: 'app.listen', new_string: "app.get('/health', ok)\napp.listen" }, tool_response: {} });
  hook('post-tool', { ...s1, tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' }, tool_response: { stdout: '12 passing', stderr: '' } });
  hook('post-tool', { ...s1, tool_name: 'Read', tool_input: { file_path: path.join(project, 'README.md') }, tool_response: {} });
  hook('post-tool', { ...s1, tool_name: 'mcp__plugin_recall_recall__search', tool_input: { query: 'x' }, tool_response: {} });
  hook('post-tool', { ...s1, tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'health check', status: 'completed' }, { content: 'add metrics', status: 'pending' }] }, tool_response: {} });
  hook('stop', s1);
  hook('session-end', s1);

  const store = new Store();
  const obs = store.observationsFor(s1.session_id);
  assert.deepEqual(obs.map(o => o.kind), ['change', 'command', 'read', 'plan']);
  assert.equal(obs[0].title, 'Edited src/server.js');
  assert.ok(!store.promptsFor(s1.session_id)[0].text.includes('token 123'));
  const summary = store.summaryFor(s1.session_id);
  assert.match(summary.request, /health check endpoint/);
  assert.match(summary.completed, /GET \/health/);
  assert.equal(summary.files, 'src/server.js');
  assert.match(summary.next_steps, /add metrics/);
  assert.ok(store.session(s1.session_id).ended_at);
  store.close();

  const out = JSON.parse(hook('session-start', { session_id: 'bbbbbbbb-2222', cwd: project }));
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(ctx, /Edited src\/server\.js/);
  assert.match(ctx, /Ran: npm test/);
  assert.doesNotMatch(ctx, /Read README/); // reads are searchable but not injected
  assert.match(ctx, /Next: .*add metrics/);
});

test('hooks survive bad input', () => {
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(root, 'src/hook.js'), 'post-tool'], { input: 'not json', env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('MCP server lists tools and searches', () => {
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'health' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'remember', arguments: { note: 'Deploys go through Railway, never Vercel' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search', arguments: { query: 'railway', kind: 'note' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope', arguments: {} } },
  ].map(m => JSON.stringify(m)).join('\n');
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(root, 'src/mcp.js')], { input: `${lines}\n`, env, cwd: project, encoding: 'utf8' });
  const replies = r.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(replies.length, 6); // the notification gets no reply
  assert.equal(replies[0].result.serverInfo.name, 'recall');
  assert.ok(replies[1].result.tools.some(t => t.name === 'timeline'));
  assert.match(replies[2].result.content[0].text, /health/i);
  assert.match(replies[3].result.content[0].text, /Saved as #\d+/);
  assert.match(replies[4].result.content[0].text, /Railway/);
  assert.equal(replies[5].error.code, -32602);
});

test('CLI search, stats, context and forget', () => {
  assert.match(cli('search', 'npm'), /Ran: npm test/);
  assert.match(cli('stats'), /observations: \d+/);
  assert.match(cli('context'), /Recall: shared memory/);
  const id = cli('search', 'server').match(/#(\d+)/)[1];
  assert.match(cli('timeline', id), /Edited src\/server\.js/);
  assert.match(cli('forget', '--session', 'aaaaaaaa-1111'), /Removed \d+ rows/);
  assert.doesNotMatch(cli('search', 'npm'), /Ran: npm test/);
});
