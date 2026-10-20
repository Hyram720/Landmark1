// Ledger server entry point. Start with `node ledger/server/index.js` (preferred in production:
// running node directly, not through `npm run`, means Railway's SIGTERM reaches this process and
// the shutdown below runs, instead of npm logging "command failed / signal SIGTERM").
import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.LEDGER_PORT || process.env.PORT || 4100);
const dataDir = process.env.LEDGER_DATA_DIR || path.resolve('data/ledger');
const key = process.env.LEDGER_ENCRYPTION_KEY;
const production = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

if (production && !key) {
  console.error('Refusing to start: LEDGER_ENCRYPTION_KEY is not set. Client data must be encrypted at rest in production.');
  process.exit(1);
}
if (key && key.length < 24) console.warn('[config] LEDGER_ENCRYPTION_KEY is shorter than 24 characters. Use a long random value (e.g. 32+ random bytes, base64).');

const { app, db, shutdown } = createApp({ dataDir, encryptionKey: key });

const server = app.listen(port, () => {
  console.log(`Ledger running on http://localhost:${port}`);
  console.log(`  staff app  /    client portal  /portal    intake form  /apply    health  /api/health`);
  console.log(`  data: ${db.file}${db.encrypted ? ' (encrypted)' : ' (NOT encrypted — set LEDGER_ENCRYPTION_KEY in production)'}`);
});
// Slightly longer than the proxy's idle timeout so the proxy, not Node, closes idle connections.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[shutdown] ${signal} received — finishing open requests and saving`);
  const force = setTimeout(() => { console.warn('[shutdown] forced exit after 10s'); try { shutdown(); } catch {} process.exit(0); }, 10_000);
  force.unref();
  server.close(() => {
    try { shutdown(); console.log('[shutdown] data saved, bye'); } catch (e) { console.error('[shutdown] save failed:', e.message); }
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e && e.stack || e));
