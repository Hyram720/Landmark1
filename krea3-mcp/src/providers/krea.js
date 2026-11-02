// Krea API (https://www.krea.ai/docs/developers/krea-3/overview). Default model: Krea 3.
import { ProviderError, httpJson } from './common.js';

const API = () => (process.env.KREA_API_BASE || 'https://api.krea.ai').replace(/\/$/, '');
const PENDING = new Set(['scheduled', 'processing', 'queued', 'backlogged', 'sampling', 'intermediate-complete']);
export const KREA_DEFAULT_MODEL = 'image/krea/krea-3';

function auth() {
  const t = process.env.KREA_API_KEY;
  if (!t) throw new ProviderError('krea', 'KREA_API_KEY is not set. Create a token at https://www.krea.ai/app/api.', 401);
  return { Authorization: `Bearer ${t}` };
}

export const krea = {
  name: 'krea',
  label: 'Krea',
  configured: () => Boolean(process.env.KREA_API_KEY),

  async upload({ buffer, filename, mimeType }) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    const out = await httpJson('krea', `${API()}/assets`, { method: 'POST', headers: auth(), body: form });
    if (!out.image_url) throw new ProviderError('krea', `upload returned no image_url: ${JSON.stringify(out)}`);
    return out.image_url;
  },

  // model is a path under /generate, e.g. "image/krea/krea-3".
  async submit({ model = KREA_DEFAULT_MODEL, input, zeroDataRetention = false }) {
    const headers = { ...auth(), 'Content-Type': 'application/json' };
    if (zeroDataRetention) headers['X-Api-Zero-Data-Retention'] = '1';
    const out = await httpJson('krea', `${API()}/generate/${model.replace(/^\/+/, '')}`, { method: 'POST', headers, body: JSON.stringify(input) });
    if (!out.job_id) throw new ProviderError('krea', `no job_id in response: ${JSON.stringify(out)}`);
    return out.job_id;
  },

  async status(id) {
    const job = await httpJson('krea', `${API()}/jobs/${encodeURIComponent(id)}`, { headers: auth(), timeoutMs: 30_000 });
    if (job.status === 'completed') return { state: 'completed', urls: job.result?.urls || [], raw: job };
    if (PENDING.has(job.status)) return { state: 'pending', detail: job.status, urls: [], raw: job };
    return { state: 'failed', detail: job.status, error: job.error || job.result?.error || job.status, urls: [], raw: job };
  },
};

// Builds a Krea 3 request body from the shared edit options.
export function kreaInput(o) {
  const input = {
    prompt: o.prompt,
    image_urls: o.image_urls?.length ? o.image_urls : undefined,
    thinking_mode: o.thinking_mode || 'fast',
    resolution: o.thinking_mode === 'ultra' ? '2K' : o.resolution || '2K',
    aspect_ratio: o.aspect_ratio,
    regional_edit: o.regional_edit,
    regions: o.regions,
    negative_prompt: o.negative_prompt,
    seed: o.seed,
  };
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
  return input;
}

// List prices from the Krea 3 docs (checked 2026-11-02). Krea bills the final amount; this is an estimate.
export function estimateKreaCost({ resolution = '2K', thinking_mode = 'fast', references_1k = 0, references_2k = 0 }) {
  const res = String(resolution).toUpperCase();
  const refs = references_1k + references_2k;
  const lines = [];
  let total = 0;
  const add = (item, usd) => {
    lines.push({ item, usd: Number(usd.toFixed(3)) });
    total += usd;
  };
  if (thinking_mode === 'ultra') {
    add('base (2K; ultra is always 2K)', 0.06);
    const first = Math.min(refs, 4);
    if (first) add(`${first} reference image(s) at $0.07`, first * 0.07);
    if (refs > 4) add(`${refs - 4} more reference image(s) at $0.02`, (refs - 4) * 0.02);
    add('ultra thinking mode', 0.2);
  } else {
    add(`base (${res === '1K' ? '1K' : '2K'})`, res === '1K' ? 0.03 : 0.06);
    if (res === '4K') add('4K surcharge', 0.04);
    if (references_1k) add(`${references_1k} reference image(s) up to ~1MP at $0.02`, references_1k * 0.02);
    if (references_2k) add(`${references_2k} reference image(s) above ~1MP at $0.07`, references_2k * 0.07);
    if (thinking_mode === 'high') add('high thinking mode', 0.02);
  }
  return { estimated_usd: Number(total.toFixed(3)), breakdown: lines, source: 'https://www.krea.ai/docs/developers/krea-3/overview#pricing' };
}
