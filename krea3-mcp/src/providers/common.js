// Shared helpers for every provider: HTTP, file reading, polling, downloads.
import fs from 'node:fs/promises';
import path from 'node:path';

export const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};
const EXT = Object.fromEntries(Object.entries(MIME).map(([e, m]) => [m, e]));

export class ProviderError extends Error {
  constructor(provider, message, status, details) {
    super(`${provider}: ${message}`);
    this.status = status;
    this.details = details;
  }
}

export async function httpJson(provider, url, { method = 'GET', headers = {}, body, timeoutMs = 60_000 } = {}) {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json.error || json.message || json.msg || json.detail || text || res.statusText;
    const details = json.details ? ` ${JSON.stringify(json.details)}` : '';
    throw new ProviderError(provider, `HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${details}`, res.status, json);
  }
  return json;
}

export async function readLocalFile(filePath) {
  const abs = path.resolve(filePath.replace(/^~(?=\/|$)/, process.env.HOME || '~'));
  const buffer = await fs.readFile(abs);
  return { buffer, filename: path.basename(abs), mimeType: MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' };
}

export function decodeBase64(data, filename = 'image.png') {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
  const mimeType = m ? m[1] : MIME[path.extname(filename).toLowerCase()] || 'image/png';
  const buffer = Buffer.from(m ? m[2] : data, 'base64');
  if (!buffer.length) throw new Error('The base64 data is empty.');
  return { buffer, filename: EXT[mimeType] && !path.extname(filename) ? filename + EXT[mimeType] : filename, mimeType };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls provider.status(id) until it settles. Returns { state, urls, raw } — state stays "pending" on timeout.
export async function waitFor(provider, id, { timeoutMs = 300_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let delay = intervalMs;
  for (;;) {
    const st = await provider.status(id);
    if (st.state !== 'pending') return st;
    if (Date.now() + delay > deadline) return st;
    await sleep(delay);
    delay = Math.min(delay * 1.25, 8_000);
  }
}

// Downloads a result so it can be shown inline. Returns null when too big or not an image.
export async function fetchInline(url, maxBytes = 4_500_000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const mimeType = (res.headers.get('content-type') || '').split(';')[0];
    if (!mimeType.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    return { data: buf.toString('base64'), mimeType };
  } catch {
    return null;
  }
}

// Saves results into a local folder (stdio mode only). Returns the saved paths.
export async function saveAll(urls, dir, prefix = 'krea3') {
  const abs = path.resolve(dir.replace(/^~(?=\/|$)/, process.env.HOME || '~'));
  await fs.mkdir(abs, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const saved = [];
  for (const [i, url] of urls.entries()) {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
    const mime = (res.headers.get('content-type') || '').split(';')[0];
    const ext = EXT[mime] || path.extname(new URL(url).pathname) || '.png';
    const file = path.join(abs, `${prefix}-${stamp}-${i + 1}${ext}`);
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    saved.push(file);
  }
  return saved;
}
