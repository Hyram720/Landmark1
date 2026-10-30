// Builds the re-engineered Sun Custom Designs storefront into shopify/storefront/dist/.
// Our own static implementation of a Shopify-style structure (products, collections, theme,
// Design Studio template). It does not use Shopify's platform or APIs.
//
// Data:   shopify/products.csv (product data source), shopify/catalog.json (collection titles,
//         Studio Library), shopify/storefront/providers.json (products listed under "printify"
//         are left out), shopify/storefront/config.json (page copy).
// Assets: theme.css, theme.js and studio.js are reused from shopify/theme/assets/; cart.js and
//         storefront.css are storefront-only. Photos come from shopify/site-assets/ when
//         `npm run shopify:assets` has downloaded them, else from their original URLs.
// Usage:  node scripts/build-storefront.js
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const shop = new URL('../shopify/', import.meta.url);
const src = new URL('storefront/', shop);
const out = new URL('storefront/dist/', shop);
const read = (rel, base = shop) => readFileSync(new URL(rel, base), 'utf8');

const config = JSON.parse(read('config.json', src));
const providers = JSON.parse(read('providers.json', src));
const catalog = JSON.parse(read('catalog.json'));
const excluded = new Set(providers.printify || []);

// ---------- CSV → products ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const products = [];
const byHandle = new Map();
for (const r of parseCsv(read('products.csv'))) {
  let p = byHandle.get(r.Handle);
  if (!p) {
    p = {
      handle: r.Handle, title: r.Title, body: r['Body (HTML)'], vendor: r.Vendor, type: r.Type,
      tags: r.Tags.split(',').map((t) => t.trim()).filter(Boolean),
      optionNames: [r['Option1 Name'], r['Option2 Name'], r['Option3 Name']].filter(Boolean),
      seoTitle: r['SEO Title'], seoDescription: r['SEO Description'], variants: [], images: [],
    };
    byHandle.set(r.Handle, p);
    products.push(p);
  }
  if (r['Image Src']) p.images[Number(r['Image Position'] || p.images.length + 1) - 1] = { src: r['Image Src'], alt: r['Image Alt Text'] };
  if (r['Option1 Value']) {
    const options = [r['Option1 Value'], r['Option2 Value'], r['Option3 Value']].slice(0, p.optionNames.length);
    p.variants.push({
      id: `${p.handle}--${p.variants.length + 1}`, sku: r['Variant SKU'], options, title: options.join(' / '),
      price: Math.round(Number(r['Variant Price']) * 100), available: true, featured_image: null,
    });
  }
}
for (const p of products) p.images = p.images.filter(Boolean);
const live = products.filter((p) => !excluded.has(p.handle));
const liveByHandle = new Map(live.map((p) => [p.handle, p]));
const studioHandle = config.studio.handle;

const collections = catalog.collections.map((c) => ({
  ...c, products: live.filter((p) => p.tags.includes(c.tag)),
}));

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const minPrice = (p) => Math.min(...p.variants.map((v) => v.price));
const priceVaries = (p) => new Set(p.variants.map((v) => v.price)).size > 1;

// Use a downloaded copy from shopify/site-assets/ when one exists.
const copiedImages = new Map();
function imageUrl(url, base) {
  if (!url) return '';
  const name = url.split('?')[0].split('/').pop();
  for (const dir of ['products', 'studio-library', 'brand']) {
    const local = new URL(`site-assets/${dir}/${name}`, shop);
    if (existsSync(local)) {
      copiedImages.set(name, local);
      return `${base}assets/images/${name}`;
    }
  }
  return url;
}

