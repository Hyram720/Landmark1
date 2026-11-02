// Provider registry plus helpers that turn mixed image inputs into URLs a provider can read.
import { decodeBase64, readLocalFile } from './common.js';
import { higgsfield } from './higgsfield.js';
import { kie } from './kie.js';
import { krea } from './krea.js';

export const PROVIDERS = { krea, higgsfield, kie };
export const PROVIDER_NAMES = Object.keys(PROVIDERS);

export function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown provider "${name}". Use one of: ${PROVIDER_NAMES.join(', ')}.`);
  return p;
}

// Picks who hosts an uploaded file: the target provider when it can, else any configured uploader.
function uploaderFor(target) {
  if (target?.upload && target.configured()) return target;
  for (const p of [krea, higgsfield]) if (p.configured()) return p;
  return null;
}

/**
 * Normalizes image inputs into URLs for `target`.
 * - urls pass through (public URLs, provider asset URLs, or data URIs for Krea)
 * - local paths and base64 are uploaded (Kie has no upload API, so Krea/Higgsfield host them)
 */
export async function resolveImages(target, { urls = [], paths = [], base64 = [], inlineDataUris = false } = {}) {
  const out = [...urls];
  const files = [];
  for (const p of paths) files.push(await readLocalFile(p));
  for (const [i, d] of base64.entries()) files.push(decodeBase64(d, `image-${i + 1}`));
  if (!files.length) return out;

  if (inlineDataUris) {
    for (const f of files) out.push(`data:${f.mimeType};base64,${f.buffer.toString('base64')}`);
    return out;
  }
  const host = uploaderFor(target);
  if (!host) {
    // Krea accepts data URIs directly, so it never needs a host.
    if (target === krea) {
      for (const f of files) out.push(`data:${f.mimeType};base64,${f.buffer.toString('base64')}`);
      return out;
    }
    throw new Error(
      `${target.label} needs public image URLs. Local files and attachments are hosted through Krea or Higgsfield, ` +
        'so set KREA_API_KEY or the Higgsfield keys, or pass public image_urls instead.'
    );
  }
  for (const f of files) out.push(await host.upload(f));
  return out;
}

export function providerStatus() {
  return Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.name, { label: p.label, configured: p.configured() }]));
}
