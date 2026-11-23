// Quick end-to-end check using the free test engine. Run: npm test
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-test-'));
const port = 5099;
const srv = spawn(process.execPath, ['src/server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), TTS_PROVIDER: 'mock', OPENAI_API_KEY: '', DATA_DIR: dataDir, VOICE_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const base = `http://localhost:${port}`;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const cfg = await (await fetch(base + '/api/config')).json();
  check(cfg.defaultProvider === 'mock', 'falls back to test engine without a key');

  const profiles = await (await fetch(base + '/api/profiles')).json();
  check(profiles.length >= 4, 'default voices created');

  const r1 = await fetch(`${base}/api/tts?profile=support-bot&text=${encodeURIComponent('Hello from the bot.')}`);
  const bytes = Buffer.from(await r1.arrayBuffer());
  check(r1.ok && bytes.subarray(0, 4).toString() === 'RIFF', 'GET /api/tts returns audio');

  const j1 = await (await fetch(base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: 'support-bot', text: 'Hello from the bot.', json: 1 }) })).json();
  check(j1.cached === true && j1.url.startsWith('/audio/'), 'same text + voice is cached');

  const bad = await fetch(base + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: 'nope', text: 'x' }) });
  check(bad.status === 404, 'unknown voice gives a clear error');

  const saved = await (await fetch(base + '/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sunny Bot', provider: 'mock', voice: 'high', speed: 1.2 }) })).json();
  check(saved.id === 'sunny-bot', 'new voice saved with a bot-friendly ID');

  const hist = await (await fetch(base + '/api/history')).json();
  check(hist.length === 1, 'history records new audio only');

  const burst = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    fetch(`${base}/api/tts?json=1&profile=narrator&text=${encodeURIComponent('Parallel line ' + i)}`)));
  check(burst.every((r) => r.ok), '12 bots asking at the same time all succeed');
  const hist2 = await (await fetch(base + '/api/history')).json();
  check(hist2.length === 13, 'history keeps every parallel request');

  const { chunkText } = await import('./providers.js');
  const long = 'This is a sentence. '.repeat(500);
  const chunks = chunkText(long, 4000);
  check(chunks.every((c) => c.length <= 4000) && chunks.join(' ').length >= long.trim().length - chunks.length, 'long text is split under the engine limit');
} finally {
  srv.kill();
  await fs.rm(dataDir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
