// Shared rendering for the homepage and the /offer sales page: launch banner, showcase gallery,
// before/after pairs and pricing. Every section hides itself if its data isn't available.
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const img = (key, kind = '', w = 900) => `/showcase/${key}${kind}.webp?w=${w}`;

export async function loadSite() {
  const [catalog, showcase] = await Promise.all([
    fetch('/api/catalog').then((r) => r.json()),
    fetch('/api/showcase').then((r) => r.json()).catch(() => []),
  ]);
  const launch = catalog.launch;
  const discounted = (cents) => (launch ? Math.round(cents * (1 - launch.percent / 100)) : cents);
  const endsText = launch?.ends
    ? new Date(`${launch.ends}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  // Banner
  if ($('banner')) {
    $('banner').innerHTML = launch
      ? `🎉 <strong>Launch offer: ${launch.percent}% off everything</strong> — applied automatically at checkout${endsText ? ` · ends ${endsText}` : ''}`
      : '🎄 Digital portraits delivered in minutes — order canvas by Dec 10 for Christmas';
  }

  // Hero portrait
  if ($('heroImg') && showcase.length) {
    const hero = showcase.find((s) => s.key === 'bella-golden') || showcase[0];
    $('heroImg').src = img(hero.key);
    $('heroImg').alt = `${hero.name} painted as ${hero.styleName}`;
    $('heroFrame').hidden = false;
  }

  // Before -> after
  const pairs = showcase.filter((s) => s.before).slice(0, 3);
  if ($('beforeAfter') && pairs.length) {
    $('beforeAfter').innerHTML = pairs
      .map(
        (s) => `<div class="ba">
          <figure><img src="${img(s.key, '-before', 480)}" alt="Original photo of ${esc(s.name)}" loading="lazy"><figcaption>The photo</figcaption></figure>
          <div class="ba-arrow">→</div>
          <figure><img src="${img(s.key, '', 480)}" alt="${esc(s.name)} as ${esc(s.styleName)}" loading="lazy"><figcaption>${esc(s.styleName)}</figcaption></figure>
        </div>`
      )
      .join('');
    $('beforeAfterSection').hidden = false;
  }

  // Gallery
  if ($('gallery') && showcase.length) {
    $('gallery').innerHTML = showcase
      .map(
        (s) => `<a class="tile" href="/?style=${s.style}#order" data-style="${s.style}">
          <img src="${img(s.key, '', 480)}" alt="${esc(s.name)} as ${esc(s.styleName)}" loading="lazy">
          <span>${esc(s.styleName)}</span></a>`
      )
      .join('');
    $('gallerySection').hidden = false;
  }

  // Pricing cards
  if ($('pricing')) {
    $('pricing').innerHTML = Object.entries(catalog.products)
      .map(([k, p], i) => {
        const now = discounted(p.price);
        return `<div class="price-card${i === 1 ? ' featured' : ''}">
          ${i === 1 ? '<div class="pill">Most gifted</div>' : ''}
          <h3>${esc(p.name)}</h3>
          <div class="price">${launch ? `<s>${money(p.price)}</s> ` : ''}<strong>${money(now)}</strong></div>
          <a class="btn" href="/?product=${k}#order">Choose</a></div>`;
      })
      .join('');
  }

  // Support line
  if ($('support') && catalog.supportEmail) {
    $('support').innerHTML = `Questions or problems with an order? Email <a href="mailto:${esc(catalog.supportEmail)}">${esc(catalog.supportEmail)}</a> — we reply within one business day.`;
  }

  return { catalog, showcase, launch, discounted, money };
}
