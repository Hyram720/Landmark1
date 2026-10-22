#!/usr/bin/env node
// Background job started by the SessionEnd hook: `node worker.js <session_id>`.
import { Store } from './db.js';
import { aiSummary } from './summarize.js';
import { log } from './util.js';

const [sessionId] = process.argv.slice(2);
const store = new Store();
try {
  const stored = await aiSummary(store, sessionId);
  if (stored) log(`AI summary stored for session ${sessionId}`);
} catch (err) {
  log('worker failed', err);
} finally {
  store.close();
}
