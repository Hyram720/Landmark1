// Stores one hook "record" and returns what the hook should print.
// Records are built on the machine running Claude Code (see hook.js), so the
// same function works for a local database and for the shared server.
import { buildContext } from './context.js';
import { heuristicSummary } from './summarize.js';

export function processRecord(store, record, { onSessionEnd } = {}) {
  const { event, session_id: sessionId = 'unknown', project, cwd } = record;
  switch (event) {
    case 'session-start': {
      store.touchSession(sessionId, project, cwd);
      const context = buildContext(store, project, { currentSession: sessionId });
      return context
        ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })
        : '';
    }
    case 'user-prompt':
      store.touchSession(sessionId, project, cwd);
      if (record.prompt && record.prompt !== '[private]') store.addPrompt(sessionId, project, record.prompt);
      return '';
    case 'post-tool':
      if (record.observation) {
        store.touchSession(sessionId, project, cwd);
        store.addObservation({ ...record.observation, session_id: sessionId, project });
      }
      return '';
    case 'stop':
    case 'session-end': {
      if (!store.session(sessionId)) return '';
      if (record.last_text) store.setLastText(sessionId, record.last_text);
      if (event === 'session-end') store.endSession(sessionId);
      const summary = heuristicSummary(store, sessionId);
      if (summary) store.saveSummary(summary);
      if (summary && event === 'session-end') onSessionEnd?.(sessionId);
      return '';
    }
    default:
      throw new Error(`unknown hook event: ${event}`);
  }
}
