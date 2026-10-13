// IndexNow: tells Bing, Yahoo, DuckDuckGo, Yandex and others about our pages without an account.
// The key is public by design (it is served at /<key>.txt to prove we own the site). Pages are
// re-submitted only when the list of URLs changes, so restarts don't spam the search engines.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from './config.js';
import { sitePaths } from './seo.js';

export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '89d75adc66d2d04b2dbfcf573013c0c6';
const stateFile = path.join(config.dataDir, 'indexnow.json');

export async function submitIndexNow() {
  const base = new URL(config.baseUrl);
  if (!/^https:/.test(base.href) || base.hostname === 'localhost') return;
  const urlList = sitePaths().map((p) => `${config.baseUrl}${p}`);
  const hash = crypto.createHash('sha1').update(urlList.join('\n')).digest('hex');
  const prev = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  if (prev.hash === hash) return;
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: base.hostname, key: INDEXNOW_KEY, keyLocation: `${config.baseUrl}/${INDEXNOW_KEY}.txt`, urlList }),
    signal: AbortSignal.timeout(20_000),
  });
  console.log(`IndexNow: submitted ${urlList.length} URLs -> HTTP ${res.status}`);
  if (res.ok) fs.writeFileSync(stateFile, JSON.stringify({ hash, at: new Date().toISOString(), count: urlList.length }));
}
