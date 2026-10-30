// Downloads every product photo, Studio Library artwork and brand file referenced by
// shopify/catalog.json into shopify/site-assets/. Run this BEFORE pointing the domain at Shopify:
// after the switch, suncustomdesigns.com/assets/... stops serving these files.
// Usage: node scripts/download-site-assets.js
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../shopify/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('catalog.json', root), 'utf8'));
const out = new URL('site-assets/', root);

const BRAND = [
  'https://suncustomdesigns.com/assets/brand/scd-header-horizontal-dark.svg',
  'https://suncustomdesigns.com/assets/brand/scd-favicon-512.png',
  'https://suncustomdesigns.com/assets/brand/scd-neck-label-3x3-300dpi.png',
  'https://suncustomdesigns.com/assets/brand/scd-neck-label-3x3-300dpi.svg',
  'https://suncustomdesigns.com/assets/brand/scd-pack-in-card-4x6-300dpi.png',
  'https://suncustomdesigns.com/assets/brand/scd-pack-in-card-4x6-300dpi.svg',
];

const groups = {
  products: catalog.products.flatMap((p) => p.images),
  'studio-library': catalog.studioLibrary.map((a) => a.image),
  brand: BRAND,
};

let ok = 0;
const failed = [];
for (const [dir, urls] of Object.entries(groups)) {
  mkdirSync(new URL(`${dir}/`, out), { recursive: true });
  for (const url of new Set(urls)) {
    const file = new URL(`${dir}/${url.split('/').pop().split('?')[0]}`, out);
    if (existsSync(file)) { ok++; continue; }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      ok++;
      console.log(`saved ${dir}/${file.pathname.split('/').pop()}`);
    } catch (err) {
      failed.push(`${url} (${err.message})`);
    }
  }
}
console.log(`\n${ok} files in shopify/site-assets/`);
if (failed.length) {
  console.log(`${failed.length} failed:\n  ${failed.join('\n  ')}`);
  process.exitCode = 1;
}
