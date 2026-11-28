// Makes lighter WebP copies of the mockup PNGs used on /shop (about 2 MB PNG -> well under 150 KB WebP).
// Originals stay in place. Run: node scripts/optimize-mockups.js  (only needed when mockups change).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = path.join(import.meta.dirname, '..', 'public', 'tshirts');
const used = [...fs.readFileSync(path.join(dir, '..', 'shop.html'), 'utf8').matchAll(/\/tshirts\/([\w-]+)\.webp/g)].map((m) => m[1]);
let before = 0, after = 0;
for (const name of new Set(used)) {
  const png = path.join(dir, `${name}.png`);
  if (!fs.existsSync(png)) { console.error('missing source', png); process.exitCode = 1; continue; }
  const out = path.join(dir, `${name}.webp`);
  await sharp(png).resize({ width: 800, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, effort: 5 }).toFile(out);
  before += fs.statSync(png).size; after += fs.statSync(out).size;
  console.log(name, `${(fs.statSync(png).size / 1e6).toFixed(2)} MB -> ${(fs.statSync(out).size / 1e3).toFixed(0)} KB`);
}
console.log(`total ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(2)} MB`);
