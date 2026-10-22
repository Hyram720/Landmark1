#!/usr/bin/env node
// Claude Code hook entry point: `node hook.js <event>` with the event JSON on stdin.
// Records go to the local database, or to the shared server when RECALL_REMOTE_URL is set.
// A hook must never break the session, so every failure is logged and swallowed.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toObservation } from './observe.js';
import { remoteConfig, remoteFetch } from './remote.js';
import { lastAssistantText } from './summarize.js';
import { log, projectName, readStdin, redact, truncate } from './util.js';

const event = process.argv[2];

function buildRecord(input) {
  const record = { event, session_id: input.session_id || 'unknown', project: projectName(input.cwd), cwd: input.cwd ?? null };
  if (event === 'user-prompt') record.prompt = redact(input.prompt ?? '').trim();
  if (event === 'post-tool') record.observation = toObservation(input);
  if (event === 'stop' || event === 'session-end') record.last_text = redact(truncate(lastAssistantText(input.transcript_path), 8000));
  return record;
}

async function main() {
  if (process.env.RECALL_DISABLED === '1') return;
  const raw = await readStdin();
  const record = buildRecord(raw ? JSON.parse(raw) : {});
  if (record.event === 'post-tool' && !record.observation) return;

  if (remoteConfig()) {
    const res = await remoteFetch('/hook', record, event === 'session-start' ? 5000 : 8000);
    const { output } = await res.json();
    if (output) process.stdout.write(output);
    return;
  }

  const { Store } = await import('./db.js');
  const { processRecord } = await import('./core.js');
  const store = new Store();
  try {
    const output = processRecord(store, record, {
      onSessionEnd: sessionId => {
        if (process.env.RECALL_AI === 'off') return;
        // The AI summary can take a while; run it detached so exit isn't delayed.
        const worker = fileURLToPath(new URL('./worker.js', import.meta.url));
        spawn(process.execPath, ['--no-warnings', worker, sessionId], { detached: true, stdio: 'ignore', env: process.env }).unref();
      },
    });
    if (output) process.stdout.write(output);
  } finally {
    store.close();
  }
}

main().catch(err => log(`hook ${event} failed`, err)).finally(() => process.exit(0));
