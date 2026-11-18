// Final CROA and E-SIGN texts. Served as written, with the HTML comment already removed.
// Signing is refused while any document still has an unfilled owner bracket.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.resolve(new URL('../legal/', import.meta.url).pathname);

function read(name) {
  return fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, '');
}

export function documentBlocksSigning(text) {
  const s = String(text || '');
  if (/PLACEHOLDER/i.test(s)) return true;
  if (/PENDING COMPLIANCE REVIEW/.test(s)) return true;
  if (/\[[^\]]+\]/.test(s)) return true;
  return false;
}

export function enrollmentBlocksSigning(docs) {
  const set = docs || {};
  return ['disclosure', 'contract', 'cancellation', 'esign'].some(key => documentBlocksSigning(set[key]));
}

export function croaSetIsPlaceholder(docs) {
  return enrollmentBlocksSigning(docs);
}

let cache = null;
export function croaDocs() {
  if (!cache) {
    cache = {
      disclosure: read('croa-disclosure-1679c.md'),
      contract: read('croa-contract-1679d.md'),
      cancellation: read('croa-cancellation-1679e.md'),
      esign: read('esign-consent-7001c.md')
    };
  }
  return cache;
}

export function croaPlaceholderDocs() {
  return croaDocs();
}

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}
