// Krea 3 image editing (https://www.krea.ai/docs/developers/krea-3/overview).
// Sends the customer's photo inline as a data URI, polls the job, returns the finished image bytes.
import fs from 'node:fs';
import config from './config.js';

const PENDING = new Set(['scheduled', 'processing', 'queued', 'backlogged', 'sampling', 'intermediate-complete']);
const api = () => config.krea.apiBase.replace(/\/$/, '');
const headers = () => ({ Authorization: `Bearer ${config.krea.apiKey}` });

async function call(p, init = {}) {
  const res = await fetch(`${api()}${p}`, { ...init, headers: { ...headers(), ...init.headers }, signal: AbortSignal.timeout(init.timeoutMs || 60_000) });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const details = body.details ? ` ${JSON.stringify(body.details)}` : '';
    const err = new Error(`Krea: HTTP ${res.status} ${body.error || body.message || text}${details}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * Paints one image with Krea 3 from a photo on disk.
 * @param {{ photoPath: string, mimeType: string, prompt: string, resolution?: '1K'|'2K'|'4K', thinkingMode?: 'fast'|'high'|'ultra', aspectRatio?: string, timeoutMs?: number }} opts
 * @returns {Promise<Buffer>}
 */
export async function kreaEdit({ photoPath, mimeType, prompt, resolution = config.krea.resolution, thinkingMode = config.krea.thinkingMode, aspectRatio = '2:3', timeoutMs = 240_000 }) {
  if (!config.krea.apiKey) throw new Error('Krea: KREA_API_KEY is not set');
  const image = photoPath ? `data:${mimeType};base64,${fs.readFileSync(photoPath).toString('base64')}` : null;
  const input = {
    prompt,
    ...(image ? { image_urls: [image] } : {}),
    thinking_mode: thinkingMode,
    resolution: thinkingMode === 'ultra' ? '2K' : resolution,
    aspect_ratio: aspectRatio,
  };
  const job = await call('/generate/image/krea/krea-3', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } });
  if (!job.job_id) throw new Error(`Krea: no job_id in response`);

  const deadline = Date.now() + timeoutMs;
  let delay = 1500;
  for (;;) {
    const st = await call(`/jobs/${encodeURIComponent(job.job_id)}`, { timeoutMs: 30_000 });
    if (st.status === 'completed') {
      const url = st.result?.urls?.[0];
      if (!url) throw new Error('Krea: job completed without an image');
      const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new Error(`Krea: download failed (HTTP ${img.status})`);
      return Buffer.from(await img.arrayBuffer());
    }
    if (!PENDING.has(st.status)) throw new Error(`Krea: job ${job.job_id} ended with status "${st.status}"`);
    if (Date.now() + delay > deadline) throw new Error(`Krea: job ${job.job_id} timed out (still ${st.status})`);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 6000);
  }
}

// Health probe: an unknown job id answers 404 with a valid key and 401/403 with a bad one.
export async function kreaKeyCheck() {
  if (!config.krea.apiKey) return 'not configured';
  try {
    const r = await fetch(`${api()}/jobs/00000000-0000-0000-0000-000000000000`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
    return r.status === 401 || r.status === 403 ? `failed (HTTP ${r.status})` : 'ok';
  } catch (err) {
    return `failed (${err.message})`;
  }
}
