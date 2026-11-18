// Placeholder CROA documents for compliance review. Served to self-signup
// clients as separate disclosure, contract, and cancellation papers.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(new URL('../legal/', import.meta.url).pathname);

function read(name) {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

let cache = null;
export function croaPlaceholderDocs() {
  if (!cache) {
    cache = {
      disclosure: read('PLACEHOLDER-croa-disclosure.md'),
      contract: read('PLACEHOLDER-croa-contract.md'),
      cancellation: read('PLACEHOLDER-croa-cancellation.md')
    };
  }
  return cache;
}