function layout({ title, description, base, body, scripts = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,500&family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>:root{--bg:#0D0F12;--surface:#16191E;--line:#2A2F37;--text:#FAF8F5;--muted:#A39B8F;--accent:#EA580C;--gold:#F59E0B;--radius:3px}</style>
<link rel="stylesheet" href="${base}assets/theme.css">
<link rel="stylesheet" href="${base}assets/storefront.css">
<script src="${base}assets/theme.js" defer></script>
<script src="${base}assets/cart.js" defer></script>
${scripts.map((s) => `<script src="${base}assets/${s}" defer></script>`).join('\n')}
</head>
<body>
<a class="skip-link" href="#MainContent">Skip to content</a>
<div class="announcement">${esc(config.announcement)}</div>
<header class="site-header">
  <div class="wrap site-header__inner" style="position:relative">
    <a href="${base}" class="site-header__logo">${esc(config.shopName)}</a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="SiteNav" data-menu-toggle>Menu</button>
    <ul class="site-nav" id="SiteNav">
      <li><a href="${base}collections/">Shop all</a></li>
      ${collections.filter((c) => c.products.length).slice(0, 3).map((c) => `<li><a href="${base}collections/${c.handle}/">${esc(c.title)}</a></li>`).join('')}
      <li><a href="${base}products/${studioHandle}/">Design Studio</a></li>
    </ul>
    <div class="site-header__icons">
      <a href="${base}cart/">Bag<span class="cart-count" data-cart-count>0</span></a>
    </div>
  </div>
</header>
<main id="MainContent" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="site-footer__grid">
      <div>
        <h4>${esc(config.shopName)}</h4>
        <p>${esc(config.footerAbout)}</p>
        <p><a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a></p>
      </div>
      <div>
        <h4>Shop</h4>
        <ul>${collections.filter((c) => c.products.length).map((c) => `<li><a href="${base}collections/${c.handle}/">${esc(c.title)}</a></li>`).join('')}</ul>
      </div>
      <div>
        <h4>Studio</h4>
        <ul><li><a href="${base}products/${studioHandle}/">Design Studio</a></li><li><a href="${base}cart/">Your bag</a></li></ul>
      </div>
    </div>
    <div class="site-footer__bottom"><span>&copy; ${new Date().getFullYear()} ${esc(config.shopName)}.</span></div>
  </div>
</footer>
</body>
</html>
`;
}

function card(p, base) {
  const gsm = p.tags.find((t) => /GSM$/.test(t));
  const img = p.images[0];
  return `<article class="card">
  <a class="card__media" href="${base}products/${p.handle}/" tabindex="-1" aria-hidden="true">${img ? `<img src="${esc(imageUrl(img.src, base))}" alt="${esc(img.alt || p.title)}" width="800" height="1000" loading="lazy">` : ''}</a>
  <div class="card__body">
    <span class="card__eyebrow">${esc(gsm ? `${gsm} · ${p.type}` : p.type)}</span>
    <h3 class="card__title"><a href="${base}products/${p.handle}/">${esc(p.title)}</a></h3>
    <div class="card__footer">
      <span class="price">${priceVaries(p) ? 'From ' : ''}${money(minPrice(p))}</span>
      <a class="btn btn--small" href="${base}products/${p.handle}/">Shop</a>
    </div>
  </div>
</article>`;
}

function optionPickers(p, prefix) {
  return p.optionNames.map((name, i) => {
    const values = [...new Set(p.variants.map((v) => v.options[i]))];
    return `<fieldset class="option">
  <legend>${esc(name)}</legend>
  <div class="swatches">${values.map((v, j) => `<input type="radio" id="${prefix}-${i}-${j}" name="option${i + 1}" value="${esc(v)}" data-option="${i}" data-option-name="${esc(name.toLowerCase())}"${j === 0 ? ' checked' : ''}><label for="${prefix}-${i}-${j}">${esc(v)}</label>`).join('')}</div>
</fieldset>`;
  }).join('\n');
}

const productData = (p, base) => `<script type="application/json" data-product-json>${JSON.stringify(p.variants).replace(/</g, '\\u003c')}</script>
<script type="application/json" data-product-meta>${JSON.stringify({ handle: p.handle, title: p.title, image: p.images[0] ? imageUrl(p.images[0].src, base) : '' }).replace(/</g, '\\u003c')}</script>`;

// ---------- pages ----------
const pages = new Map();

function homePage() {
  const base = '';
  const hero = liveByHandle.get(config.hero.productHandle);
  const shown = collections.filter((c) => c.products.length);
  const body = `
<section class="hero">
  <div class="wrap hero__grid">
    <div>
      <p class="hero__kicker">${esc(config.hero.kicker)}</p>
      <h1>${config.hero.headingHtml}</h1>
      <div class="hero__text"><p>${esc(config.hero.text)}</p></div>
      <div class="hero__chips">${config.hero.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <div class="hero__ctas">
        <a class="btn" href="#catalog">Shop Luxury Bootleg Drops</a>
        <a class="btn btn--ghost" href="products/${studioHandle}/">Customize Your Apparel</a>
      </div>
    </div>
    <div class="hero__media">
      ${hero?.images[0] ? `<img src="${esc(imageUrl(hero.images[0].src, base))}" alt="${esc(hero.title)}" width="1200" height="1500">` : ''}
      <p class="hero__caption">${esc(config.hero.caption)}</p>
    </div>
  </div>
</section>
<section class="section" id="catalog">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">${esc(config.catalog.eyebrow)}</p>
      <h2>${esc(config.catalog.heading)}</h2>
      <p>${esc(config.catalog.text)}</p>
    </div>
    <div class="tabs" role="tablist" data-tabs>
      <button class="tab" role="tab" type="button" aria-selected="true" aria-controls="Tab-all">Everything (${live.filter((p) => p.handle !== studioHandle).length})</button>
      ${shown.map((c) => `<button class="tab" role="tab" type="button" aria-selected="false" aria-controls="Tab-${c.handle}">${esc(c.title)} (${c.products.length})</button>`).join('')}
    </div>
    <div class="grid" role="tabpanel" id="Tab-all">${live.filter((p) => p.handle !== studioHandle).map((p) => card(p, base)).join('')}</div>
    ${shown.map((c) => `<div class="grid" role="tabpanel" id="Tab-${c.handle}" hidden>${c.products.map((p) => card(p, base)).join('')}</div>`).join('')}
  </div>
</section>
<section class="section" id="custom-studio">
  <div class="wrap hero__grid">
    <div>
      <p class="eyebrow">${esc(config.studioTeaser.eyebrow)}</p>
      <h2>${config.studioTeaser.headingHtml}</h2>
      <div class="hero__text"><p>${esc(config.studioTeaser.text)}</p></div>
      <div class="hero__ctas" style="margin-top:24px"><a class="btn" href="products/${studioHandle}/">Open the Design Studio</a></div>
    </div>
    <div class="hero__media">${catalog.studioLibrary[0] ? `<img src="${esc(imageUrl(catalog.studioLibrary[4]?.image || catalog.studioLibrary[0].image, base))}" alt="Studio Library artwork" width="1000" height="1200" loading="lazy">` : ''}</div>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">${esc(config.lookbook.eyebrow)}</p><h2>${config.lookbook.headingHtml}</h2></div>
    <div class="lookbook">
      ${config.lookbook.looks.map((l) => liveByHandle.get(l.handle) && { ...l, p: liveByHandle.get(l.handle) }).filter(Boolean).map(({ tag, p }) => `<article class="look">
        ${p.images[0] ? `<img src="${esc(imageUrl(p.images[0].src, base))}" alt="${esc(p.title)}" width="900" height="1125" loading="lazy">` : ''}
        <div class="look__body"><p class="look__tag">${esc(tag)}</p><h3>${esc(p.title)}</h3>
          <div class="row" style="justify-content:space-between"><span class="price">${money(minPrice(p))}</span><a class="btn btn--small" href="products/${p.handle}/">Shop the look</a></div>
        </div></article>`).join('')}
    </div>
  </div>
</section>`;
  pages.set('index.html', layout({ title: `${config.shopName} - Luxury Bootleg Tees, Tracksuits & 300-DPI Design Studio`, description: config.hero.text, base, body }));
}

function collectionPages() {
  const base = '../';
  pages.set('collections/index.html', layout({
    title: `Shop by series - ${config.shopName}`, base,
    body: `<section class="page"><div class="wrap"><div class="section-head"><h1>Shop by series</h1></div><div class="grid">${collections.filter((c) => c.products.length).map((c) => `<article class="card">
      <a class="card__media" href="${c.handle}/">${c.products[0].images[0] ? `<img src="${esc(imageUrl(c.products[0].images[0].src, base))}" alt="" width="800" height="1000" loading="lazy">` : ''}</a>
      <div class="card__body"><span class="card__eyebrow">${c.products.length} pieces</span><h3 class="card__title"><a href="${c.handle}/">${esc(c.title)}</a></h3></div></article>`).join('')}</div></div></section>`,
  }));
  for (const c of collections) {
    if (!c.products.length) continue;
    const b = '../../';
    pages.set(`collections/${c.handle}/index.html`, layout({
      title: `${c.title} - ${config.shopName}`, description: c.description, base: b,
      body: `<section class="page"><div class="wrap"><div class="section-head"><p class="eyebrow">${c.products.length} pieces</p><h1>${esc(c.title)}</h1><div class="rte"><p>${esc(c.description)}</p></div></div><div class="grid">${c.products.map((p) => card(p, b)).join('')}</div></div></section>`,
    }));
  }
}

function productPage(p) {
  const base = '../../';
  const images = p.images.map((i) => ({ ...i, url: imageUrl(i.src, base) }));
  const first = p.variants[0];
  const customizable = p.tags.includes('Customizable');
  const body = `<div class="wrap product" data-product>
  <div class="product__gallery">
    ${images[0] ? `<img src="${esc(images[0].url)}" alt="${esc(images[0].alt || p.title)}" width="1400" height="1750" data-main-image>` : ''}
    ${images.length > 1 ? `<div class="product__thumbs">${images.map((i, n) => `<button type="button" data-thumb="${esc(i.url)}" aria-current="${n === 0}" aria-label="Show image ${n + 1}"><img src="${esc(i.url)}" alt="" width="200" height="250" loading="lazy"></button>`).join('')}</div>` : ''}
  </div>
  <div class="product__info">
    <h1 class="product__title">${esc(p.title)}</h1>
    <div class="product__price" data-price>${money(first.price)}</div>
    <form data-cart-form data-cart-url="${base}cart/">
      <input type="hidden" name="id" value="${esc(first.id)}" data-variant-id>
      ${optionPickers(p, 'Opt')}
      ${customizable ? `<div class="field"><label for="Personalize">${esc(config.personalizeLabel)}</label><input id="Personalize" type="text" maxlength="20" name="properties[${esc(config.personalizeLabel)}]" placeholder="Your custom text (optional)"></div>` : ''}
      <div class="field" style="max-width:120px"><label for="Qty">Quantity</label><input id="Qty" type="number" name="quantity" value="1" min="1"></div>
      <button class="btn btn--block" type="submit" data-add-button>Add to bag</button>
      <p class="note">Made to order. Printed after you check out.</p>
    </form>
    <div class="product__desc rte">${p.body}</div>
  </div>
  ${productData(p, base)}
</div>`;
  pages.set(`products/${p.handle}/index.html`, layout({ title: `${p.seoTitle || p.title} - ${config.shopName}`, description: p.seoDescription, base, body }));
}

function studioPage(p) {
  const base = '../../';
  const first = p.variants[0];
  const library = catalog.studioLibrary;
  const body = `<div class="wrap studio" data-studio>
  <div class="studio__stage">
    <div class="stage" data-stage>
      <div class="stage__garment" data-garment>
        <svg viewBox="0 0 400 420" data-shape="tee" aria-hidden="true"><path d="M140 20 L100 30 L20 85 L55 160 L95 140 L95 400 L305 400 L305 140 L345 160 L380 85 L300 30 L260 20 C250 50 225 62 200 62 C175 62 150 50 140 20 Z" fill="currentColor" stroke="rgba(255,255,255,.08)" stroke-width="2"/></svg>
        <svg viewBox="0 0 400 420" data-shape="hoodie" aria-hidden="true" hidden><path d="M140 50 C140 -5 260 -5 260 50 L305 62 L345 110 L392 345 L348 360 L305 175 L305 400 L95 400 L95 175 L52 360 L8 345 L55 110 L95 62 Z" fill="currentColor" stroke="rgba(255,255,255,.08)" stroke-width="2"/><path d="M155 55 C160 95 240 95 245 55 C240 20 160 20 155 55 Z" fill="rgba(0,0,0,.3)"/><path d="M185 95 L182 150 M215 95 L218 150" stroke="rgba(255,255,255,.25)" stroke-width="3"/><path d="M130 300 L270 300 L285 370 L115 370 Z" fill="rgba(0,0,0,.18)"/></svg>
        <svg viewBox="0 0 400 420" data-shape="tote" aria-hidden="true" hidden><path d="M140 110 C140 30 260 30 260 110" fill="none" stroke="currentColor" stroke-width="14"/><rect x="70" y="110" width="260" height="290" fill="currentColor" stroke="rgba(0,0,0,.2)" stroke-width="2"/></svg>
      </div>
      <div class="stage__print" data-print><img alt="" width="1000" height="1200" data-art hidden></div>
    </div>
    <div class="stage__meta"><span data-art-name>Upload artwork or pick a Studio Library design first.</span><span data-dpi></span></div>
    <div class="row" style="margin-top:12px">
      <button type="button" class="btn btn--ghost btn--small" data-view-toggle>Art-only view</button>
      <button type="button" class="btn btn--ghost btn--small" data-clear>✕ Clear / upload my own art instead</button>
    </div>
  </div>
  <div>
    <p class="eyebrow">The Design Studio · 300-DPI Live Mockup</p>
    <h1 class="product__title">${esc(p.title)}</h1>
    <div class="product__price" data-price>${money(first.price)}</div>
    <form data-studio-form data-cart-form data-cart-url="${base}cart/">
      <input type="hidden" name="id" value="${esc(first.id)}" data-variant-id>
      <input type="hidden" name="properties[Studio Library design]" value="" data-library-input disabled>
      <input type="hidden" name="properties[Placement]" value="" data-placement-input>
      <input type="hidden" name="properties[_Background removed]" value="No" data-bg-input>
      <div class="studio__panel">
        <h3>1. Upload your own artwork (PNG, SVG, JPG, WebP)</h3>
        <input type="file" name="properties[Artwork]" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-upload>
        <div class="row" style="margin-top:12px">
          <button type="button" class="btn btn--small" data-remove-bg>Remove background</button>
          <button type="button" class="btn btn--ghost btn--small" data-restore hidden>Restore original</button>
          <label style="margin:0;display:flex;gap:8px;align-items:center">Color tolerance <input type="range" min="5" max="120" value="38" data-tolerance style="width:120px"></label>
        </div>
        <p class="note">Best results: a 3000 x 3600px (300 DPI at 10" x 12") PNG with a transparent background.</p>
      </div>
      <div class="studio__panel">
        <h3>Or choose from our Studio Library</h3>
        <div class="library">${library.map((a) => `<button type="button" aria-pressed="false" data-library="${esc(imageUrl(a.image, base))}" data-title="${esc(a.title)}"><img src="${esc(imageUrl(a.image, base))}" alt="${esc(a.title)}" width="300" height="300" loading="lazy"><span>${esc(a.title)}</span></button>`).join('')}</div>
      </div>
      <div class="studio__panel"><h3>2. Garment</h3>${optionPickers(p, 'SOpt')}</div>
      <div class="studio__panel">
        <h3>3. Placement</h3>
        <div class="field"><label for="Scale">Scale on garment (<span data-scale-label>100</span>%)</label><input id="Scale" type="range" min="30" max="100" value="100" data-scale></div>
        <div class="field"><label for="Rotate">Rotate (<span data-rotate-label>0</span>°)</label><input id="Rotate" type="range" min="-45" max="45" value="0" data-rotate></div>
      </div>
      <button class="btn btn--block" type="submit" data-add-button>Add this custom design to my bag</button>
      <p class="studio__error" data-error hidden>Upload artwork or pick a Studio Library design first.</p>
      <p class="note">Made to order. Printed after you check out. Studio prices are placeholders until confirmed.</p>
    </form>
    <div class="product__desc rte">${p.body}</div>
  </div>
  ${productData(p, base)}
  <script type="application/json" data-studio-config>${JSON.stringify({
    printWidthInches: config.studio.printWidthInches,
    colors: { 'vintage black': '#17181b', 'midnight navy': '#1c2740', 'bone cream': '#f1ebdf', 'charcoal pepper': '#3a3c40' },
    strings: {
      dpiOk: '__DPI__ DPI at print size. Looks sharp.', dpiLow: '__DPI__ DPI at print size. 300 DPI or more prints sharpest.',
      artOnly: 'Art-only view', garmentView: 'Garment view', needArt: 'Upload artwork or pick a Studio Library design first.',
    },
  })}</script>
</div>`;
  pages.set(`products/${p.handle}/index.html`, layout({ title: `${p.seoTitle || p.title} - ${config.shopName}`, description: p.seoDescription, base, body, scripts: ['studio.js'] }));
}

function cartPage() {
  const base = '../';
  pages.set('cart/index.html', layout({
    title: `Your bag - ${config.shopName}`, base,
    body: `<section class="cart" data-cart-page data-products-url="${base}products/"><div class="wrap">
  <h1>Your bag</h1>
  <div data-cart-empty><p class="muted">Your bag is empty.</p><a class="btn" href="${base}collections/">Continue shopping</a></div>
  <div data-cart-footer hidden>
    <table class="cart-table"><thead><tr><th>Item</th><th>Price</th><th>Quantity</th><th style="text-align:right">Total</th></tr></thead><tbody data-cart-lines></tbody></table>
    <div class="cart-footer"><div></div><div class="cart-totals">
      <div class="row"><span>Subtotal</span><span data-cart-subtotal></span></div>
      <p class="note">Checkout is not connected in this build.</p>
      <button class="btn btn--block" type="button" disabled>Check out</button>
    </div></div>
  </div>
</div></section>`,
  }));
}

function notFoundPage() {
  pages.set('404.html', layout({
    title: `Page not found - ${config.shopName}`, base: '/',
    body: '<section class="page"><div class="wrap"><h1>Page not found</h1><p class="muted">That page moved or never existed.</p><a class="btn" href="/collections/">Continue shopping</a></div></section>',
  }));
}

homePage();
collectionPages();
for (const p of live) (p.handle === studioHandle ? studioPage : productPage)(p);
cartPage();
notFoundPage();

// ---------- write ----------
rmSync(out, { recursive: true, force: true });
for (const [path, html] of pages) {
  const file = new URL(path, out);
  mkdirSync(dirname(file.pathname), { recursive: true });
  writeFileSync(file, html);
}
mkdirSync(new URL('assets/images/', out), { recursive: true });
for (const name of ['theme.css', 'theme.js', 'studio.js']) copyFileSync(new URL(`theme/assets/${name}`, shop), new URL(`assets/${name}`, out));
for (const name of ['cart.js', 'storefront.css']) copyFileSync(new URL(`assets/${name}`, src), new URL(`assets/${name}`, out));
for (const [name, from] of copiedImages) copyFileSync(from, new URL(`assets/images/${name}`, out));

const missing = [...excluded].filter((h) => !byHandle.has(h));
console.log(`Built ${pages.size} pages into shopify/storefront/dist/`);
console.log(`Products: ${live.length} included, ${products.length - live.length} left out as Printify-only${excluded.size ? ` (${[...excluded].filter((h) => byHandle.has(h)).join(', ')})` : ''}`);
if (!excluded.size) console.log('Note: shopify/storefront/providers.json lists no Printify products yet, so nothing was left out.');
if (missing.length) console.log(`Warning: providers.json names handles not in products.csv: ${missing.join(', ')}`);
console.log(`Images: ${copiedImages.size} served from shopify/site-assets/, the rest from their original URLs.`);
