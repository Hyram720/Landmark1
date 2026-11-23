import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { providers, getProvider, defaultProviderName, chunkText } from './providers.js';
import { PHONIC_VOICES, TURN_TAKING, DEFAULT_AGENTS, phonicConfigured, createSessionToken, agentToConfig, cleanAgent } from './phonic.js';

try { process.loadEnvFile?.(); } catch { /* no .env file: use real env vars */ }

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 5055;
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || './data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const MAX_TEXT = 100_000;

const DEFAULT_PROFILES = [
  { id: 'narrator', name: 'Narrator', provider: 'openai', voice: 'onyx', speed: 1,
    instructions: 'Warm, steady documentary narrator. Clear diction, confident pacing, natural pauses.' },
  { id: 'support-bot', name: 'Support Bot', provider: 'openai', voice: 'nova', speed: 1.05,
    instructions: 'Friendly, helpful customer support agent. Upbeat but calm, short natural sentences.' },
  { id: 'sales-bot', name: 'Sales Bot', provider: 'openai', voice: 'coral', speed: 1.05,
    instructions: 'Energetic, confident marketer. Enthusiastic without sounding pushy.' },
  { id: 'book-reader', name: 'Book Reader', provider: 'openai', voice: 'fable', speed: 1,
    instructions: 'Calm audiobook reader. Expressive with dialogue, relaxed pace, easy to listen to for hours.' },
];

