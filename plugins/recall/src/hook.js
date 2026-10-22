#!/usr/bin/env node
// Claude Code hook entry point: `node hook.js <event>` with the event JSON on stdin.
// A hook must never break the session, so every failure is logged and swallowed.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log, projectName, readStdin, redact } from './util.js';

const event = process.argv[2];

async function main() {
  const raw = await readStdin();
  const input = raw ? JSON.parse(raw) : {};
  if (process.env.RECALL_DISABLED === '1') return;
  const { Store } = await import('./db.js');
  const store = new Store();
  const sessionId = input.session_id || 'unknown';
  const project = projectName(input.cwd);

  try {
    switch (event) {
      case 'session-start': {
        store.touchSession(sessionId, project, input.cwd);
        const { buildContext } = await import('./context.js');
        const context = buildContext(store, project, { currentSession: sessionId });
        if (context) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
          }));
        }
        break;
      }
      case 'user-prompt': {
        store.touchSession(sessionId, project, input.cwd);
        const text = redact(input.prompt ?? '').trim();
        if (text && text !== '[private]') store.addPrompt(sessionId, project, text);
        break;
      }
      case 'post-tool': {
        const { toObservation } = await import('./observe.js');
        const obs = toObservation(input);
        if (obs) {
          store.touchSession(sessionId, project, input.cwd);
          store.addObservation({ ...obs, project });
        }
        break;
      }
      case 'stop': {
        const { heuristicSummary } = await import('./summarize.js');
        const summary = heuristicSummary(store, sessionId, input.transcript_path);
        if (summary) store.saveSummary(summary);
        break;
      }
      case 'session-end': {
        const { heuristicSummary } = await import('./summarize.js');
        store.endSession(sessionId);
        const summary = heuristicSummary(store, sessionId, input.transcript_path);
        if (summary) {
          store.saveSummary(summary);
          // The AI summary can take a while; run it detached so exit isn't delayed.
          if (process.env.RECALL_AI !== 'off') {
            const worker = fileURLToPath(new URL('./worker.js', import.meta.url));
            spawn(process.execPath, ['--no-warnings', worker, sessionId, input.transcript_path ?? ''], {
              detached: true,
              stdio: 'ignore',
              env: process.env,
            }).unref();
          }
        }
        break;
      }
      default:
        log(`unknown hook event: ${event}`);
    }
  } finally {
    store.close();
  }
}

main().catch(err => log(`hook ${event} failed`, err)).finally(() => process.exit(0));
