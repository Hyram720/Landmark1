// Higgsfield platform API (https://docs.higgsfield.ai). One key, many image/video models.
// Auth: "Authorization: Key <id>:<secret>". Submit to /<model-path>, poll /requests/<id>/status.
import { randomUUID } from 'node:crypto';
import { ProviderError, httpJson } from './common.js';

const API = () => (process.env.HIGGSFIELD_API_BASE || 'https://api.higgsfield.ai').replace(/\/$/, '');
const PENDING = new Set(['queued', 'in_progress', 'processing', 'running', 'pending']);

// Endpoints confirmed in the Higgsfield docs (2026-11-02). Any other documented path works via `model`.
export const HIGGSFIELD_MODELS = {
  'higgsfield-ai/soul/v2/standard': { kind: 'image', note: 'Soul 2 text-to-image (photoreal, fashion/editorial look).' },
  'alibaba/qwen-image-3/edit': { kind: 'image', note: 'Qwen Image 3 edit: image_urls + prompt, resolution "1k", aspect_ratio.' },
  'kling-video/o3/image-reference': { kind: 'video', note: 'Kling O3 video from reference images: image_urls + prompt.' },
  'kling-video/omni/image-reference': { kind: 'video', note: 'Kling Omni video from reference images: image_urls + prompt.' },
};
export const HIGGSFIELD_DEFAULT_IMAGE = 'alibaba/qwen-image-3/edit';
export const HIGGSFIELD_DEFAULT_TEXT_IMAGE = 'higgsfield-ai/soul/v2/standard';
export const HIGGSFIELD_DEFAULT_VIDEO = 'kling-video/o3/image-reference';

function credentials() {
  const combined = process.env.HIGGSFIELD_CREDENTIALS || process.env.HF_CREDENTIALS;
  const id = process.env.HIGGSFIELD_API_KEY_ID || process.env.HF_API_KEY_ID;
  const secret = process.env.HIGGSFIELD_API_KEY_SECRET || process.env.HF_API_KEY_SECRET;
  if (combined) return combined;
  if (id && secret) return `${id}:${secret}`;
  return null;
}

function auth() {
  const c = credentials();
  if (!c) throw new ProviderError('higgsfield', 'Set HIGGSFIELD_API_KEY_ID and HIGGSFIELD_API_KEY_SECRET (from https://console.higgsfield.ai).', 401);
  return { Authorization: `Key ${c}` };
}

export const higgsfield = {
  name: 'higgsfield',
  label: 'Higgsfield',
  configured: () => Boolean(credentials()),

  async upload({ buffer, mimeType }) {
    const slot = await httpJson('higgsfield', `${API()}/files/generate-upload-url`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: mimeType }),
    });
    const put = await fetch(slot.upload_url, {
      method: 'PUT',
      headers: slot.upload_headers || { 'Content-Type': mimeType },
      body: buffer,
      signal: AbortSignal.timeout(120_000),
    });
    if (!put.ok) throw new ProviderError('higgsfield', `file upload failed with HTTP ${put.status}`, put.status);
    return slot.public_url;
  },

  async submit({ model, input }) {
    if (!model) throw new ProviderError('higgsfield', 'model (endpoint path) is required, e.g. "alibaba/qwen-image-3/edit".');
    const out = await httpJson('higgsfield', `${API()}/${model.replace(/^\/+/, '')}`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify(input),
    });
    if (!out.request_id) throw new ProviderError('higgsfield', `no request_id in response: ${JSON.stringify(out)}`);
    return out.request_id;
  },

  async status(id) {
    const r = await httpJson('higgsfield', `${API()}/requests/${encodeURIComponent(id)}/status`, { headers: auth(), timeoutMs: 30_000 });
    if (r.status === 'completed') {
      const urls = [
        ...(r.images || []).map((i) => i.url),
        ...(r.video?.url ? [r.video.url] : []),
        ...(r.videos || []).map((v) => v.url),
        ...(r.audio?.url ? [r.audio.url] : []),
      ].filter(Boolean);
      return { state: 'completed', urls, raw: r };
    }
    if (PENDING.has(r.status)) return { state: 'pending', detail: r.status, urls: [], raw: r };
    return { state: 'failed', detail: r.status, error: r.error || r.status, urls: [], raw: r };
  },
};

// Maps the shared edit options onto a Higgsfield image model's request body.
export function higgsfieldImageInput(o) {
  const input = { prompt: o.prompt };
  if (o.image_urls?.length) input.image_urls = o.image_urls;
  if (o.aspect_ratio) input.aspect_ratio = o.aspect_ratio;
  if (o.resolution) input.resolution = o.model?.includes('soul') ? (o.resolution === '1K' ? '720p' : '1080p') : o.resolution.toLowerCase();
  if (o.seed !== undefined) input.seed = o.seed;
  return input;
}
