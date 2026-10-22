#!/usr/bin/env node
// MCP server over newline-delimited stdio, used by Claude Code.
// With RECALL_REMOTE_URL set it relays every message to the shared server instead,
// so Claude Code sees the same memory and task board as ChatGPT and Grok.
import { realpathSync } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { remoteConfig, remoteFetch } from './remote.js';
import { log, projectName } from './util.js';

const write = msg => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function relay(msg) {
  // Calls from Claude Code default to the project it is running in.
  if (msg.method === 'tools/call' && msg.params?.arguments && !msg.params.arguments.project) {
    msg.params.arguments.project = projectName(process.cwd());
  }
  try {
    const res = await remoteFetch('/mcp', msg, 30000);
    if (res.status === 202) return null;
    return await res.json();
  } catch (err) {
    log('mcp relay failed', err);
    if (msg.id === undefined) return null;
    if (msg.method === 'tools/call') {
      return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `Error: could not reach the shared recall server (${err.message}).` }], isError: true } };
    }
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `recall server unreachable: ${err.message}` } };
  }
}

async function main() {
  const remote = remoteConfig();
  let local = null;
  if (!remote) {
    const { Store } = await import('./db.js');
    const { handle } = await import('./rpc.js');
    const store = new Store();
    const ctx = { defaultProject: projectName(process.cwd()) };
    local = { store, answer: msg => handle(store, msg, ctx) };
  }

  const rl = readline.createInterface({ input: process.stdin });
  let pending = Promise.resolve();
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    // Keep replies in request order.
    pending = pending.then(async () => {
      try {
        const response = local ? local.answer(msg) : await relay(msg);
        if (response) write(response);
      } catch (err) {
        log('mcp error', err);
      }
    });
  });
  rl.on('close', () => pending.then(() => local?.store.close()));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (isMain) main();
