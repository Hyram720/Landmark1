// Shared rendering for the homepage and the /offer sales page: launch banner, showcase gallery,
// before/after pairs and pricing. The builders are pure functions, so the server uses the same
// code to put this content in the HTML (crawlers and no-JS visitors see it), and the browser
// re-renders it with fresh data. Every section hides itself if its data isn't available.
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const img = (key, kind = '', w = 900) => `/showcase/${key}${kind}.webp?w=${w}`;
export const discountedFor = (launch) => (cents) => (launch ? Math.round(cents * (1 - launch.percent / 100)) : cents);

// Real dates only: the launch offer end (from the catalog) and the Dec 10 US canvas cutoff for
// Christmas (Printful's US standard cutoff is Dec 11). Copy from the holiday campaign spec.
export function bannerHtml(launch, now = new Date()) {
  const y = now.getFullYear();
  const cutoff = new Date(y, 11, 10, 23, 59);
  const inSeason = now.getMonth() >= 9 && now <= new Date(y, 11, 25);
  const launchEnd = launch?.ends ? new Date(`${launch.ends}T12:00:00`) : null;
  const endsLong = launchEnd ? launchEnd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : '';
  const offer = launch ? `${launch.percent}% launch offer${endsLong ? ` through ${endsLong}` : ''}, no code needed` : '';
  if (inSeason && now <= cutoff) {
    return `<strong>Holiday dates:</strong> ${offer ? `${offer} · ` : ''}Canvas for Christmas: order and pick your favorite by Thu Dec 10 (US) · Digital arrives in minutes, any day.`;
  }
  if (inSeason) return `Too late for canvas? A digital portrait still arrives in minutes, ready to print or frame.${offer ? ` · ${offer}` : ''}`;
  return offer ? `🎉 <strong>${offer}</strong>` : '⚡ Digital portraits usually arrive in minutes';
}

export const heroPick = (showcase) => showcase.find((s) => s.key === 'bella-golden') || showcase[0];
export const heroAlt = (s) => `${s.name}, a custom pet portrait in the ${s.styleName} style`;

// Prefer the clearest example photos first; the real customer pet (from: order) comes last.
export function beforeAfterHtml(showcase) {
  const withBefore = showcase.filter((s) => s.before);
  const pairs = [...withBefore.filter((s) => !s.real), ...withBefore.filter((s) => s.real)].slice(0, 3);
  return pairs
    .map(
      (s) => `<div class="ba">
          <figure><img src="${img(s.key, '-before', 480)}" alt="Photo of ${esc(s.name)} before" loading="lazy" width="480" height="720"><figcaption>${s.real ? 'Customer photo' : 'Example photo'}</figcaption></figure>
          <div class="ba-arrow">→</div>
          <figure><img src="${img(s.key, '', 480)}" alt="${esc(s.name)} as ${esc(s.styleName)}" loading="lazy" width="480" height="720"><figcaption>${esc(s.styleName)}</figcaption></figure>
        </div>`
    )
    .join('');
}

// At most 2 tiles of the same pet, so the gallery doesn't read as one dog.
export function galleryHtml(showcase) {
  const perPet = {};
  return showcase
    .filter((s) => (perPet[s.name] = (perPet[s.name] || 0) + 1) <= 2)
    .slice(0, 8)
    .map(
      (s) => `<a class="tile" href="/?style=${s.style}#order" data-style="${s.style}">
          <img src="${img(s.key, '', 480)}" alt="${esc(s.name)} pet portrait in the ${esc(s.styleName)} style" loading="lazy" width="480" height="720">
          <span>${esc(s.styleName)}</span></a>`
    )
    .join('');
}

