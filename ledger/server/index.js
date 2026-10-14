import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.LEDGER_PORT || process.env.PORT || 4100);
const dataDir = process.env.LEDGER_DATA_DIR || path.resolve('data/ledger');
const { app, db } = createApp({ dataDir, encryptionKey: process.env.LEDGER_ENCRYPTION_KEY });

app.listen(port, () => {
  console.log(`Ledger running on http://localhost:${port}`);
  console.log(`  staff app  /    client portal  /portal    intake form  /apply`);
  console.log(`  data: ${db.file}${db.encrypted ? ' (encrypted)' : ' (NOT encrypted — set LEDGER_ENCRYPTION_KEY in production)'}`);
});
