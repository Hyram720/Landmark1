// Kie.ai market API (https://docs.kie.ai). One key, many third-party image/video models.
// POST /api/v1/jobs/createTask {model, input}  ->  GET /api/v1/jobs/recordInfo?taskId=...
import { ProviderError, httpJson } from './common.js';

const API = () => (process.env.KIE_API_BASE || 'https://api.kie.ai').replace(/\/$/, '');

// Model ids confirmed in the Kie docs (2026-11-02). Any other market model id works via `model` + raw `input`.
export const KIE_MODELS = {
  'nano-banana-pro': { kind: 'image', note: 'Google Nano Banana Pro: prompt, image_input[] (up to 8), aspect_ratio, resolution 1K/2K/4K, output_format.' },
  'google/nano-banana': { kind: 'image', note: 'Google Nano Banana text-to-image: prompt, image_size (aspect ratio).' },
};
export const KIE_DEFAULT_IMAGE = 'nano-banana-pro';

function auth() {
  const k = process.env.KIE_API_KEY;
  if (!k) throw new ProviderError('kie', 'KIE_API_KEY is not set. Create a key at https://kie.ai/api-key.', 401);
  return { Authorization: `Bearer ${k}` };
}

function parseResult(resultJson) {
  if (!resultJson) return [];
  let r = resultJson;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r);
    } catch {
      return [];
    }
  }
  return [...(r.resultUrls || []), ...(r.resultImageUrls || []), ...(r.videoUrls || [])].filter(Boolean);
}

export const kie = {
  name: 'kie',
  label: 'Kie.ai',
  configured: () => Boolean(process.env.KIE_API_KEY),
  upload: null, // Kie needs public URLs; the server hosts local files through Krea or Higgsfield instead.

  async submit({ model, input, callBackUrl }) {
    if (!model) throw new ProviderError('kie', 'model is required, e.g. "nano-banana-pro".');
    const out = await httpJson('kie', `${API()}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, ...(callBackUrl ? { callBackUrl } : {}) }),
    });
    if (out.code && out.code !== 200) throw new ProviderError('kie', `${out.code} ${out.msg || ''}`.trim(), out.code, out);
    const id = out.data?.taskId;
    if (!id) throw new ProviderError('kie', `no taskId in response: ${JSON.stringify(out)}`);
    return id;
  },

  async status(id) {
    const out = await httpJson('kie', `${API()}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(id)}`, { headers: auth(), timeoutMs: 30_000 });
    if (out.code && out.code !== 200) throw new ProviderError('kie', `${out.code} ${out.msg || ''}`.trim(), out.code, out);
    const d = out.data || {};
    if (d.state === 'success') return { state: 'completed', urls: parseResult(d.resultJson), raw: d };
    if (d.state === 'fail') return { state: 'failed', detail: 'fail', error: d.failMsg || d.failCode || 'failed', urls: [], raw: d };
    return { state: 'pending', detail: d.state, urls: [], raw: d };
  },
};

export function kieImageInput(o) {
  const model = o.model || KIE_DEFAULT_IMAGE;
  if (model === 'google/nano-banana') {
    return { prompt: o.prompt, ...(o.aspect_ratio ? { image_size: o.aspect_ratio } : {}) };
  }
  // nano-banana-pro shape; also the common shape for many Kie image models.
  const input = { prompt: o.prompt, image_input: o.image_urls || [], output_format: 'png' };
  if (o.aspect_ratio) input.aspect_ratio = o.aspect_ratio;
  if (o.resolution) input.resolution = o.resolution;
  return input;
}
