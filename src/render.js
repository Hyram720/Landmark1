// Server-side render of the static homepage and /offer: puts the banner (with the real Christmas
// cutoff and launch-offer end date), prices, gallery, before/after pairs, support line and footer
// links into the HTML, so crawlers and AI tools that don't run JavaScript see them. The browser
// re-renders the same sections with the same builders from public/site.js.
import fs from 'node:fs';
import path from 'node:path';
import { bannerHtml, beforeAfterHtml, galleryHtml, pricingHtml, supportHtml, footerHtml, heroPick, heroAlt } from '../public/site.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Fill <tag id="X" ...>...</tag> (first, non-nested match) with html.
function fill(html, id, inner) {
  const re = new RegExp(`(<(div|p|footer)[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</\\2>)`);
  return html.replace(re, (_, open, __, close) => `${open}${inner}${close}`);
}
const unhide = (html, id) => html.replace(new RegExp(`(\\bid="${id}"[^>]*?) hidden`), '$1');

// FAQPage JSON-LD built from the page's own visible <details> FAQ, so markup always matches the text.
function faqLd(html) {
  const items = [...html.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(([, q, a]) => ({
    '@type': 'Question', name: strip(q), acceptedAnswer: { '@type': 'Answer', text: strip(a) },
  }));
  return items.length ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items })}</script>\n</head>` : '</head>';
}

const cache = new Map();
export function renderStatic(publicDir, file, { catalog, showcase }) {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(publicDir, file), 'utf8'));
  let html = cache.get(file);
  html = fill(html, 'banner', bannerHtml(catalog.launch));
  html = fill(html, 'pricing', pricingHtml(catalog));
  if (catalog.supportEmail) html = fill(html, 'support', supportHtml(catalog.supportEmail));
  if (/id="footer"/.test(html)) html = fill(html, 'footer', footerHtml());
  if (showcase.length) {
    const hero = heroPick(showcase);
    html = html.replace(/<img id="heroImg" alt=""/, `<img id="heroImg" src="/showcase/${hero.key}.webp?w=900" alt="${esc(heroAlt(hero))}"`);
    html = unhide(html, 'heroFrame');
    const ba = beforeAfterHtml(showcase);
    if (ba) html = unhide(fill(html, 'beforeAfter', ba), 'beforeAfterSection');
    const gal = galleryHtml(showcase);
    if (gal) html = unhide(fill(html, 'gallery', gal), 'gallerySection');
  }
  if (catalog.promoVideo) html = unhide(html, 'videoSection');
  if (file === 'index.html') html = html.replace('</head>', faqLd(html));
  return html;
}
