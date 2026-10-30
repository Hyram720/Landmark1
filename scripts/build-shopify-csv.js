// Builds shopify/products.csv (Shopify's product import format) from shopify/catalog.json.
// Usage: node scripts/build-shopify-csv.js [--skip handle1,handle2]
//   --skip  leave out products you will publish from Printify instead (Printify can't link
//           to products that already exist in Shopify, so importing them here would duplicate).
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../shopify/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('catalog.json', root), 'utf8'));

const skipArg = process.argv.indexOf('--skip');
const skip = new Set(skipArg > -1 ? (process.argv[skipArg + 1] || '').split(',').filter(Boolean) : []);

const COLUMNS = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Policy',
  'Variant Fulfillment Service', 'Variant Price', 'Variant Requires Shipping', 'Variant Taxable',
  'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card', 'SEO Title', 'SEO Description',
  'Variant Weight Unit', 'Status',
];

// Approximate shipping weights per garment, in grams (adjust to your Printful/Printify specs).
const GRAMS = { 'T-Shirt': 300, Hoodie: 850, 'Tracksuit Set': 1600, Hat: 150, Tote: 350 };

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const html = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (s) => s.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => {
  if (s.length <= n) return s;
  let out = s.slice(0, s.lastIndexOf(' ', n));
  if (out.split('(').length > out.split(')').length) out = out.slice(0, out.lastIndexOf('('));
  return out.replace(/[\s,:;/&-]+$/, '');
};
const skuBase = (handle) => 'SCD-' + handle.split('-').slice(0, 4).map((w) => w.slice(0, 4)).join('-').toUpperCase();

function bodyHtml(p) {
  const parts = [];
  if (p.eyebrow) parts.push(`<p class="eyebrow">${html(p.eyebrow)}</p>`);
  if (p.headline) parts.push(`<p><strong>${html(p.headline)}</strong></p>`);
  parts.push(`<p>${html(p.description)}</p>`);
  const specs = [];
  if (p.color) specs.push(`Garment colour: ${html(p.color)}`);
  const gsm = p.tags.find((t) => /GSM$/.test(t));
  if (gsm) specs.push(`${gsm} heavyweight cotton`);
  specs.push('100% original artwork, zero brand logo');
  specs.push('Made to order. Printed after you check out.');
  parts.push(`<ul>${specs.map((s) => `<li>${s}</li>`).join('')}</ul>`);
  return parts.join('');
}

function row(values) {
  return COLUMNS.map((c) => esc(values[c])).join(',');
}

const lines = [COLUMNS.join(',')];

for (const p of catalog.products) {
  if (skip.has(p.handle)) continue;
  const sizes = catalog.sizes[p.sizeSet || 'apparel'];
  const tags = [...p.tags, ...p.collections, p.color && `color-${p.color}`].filter(Boolean).join(', ');
  const seoTitle = clip(plain(p.title), 70);
  const seoDesc = clip(plain(`${p.headline ? p.headline + ' ' : ''}${p.description}`), 320);
  sizes.forEach((size, i) => {
    const first = i === 0;
    lines.push(row({
      Handle: p.handle,
      Title: first ? p.title : '',
      'Body (HTML)': first ? bodyHtml(p) : '',
      Vendor: first ? catalog.vendor : '',
      Type: first ? p.type : '',
      Tags: first ? tags : '',
      Published: first ? 'TRUE' : '',
      'Option1 Name': first ? 'Size' : '',
      'Option1 Value': size,
      'Variant SKU': `${skuBase(p.handle)}-${size.replace(/\s+/g, '')}`,
      'Variant Grams': GRAMS[p.type] || 300,
      'Variant Inventory Tracker': '',
      'Variant Inventory Policy': 'continue',
      'Variant Fulfillment Service': 'manual',
      'Variant Price': p.price.toFixed(2),
      'Variant Requires Shipping': 'TRUE',
      'Variant Taxable': 'TRUE',
      'Image Src': p.images[i] || '',
      'Image Position': p.images[i] ? i + 1 : '',
      'Image Alt Text': p.images[i] ? plain(p.title) : '',
      'Gift Card': first ? 'FALSE' : '',
      'SEO Title': first ? seoTitle : '',
      'SEO Description': first ? seoDesc : '',
      'Variant Weight Unit': 'g',
      Status: first ? 'active' : '',
    }));
  });
  // Extra images beyond the number of variants get image-only rows.
  p.images.slice(sizes.length).forEach((src, j) => {
    lines.push(row({ Handle: p.handle, 'Image Src': src, 'Image Position': sizes.length + j + 1, 'Image Alt Text': plain(p.title) }));
  });
}

// The upload-your-own-art product used by the Custom Studio page (product template "studio").
const studio = catalog.customStudio;
if (!skip.has(studio.handle)) {
  let first = true;
  for (const style of studio.styles) {
    const isTote = /Tote/.test(style.name);
    for (const color of studio.colors) {
      for (const size of isTote ? ['One Size'] : catalog.sizes.apparel) {
        lines.push(row({
          Handle: studio.handle,
          Title: first ? studio.title : '',
          'Body (HTML)': first
            ? '<p>Upload your own PNG, SVG, JPG or WebP artwork, or pick a graphic from the Studio Library, and we print it on a heavyweight garment. 300 DPI at a 10&quot; x 12&quot; chest print is ideal.</p>'
            : '',
          Vendor: first ? catalog.vendor : '',
          Type: first ? 'Custom Apparel' : '',
          Tags: first ? 'Customizable, Custom Studio' : '',
          Published: first ? 'TRUE' : '',
          'Option1 Name': first ? 'Style' : '',
          'Option1 Value': style.name,
          'Option2 Name': first ? 'Color' : '',
          'Option2 Value': color,
          'Option3 Name': first ? 'Size' : '',
          'Option3 Value': size,
          'Variant SKU': `SCD-STUDIO-${style.name.split(' ')[0].replace(/\W/g, '')}-${color.replace(/\W/g, '').slice(0, 6)}-${size.replace(/\s+/g, '')}`.toUpperCase(),
          'Variant Grams': isTote ? GRAMS.Tote : /Hoodie/.test(style.name) ? GRAMS.Hoodie : GRAMS['T-Shirt'],
          'Variant Inventory Policy': 'continue',
          'Variant Fulfillment Service': 'manual',
          'Variant Price': style.price.toFixed(2),
          'Variant Requires Shipping': 'TRUE',
          'Variant Taxable': 'TRUE',
          'Image Src': first ? 'https://suncustomdesigns.com/assets/products/exec-v2-preview-generational-blueprint.jpg' : '',
          'Image Position': first ? 1 : '',
          'Image Alt Text': first ? 'Custom Studio garment preview' : '',
          'Gift Card': first ? 'FALSE' : '',
          'SEO Title': first ? 'Custom Studio: Print Your Own Art on Heavyweight Apparel' : '',
          'SEO Description': first ? 'Upload your own artwork or choose from our 300-DPI Studio Library and print it on a 260 GSM tee, 450 GSM hoodie, or canvas tote.' : '',
          'Variant Weight Unit': 'g',
          Status: first ? 'active' : '',
        }));
        first = false;
      }
    }
  }
}

writeFileSync(new URL('products.csv', root), lines.join('\n') + '\n');
console.log(`Wrote shopify/products.csv (${lines.length - 1} rows${skip.size ? `, skipped: ${[...skip].join(', ')}` : ''})`);