// Pricing cards: what's included, from real catalog prices and the stated policies.
const PERKS = {
  digital: ['4 portraits of your pet', '300 DPI files (2400×3600 px)', 'Usually delivered in minutes', 'Name on a gold nameplate (optional)', 'One free repaint within 7 days'],
  canvas_small: ['Everything in Digital', 'Your favorite printed on a 12×18" gallery canvas', 'Ships in 3–5 business days after you pick', 'US & Canada'],
  canvas_large: ['Everything in Digital', 'Your favorite printed on a 16×24" gallery canvas', 'Ships in 3–5 business days after you pick', 'US & Canada'],
};
const TAGS = { digital: 'Instant gift', canvas_small: 'Ready to hang', canvas_large: 'Statement size' };
export function pricingHtml(catalog) {
  const launch = catalog.launch;
  const discounted = discountedFor(launch);
  return Object.entries(catalog.products)
    .map(([k, p], i) => `<div class="price-card${i === 1 ? ' featured' : ''}">
          ${TAGS[k] ? `<div class="pill">${TAGS[k]}</div>` : ''}
          <h3>${esc(p.name)}</h3>
          <div class="price">${launch ? `<s>${money(p.price)}</s> ` : ''}<strong>${money(discounted(p.price))}</strong></div>
          ${launch ? `<p class="price-note">${launch.percent}% launch discount applied at checkout</p>` : ''}
          ${PERKS[k] ? `<ul class="perks">${PERKS[k].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
          <a class="btn" href="/?product=${k}#order">Choose ${k === 'digital' ? 'Digital' : 'this canvas'}</a></div>`)
    .join('');
}

export const supportHtml = (email) =>
  email ? `Questions or problems with an order? Email <a href="mailto:${esc(email)}">${esc(email)}</a>. We reply within one business day.` : '';

// Internal links to SEO pages help them get crawled and ranked.
export const footerHtml = (year = new Date().getFullYear()) => `<nav class="seo-links"><p>
      <a href="/#how">How it works</a> · <a href="/#pricing-section">Pricing</a> · <a href="/#faq">FAQ</a> · <a href="/offer">Launch offer</a></p><p>
      <a href="/gifts/christmas-gift">Christmas pet portraits</a> · <a href="/gifts/pet-memorial">Pet memorial portraits</a> ·
      <a href="/gifts/gifts-for-dog-lovers">Gifts for dog lovers</a> · <a href="/gifts/gifts-for-cat-lovers">Gifts for cat lovers</a> ·
      <a href="/portraits/golden-retriever">Golden Retriever</a> · <a href="/portraits/french-bulldog">French Bulldog</a> ·
      <a href="/portraits/german-shepherd">German Shepherd</a> · <a href="/portraits/maine-coon">Maine Coon</a></p></nav>
      <p>© ${year} Custom Pet Portrait Studio</p>`;

export async function loadSite() {
  const $ = (id) => document.getElementById(id);
  const [catalog, showcase] = await Promise.all([
    fetch('/api/catalog').then((r) => r.json()),
    fetch('/api/showcase').then((r) => r.json()).catch(() => []),
  ]);
  const launch = catalog.launch;
  const discounted = discountedFor(launch);

  if ($('banner')) $('banner').innerHTML = bannerHtml(launch);

  if ($('heroImg') && showcase.length) {
    const hero = heroPick(showcase);
    $('heroImg').src = img(hero.key);
    $('heroImg').alt = heroAlt(hero);
    $('heroFrame').hidden = false;
  }

  // Infomercial (loads only when played)
  if ($('promoVideo') && catalog.promoVideo) {
    $('promoVideo').src = catalog.promoVideo;
    $('videoSection').hidden = false;
    $('promoVideo').addEventListener('play', () => window.fbq && fbq('trackCustom', 'VideoPlay'), { once: true });
  }

  const ba = beforeAfterHtml(showcase);
  if ($('beforeAfter') && ba) { $('beforeAfter').innerHTML = ba; $('beforeAfterSection').hidden = false; }

  const gal = galleryHtml(showcase);
  if ($('gallery') && gal) { $('gallery').innerHTML = gal; $('gallerySection').hidden = false; }

  if ($('pricing')) $('pricing').innerHTML = pricingHtml(catalog);
  if ($('support') && catalog.supportEmail) $('support').innerHTML = supportHtml(catalog.supportEmail);

  return { catalog, showcase, launch, discounted, money };
}
