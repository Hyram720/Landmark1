// Qwen/Qwen-Image-Edit-2511 (Apache-2.0). Two backends:
//   hf   — Hugging Face Inference Providers router, or a dedicated Inference Endpoint URL (HF_TOKEN)
//   http — any self-hosted server that speaks the JSON contract below (QWEN_ENDPOINT_URL)
// This module does not read OPENAI_API_KEY.
import fs from 'node:fs';
import config from '../config.js';

// Live providers for Qwen/Qwen-Image-Edit-2511 from
// GET https://huggingface.co/api/models/Qwen/Qwen-Image-Edit-2511?expand[]=inferenceProviderMapping
// on 17 Nov 2026. Replicate and hf-inference were not in that mapping.
// fal-ai's mapped id is fal-ai/qwen-image-edit-plus. fal's own page for that id describes it as
// Qwen-Image-Edit-2509, so the default HF provider is wavespeed, whose mapped id is the 2511 model.
// Router URLs follow huggingface_hub's fal and wavespeed task helpers.
export const HF_LIVE_PROVIDERS = {
  'fal-ai': {
    providerId: 'fal-ai/qwen-image-edit-plus',
    url: 'https://router.huggingface.co/fal-ai/fal-ai/qwen-image-edit-plus?_subdomain=queue',
  },
  wavespeed: {
    providerId: 'wavespeed-ai/qwen-image/edit-2511',
    url: 'https://router.huggingface.co/wavespeed/api/v3/wavespeed-ai/qwen-image/edit-2511',
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function qwenTarget() {
  const backend = config.image.qwenBackend;
  if (backend === 'http') {
    return { kind: 'http', url: config.image.qwenEndpointUrl, token: config.image.qwenEndpointToken };
  }
  if (backend !== 'hf') throw new Error(`unknown QWEN_BACKEND ${backend}`);
  const custom = config.image.qwenHfUrl;
  const token = config.image.hfToken;
  if (custom && !custom.includes('router.huggingface.co')) return { kind: 'endpoint', url: custom, token };
  const provider = config.image.qwenHfProvider;
  const known = HF_LIVE_PROVIDERS[provider];
  if (!known) throw new Error(`QWEN_HF_PROVIDER ${provider} is not a live Hugging Face provider for Qwen/Qwen-Image-Edit-2511`);
  return { kind: provider, url: custom || known.url, token, providerId: known.providerId };
}

export function qwenConfigProblem() {
  try {
    const target = qwenTarget();
    if (!target.url) return 'not configured';
    if (target.kind !== 'http' && !target.token) return 'not configured';
    return '';
  } catch (err) {
    return `not configured (${err.message})`;
  }
}

function decodeImageString(value) {
  const text = String(value || '');
  const payload = text.includes(',') && text.startsWith('data:') ? text.split(',')[1] : text;
  return Buffer.from(payload, 'base64');
}

async function errorFrom(res, text) {
  let detail = text.slice(0, 300);
  try {
    const json = JSON.parse(text);
    detail = json.error?.message || json.error?.code || json.error || json.message || json.detail || detail;
  } catch {
    // body was not JSON
  }
  const err = new Error(`Qwen: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  err.status = res.status;
  return err;
}

async function readJson(res) {
  const text = await res.text();
  if (!res.ok) throw await errorFrom(res, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Qwen: response was not an image');
  }
}

// Image bytes, a base64 JSON field, or a JSON object the caller still has to poll.
async function parsePayload(res) {
  const type = res.headers.get('content-type') || '';
  if (type.startsWith('image/')) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`Qwen: HTTP ${res.status}`);
    return { kind: 'image', buf };
  }
  const json = await readJson(res);
  if (typeof json?.image === 'string') return { kind: 'image', buf: decodeImageString(json.image) };
  if (typeof json?.b64_json === 'string') return { kind: 'image', buf: Buffer.from(json.b64_json, 'base64') };
  return { kind: 'json', json };
}

async function fetchRemoteImage(url, fetchImpl) {
  if (!url) throw new Error('Qwen: response did not include an image');
  if (url.startsWith('data:')) return decodeImageString(url);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Qwen: image download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// Mirrors huggingface_hub FalAIQueueTask: poll status, then the result, then the CDN url.
// The CDN fetch is unauthenticated so the HF token is not sent to the image host.
async function pollFal(startUrl, first, headers, fetchImpl) {
  const start = new URL(startUrl);
  const base = `${start.origin}${start.hostname === 'router.huggingface.co' ? '/fal-ai' : ''}`;
  const modelPath = new URL(first.response_url).pathname;
  const statusUrl = `${base}${modelPath}/status${start.search}`;
  const resultUrl = `${base}${modelPath}${start.search}`;
  let status = first.status;
  const deadline = Date.now() + 180_000;
  while (status !== 'COMPLETED') {
    if (Date.now() > deadline) throw new Error('Qwen: fal edit timed out');
    await sleep(500);
    const body = await readJson(await fetchImpl(statusUrl, { headers, signal: AbortSignal.timeout(20_000) }));
    status = body.status;
    if (status === 'FAILED' || body.error) throw new Error(`Qwen: ${body.error || 'fal edit failed'}`);
  }
  const result = await readJson(await fetchImpl(resultUrl, { headers, signal: AbortSignal.timeout(60_000) }));
  return fetchRemoteImage(result.images?.[0]?.url, fetchImpl);
}

async function pollWavespeed(startUrl, first, headers, fetchImpl) {
  const data = first.data || first;
  const resultPath = data.urls?.get;
  if (!resultPath) throw new Error('Qwen: wavespeed response had no result URL');
  const start = new URL(startUrl);
  const base = start.hostname === 'router.huggingface.co' ? `${start.origin}/wavespeed` : start.origin;
  const resultUrl = `${base}${new URL(resultPath).pathname}`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await sleep(500);
    const body = await readJson(await fetchImpl(resultUrl, { headers, signal: AbortSignal.timeout(20_000) }));
    const task = body.data || body;
    if (task.status === 'completed') return fetchRemoteImage(task.outputs?.[0], fetchImpl);
    if (task.status === 'failed') throw new Error(`Qwen: ${task.error || 'wavespeed edit failed'}`);
    if (task.status !== 'processing' && task.status !== 'created') throw new Error(`Qwen: wavespeed status ${task.status || 'unknown'}`);
  }
  throw new Error('Qwen: wavespeed edit timed out');
}

async function postJson(url, headers, body, fetchImpl) {
  return fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
}

export async function editWithQwen({ photo, photoPath, mimeType, prompt, variant = 1, fetchImpl = fetch }) {
  const bytes = photo || fs.readFileSync(photoPath);
  const target = qwenTarget();
  if (!target.url) throw new Error('Qwen: endpoint URL is not configured');
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${bytes.toString('base64')}`;

  if (target.kind === 'http') {
    const headers = { 'Content-Type': 'application/json' };
    if (target.token) headers.Authorization = `Bearer ${target.token}`;
    const payload = await parsePayload(await postJson(target.url, headers, {
      model: config.image.qwenModel,
      prompt,
      image: bytes.toString('base64'),
      mime: mimeType || 'image/jpeg',
      seed: variant,
    }, fetchImpl));
    if (payload.kind === 'image') return payload.buf;
    const imageUrl = payload.json.url || payload.json.images?.[0]?.url || payload.json.outputs?.[0];
    return fetchRemoteImage(imageUrl, fetchImpl);
  }

  if (!target.token) throw new Error('Qwen: HF_TOKEN is not configured');
  const headers = { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' };

  if (target.kind === 'endpoint') {
    const payload = await parsePayload(await postJson(target.url, headers, {
      inputs: bytes.toString('base64'),
      parameters: { prompt, seed: variant },
    }, fetchImpl));
    if (payload.kind === 'image') return payload.buf;
    const imageUrl = payload.json.url || payload.json.images?.[0]?.url;
    return fetchRemoteImage(imageUrl, fetchImpl);
  }

  if (target.kind === 'fal-ai') {
    const payload = await parsePayload(await postJson(target.url, headers, {
      prompt,
      image_url: dataUrl,
      image_urls: [dataUrl],
      num_images: 1,
      output_format: 'png',
      seed: variant,
    }, fetchImpl));
    if (payload.kind === 'image') return payload.buf;
    const json = payload.json;
    if (json.request_id || json.response_url) return pollFal(target.url, json, headers, fetchImpl);
    return fetchRemoteImage(json.images?.[0]?.url, fetchImpl);
  }

  const payload = await parsePayload(await postJson(target.url, headers, {
    prompt,
    image: dataUrl,
    images: [dataUrl],
    seed: variant,
  }, fetchImpl));
  if (payload.kind === 'image') return payload.buf;
  if (payload.json.data?.urls?.get || payload.json.urls?.get) return pollWavespeed(target.url, payload.json, headers, fetchImpl);
  const done = payload.json.data?.status === 'completed' ? payload.json.data : payload.json;
  return fetchRemoteImage(done.outputs?.[0] || done.images?.[0]?.url || done.url, fetchImpl);
}