await fs.mkdir(AUDIO_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/audio', express.static(AUDIO_DIR, { maxAge: '365d', immutable: true }));

// Optional API key (only enforced when VOICE_API_KEY is set)
app.use('/api', (req, res, next) => {
  const required = process.env.VOICE_API_KEY;
  if (!required || req.path === '/health') return next();
  const given = req.get('x-api-key') || req.query.key;
  if (given === required) return next();
  res.status(401).json({ error: 'Missing or wrong API key (send header x-api-key).' });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({
    defaultProvider: defaultProviderName(),
    liveAgents: phonicConfigured(),
    keyRequired: Boolean(process.env.VOICE_API_KEY),
    providers: Object.fromEntries(Object.entries(providers).map(([id, p]) => [id, {
      label: p.label, voices: p.voices, available: p.available(),
      supportsInstructions: p.supportsInstructions,
    }])),
  });
});

// ---------- Voice profiles ----------
app.get('/api/profiles', async (_req, res) => res.json(await loadProfiles()));

app.post('/api/profiles', (req, res) => serial(PROFILES_FILE, async () => {
  const { id, name, provider, voice, speed, instructions } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Give the voice a name.' });
  if (!getProvider(provider)) return res.status(400).json({ error: 'Unknown engine.' });
  const profiles = await loadProfiles();
  const profile = {
    id: id || slug(name) || crypto.randomUUID().slice(0, 8),
    name: name.trim(),
    provider,
    voice: String(voice || getProvider(provider).voices[0]),
    speed: Number(speed) || 1,
    instructions: String(instructions || '').slice(0, 2000),
  };
  const i = profiles.findIndex((p) => p.id === profile.id);
  if (i >= 0) profiles[i] = profile;
  else {
    if (profiles.some((p) => p.id === profile.id)) profile.id += '-' + Date.now().toString(36);
    profiles.push(profile);
  }
  await writeJson(PROFILES_FILE, profiles);
  res.json(profile);
}));

app.delete('/api/profiles/:id', (req, res) => serial(PROFILES_FILE, async () => {
  const profiles = (await loadProfiles()).filter((p) => p.id !== req.params.id);
  await writeJson(PROFILES_FILE, profiles);
  res.json({ ok: true });
}));

// ---------- Text to speech ----------
// POST /api/tts  { text, profile }            -> audio bytes
// POST /api/tts  { text, provider, voice, speed, instructions }
// GET  /api/tts?text=Hello&profile=support-bot  (easy for bots)
// Add  json=1  to get { url, cached, ... } instead of the audio itself.
app.all('/api/tts', async (req, res) => {
  try {
    const input = { ...req.query, ...(req.body || {}) };
    const text = String(input.text || '').trim();
    if (!text) return res.status(400).json({ error: 'No text to speak.' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Text is over ${MAX_TEXT} characters; split it up.` });

    const settings = await resolveSettings(input);
    const result = await synthesize(text, settings, input.source || 'api');

    if (['1', 'true'].includes(String(input.json))) return res.json(result);
    res.type(result.mime);
    res.set('X-Audio-Url', result.url);
    res.sendFile(path.join(AUDIO_DIR, result.file));
  } catch (err) {
    console.error('[tts]', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ---------- Live voice agents (Phonic-1) ----------
app.get('/api/agents', async (_req, res) => res.json({
  configured: phonicConfigured(), voices: PHONIC_VOICES, turnTaking: TURN_TAKING, agents: await loadAgents(),
}));

app.post('/api/agents', (req, res) => serial(AGENTS_FILE, async () => {
  const agent = cleanAgent(req.body);
  if (!agent.name) return res.status(400).json({ error: 'Give the agent a name.' });
  if (!agent.system_prompt.trim()) return res.status(400).json({ error: 'Describe how the agent should behave.' });
  const agents = await loadAgents();
  agent.id = agent.id || slug(agent.name) || crypto.randomUUID().slice(0, 8);
  const i = agents.findIndex((a) => a.id === agent.id);
  if (i >= 0) agents[i] = agent; else agents.push(agent);
  await writeJson(AGENTS_FILE, agents);
  res.json(agent);
}));

app.delete('/api/agents/:id', (req, res) => serial(AGENTS_FILE, async () => {
  await writeJson(AGENTS_FILE, (await loadAgents()).filter((a) => a.id !== req.params.id));
  res.json({ ok: true });
}));

// Start a live conversation: returns a short-lived token + the agent's config.
app.post('/api/agents/:id/session', async (req, res) => {
  try {
    if (!phonicConfigured()) {
      return res.status(503).json({ error: 'Live agents need a Phonic key. Add PHONIC_API_KEY to .env and restart.' });
    }
    const agent = (await loadAgents()).find((a) => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: `No agent called "${req.params.id}".` });
    const token = await createSessionToken();
    res.json({ ...token, config: agentToConfig(agent), agent: { id: agent.id, name: agent.name } });
  } catch (err) {
    console.error('[agent]', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

app.get('/api/history', async (_req, res) => res.json(await readJson(HISTORY_FILE, [])));

app.delete('/api/history', (_req, res) => serial(HISTORY_FILE, async () => {
  await writeJson(HISTORY_FILE, []);
  res.json({ ok: true });
}));

app.listen(PORT, () => {
  console.log(`Sun Voice Studio running at http://localhost:${PORT}`);
  console.log(`Speech engine: ${defaultProviderName()}${defaultProviderName() === 'mock' ? ' (add OPENAI_API_KEY to .env for real voices)' : ''}`);
});

// ---------- helpers ----------
async function resolveSettings(input) {
  let s = {};
  if (input.profile) {
    const profiles = await loadProfiles();
    const p = profiles.find((x) => x.id === input.profile || x.name.toLowerCase() === String(input.profile).toLowerCase());
    if (!p) throw Object.assign(new Error(`No voice profile called "${input.profile}".`), { status: 404 });
    s = { ...p };
  }
  for (const k of ['provider', 'voice', 'speed', 'instructions']) {
    if (input[k] !== undefined && input[k] !== '') s[k] = input[k];
  }
  // Fall back to whatever engine is actually usable.
  if (!s.provider || !getProvider(s.provider)?.available()) {
    const fallback = defaultProviderName();
    if (s.provider && s.provider !== fallback) s.voice = undefined;
    s.provider = fallback;
  }
  const p = getProvider(s.provider);
  if (!p.voices.includes(s.voice)) s.voice = p.voices[0];
  s.speed = Number(s.speed) || 1;
  s.instructions = p.supportsInstructions ? String(s.instructions || '') : '';
  return s;
}

async function synthesize(text, s, source) {
  const p = getProvider(s.provider);
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify([s.provider, s.voice, s.speed, s.instructions, text, process.env.OPENAI_TTS_MODEL || '']))
    .digest('hex').slice(0, 24);
  const file = `${hash}.${p.ext}`;
  const full = path.join(AUDIO_DIR, file);
  let cached = true;
  try {
    await fs.access(full);
  } catch {
    cached = false;
    const parts = [];
    for (const chunk of chunkText(text, p.maxChars)) parts.push(await p.synthesize(chunk, s));
    await fs.writeFile(full, Buffer.concat(parts)); // MP3 frames join cleanly end to end
  }
  const result = {
    url: `/audio/${file}`, file, mime: p.mime, cached,
    provider: s.provider, voice: s.voice, profile: s.id || null,
  };
  if (!cached) await addHistory({ ...result, name: s.name || s.voice, source, text: text.slice(0, 300), chars: text.length, at: new Date().toISOString() });
  return result;
}

async function loadProfiles() {
  const saved = await readJson(PROFILES_FILE, null);
  if (saved) return saved;
  await writeJson(PROFILES_FILE, DEFAULT_PROFILES);
  return structuredClone(DEFAULT_PROFILES);
}

async function loadAgents() {
  const saved = await readJson(AGENTS_FILE, null);
  if (saved) return saved;
  await writeJson(AGENTS_FILE, DEFAULT_AGENTS);
  return structuredClone(DEFAULT_AGENTS);
}

// History is a nice-to-have: never let it break speech generation.
function addHistory(entry) {
  return serial(HISTORY_FILE, async () => {
    const h = await readJson(HISTORY_FILE, []);
    h.unshift(entry);
    await writeJson(HISTORY_FILE, h.slice(0, 300));
  }).catch((err) => console.error('[history]', err.message));
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

// Run read-modify-write jobs on the same file one at a time (bots may call in parallel).
const queues = new Map();
function serial(key, job) {
  const run = (queues.get(key) || Promise.resolve()).then(job, job);
  queues.set(key, run.catch(() => {}));
  return run;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
