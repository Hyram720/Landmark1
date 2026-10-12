// Programmatic SEO: one landing page per breed and per gift occasion, plus sitemap/robots.
// Breed terms are low-CPC long-tail searches ("golden retriever portrait" ~260/mo at $0.43 CPC)
// that a big generic store doesn't target individually.
import config, { STYLES, PRODUCTS } from './config.js';

const plural = (name) => (/[^aeiou]y$/i.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`);
const usd = (cents) => `$${(cents / 100).toFixed(0)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// [name, kind, one-line personality hook used in copy, best-fit style]
const BREED_DATA = [
  ['Golden Retriever', 'dog', 'that sunny, loyal grin', 'royal'],
  ['Labrador Retriever', 'dog', 'those soulful eyes and endless good nature', 'admiral'],
  ['French Bulldog', 'dog', 'those bat ears and big personality', 'duchess'],
  ['German Shepherd', 'dog', 'that noble, watchful stare', 'admiral'],
  ['Bulldog', 'dog', 'that dignified, jowly frown', 'royal'],
  ['Poodle', 'dog', 'that elegant, aristocratic poise', 'duchess'],
  ['Beagle', 'dog', 'that curious nose and floppy ears', 'admiral'],
  ['Rottweiler', 'dog', 'that gentle-giant presence', 'royal'],
  ['Dachshund', 'dog', 'that long, proud silhouette', 'royal'],
  ['Corgi', 'dog', 'that famously royal fluffy behind', 'royal'],
  ['Australian Shepherd', 'dog', 'those striking merle eyes', 'astronaut'],
  ['Yorkshire Terrier', 'dog', 'that silky coat and tiny-boss attitude', 'duchess'],
  ['Boxer', 'dog', 'that playful, fearless energy', 'admiral'],
  ['Cavalier King Charles Spaniel', 'dog', 'a face literally bred for royal portraits', 'duchess'],
  ['Shih Tzu', 'dog', 'that flowing coat and palace-dog heritage', 'duchess'],
  ['Siberian Husky', 'dog', 'those icy blue eyes', 'astronaut'],
  ['Pomeranian', 'dog', 'that cloud of fluff and big attitude', 'duchess'],
  ['Boston Terrier', 'dog', 'that tuxedo coat, already dressed for the occasion', 'admiral'],
  ['Great Dane', 'dog', 'that towering, regal frame', 'royal'],
  ['Chihuahua', 'dog', 'that tiny body and enormous spirit', 'royal'],
  ['Pug', 'dog', 'that wrinkly, unforgettable face', 'royal'],
  ['Border Collie', 'dog', 'that brilliant, intense focus', 'astronaut'],
  ['Bernese Mountain Dog', 'dog', 'that tri-color coat and gentle soul', 'royal'],
  ['Doberman', 'dog', 'that sleek, commanding stance', 'admiral'],
  ['Goldendoodle', 'dog', 'that teddy-bear curls look', 'watercolor'],
  ['Labradoodle', 'dog', 'that shaggy, happy-go-lucky charm', 'watercolor'],
  ['Pit Bull', 'dog', 'that big smile and bigger heart', 'royal'],
  ['Shiba Inu', 'dog', 'that fox-like, knowing expression', 'astronaut'],
  ['Maine Coon', 'cat', 'that lion-like mane', 'royal'],
  ['Persian Cat', 'cat', 'that luxurious coat and unimpressed gaze', 'duchess'],
  ['Siamese Cat', 'cat', 'those piercing blue eyes', 'duchess'],
  ['Ragdoll Cat', 'cat', 'that plush coat and sweet blue eyes', 'watercolor'],
  ['Bengal Cat', 'cat', 'that wild leopard-spotted coat', 'royal'],
  ['British Shorthair', 'cat', 'that round, teddy-bear face', 'admiral'],
  ['Sphynx Cat', 'cat', 'that unmistakable, ancient-pharaoh look', 'royal'],
  ['Orange Tabby Cat', 'cat', 'that legendary orange-cat energy', 'royal'],
  ['Black Cat', 'cat', 'that sleek, mysterious elegance', 'duchess'],
  ['Tuxedo Cat', 'cat', 'that built-in formalwear', 'admiral'],
];

export const BREEDS = BREED_DATA.map(([name, kind, hook, style]) => ({
  name, kind, hook, style, slug: slugify(name),
}));

export const OCCASIONS = [
  {
    slug: 'christmas-gift', title: 'Custom Pet Portrait Christmas Gift', style: 'holiday',
    h1: 'The Christmas gift every pet parent secretly wants',
    intro: 'Turn their dog or cat into a one-of-a-kind holiday masterpiece. Order digital for instant delivery, or a gallery canvas shipped to their door.',
  },
  {
    slug: 'pet-memorial', title: 'Pet Memorial Portrait', style: 'watercolor',
    h1: 'A loving memorial portrait of the pet you miss',
    intro: 'Honor a best friend with a timeless portrait made from your favorite photo. A gentle, beautiful way to keep them close — and a deeply meaningful sympathy gift.',
  },
  {
    slug: 'mothers-day-gift', title: "Dog Mom & Cat Mom Mother's Day Gift", style: 'duchess',
    h1: "The Mother's Day gift for every dog mom and cat mom",
    intro: 'Her fur baby, painted like nobility. Instant digital delivery means it is never too late to order.',
  },
  {
    slug: 'fathers-day-gift', title: "Dog Dad Father's Day Gift", style: 'admiral',
    h1: "Father's Day, sorted: his dog as a decorated admiral",
    intro: 'Funny, classy and wall-worthy. The gift dog dads actually hang up.',
  },
  {
    slug: 'birthday-gift', title: 'Pet Portrait Birthday Gift', style: 'royal',
    h1: 'A birthday gift they will never forget',
    intro: 'Give them their pet as royalty. Upload a phone photo — we handle the rest.',
  },
  {
    slug: 'gifts-for-dog-lovers', title: 'Unique Gifts for Dog Lovers', style: 'royal',
    h1: 'The most unique gift for a dog lover',
    intro: 'Skip the generic mug. Give a museum-style portrait of the dog they love most.',
  },
  {
    slug: 'gifts-for-cat-lovers', title: 'Unique Gifts for Cat Lovers', style: 'duchess',
    h1: 'Finally — a cat lover gift worthy of the cat',
    intro: 'Cats have always believed they are royalty. Now there is a portrait to prove it.',
  },
];

const priceList = () =>
  Object.values(PRODUCTS).map((p) => `<li>${esc(p.name)} — <strong>${usd(p.price)}</strong></li>`).join('');

function layout({ title, description, path, body, jsonLd }) {
  const url = `${config.baseUrl}${path}`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ${esc(config.brandName)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}"><meta property="og:type" content="website">
<link rel="stylesheet" href="/styles.css">
${jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head><body>
<header class="nav"><a href="/" class="logo">👑 ${esc(config.brandName)}</a><a href="/#order" class="btn small">Create yours</a></header>
<main class="seo">${body}</main>
<footer>${seoFooterLinks()}${config.supportEmail ? `<p>Questions? Email <a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a></p>` : ''}<p>© ${new Date().getFullYear()} ${esc(config.brandName)}</p></footer>
</body></html>`;
}

function seoFooterLinks() {
  const breeds = BREEDS.map((b) => `<a href="/portraits/${b.slug}">${esc(b.name)} portraits</a>`).join(' · ');
  const occ = OCCASIONS.map((o) => `<a href="/gifts/${o.slug}">${esc(o.title)}</a>`).join(' · ');
  return `<nav class="seo-links"><p>${occ}</p><p>${breeds}</p></nav>`;
}

function faq(subject) {
  return [
    ['How does it work?', `Upload a clear photo of your ${subject}, pick a style, and check out. Our studio paints ${config.image.variants} versions and emails you a private gallery link.`],
    ['How fast will I get it?', 'Digital portraits are usually delivered within minutes. Canvas prints ship in about 3–5 business days after you choose your favorite.'],
    ['What photo works best?', 'A well-lit, front-facing photo where the eyes are clearly visible. Phone photos are perfect.'],
    ['What if I don\'t love it?', 'You get 4 versions to choose from. If none feel right, use your one free repaint from your gallery within 7 days (before printing) for 4 new versions.'],
    ['Can I fix the name on the nameplate?', 'Yes. The name is engraved exactly as you type it, and you can correct the spelling on your gallery page at any time before your canvas is printed.'],
  ];
}

function faqLd(items) {
  return {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
}

function productLd(name, description) {
  const prices = Object.values(PRODUCTS).map((p) => p.price / 100);
  return {
    '@context': 'https://schema.org', '@type': 'Product', name, description, brand: config.brandName,
    offers: {
      '@type': 'AggregateOffer', priceCurrency: 'USD',
      lowPrice: Math.min(...prices), highPrice: Math.max(...prices), availability: 'https://schema.org/InStock',
    },
  };
}

const faqHtml = (items) => `<section><h2>Questions</h2>${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>`;

export function breedPage(slug) {
  const b = BREEDS.find((x) => x.slug === slug);
  if (!b) return null;
  const style = STYLES[b.style];
  const title = `Custom ${b.name} Portrait from Your Photo`;
  const description = `Turn your ${b.name} into a regal custom portrait. Upload a photo, choose a style, get it in minutes. Digital from ${usd(PRODUCTS.digital.price)}, canvas prints shipped.`;
  const items = faq(b.name);
  const others = Object.entries(STYLES).map(([k, s]) => `<li><a href="/?style=${k}#order">${esc(s.name)}</a></li>`).join('');
  const body = `
<section class="hero-seo">
  <h1>Custom ${esc(b.name)} Portraits</h1>
  <p class="lead">Nobody captures ${esc(b.hook)} like you see it. Upload your favorite photo and we'll paint your ${esc(b.name)} as a timeless work of art — delivered to your inbox in minutes.</p>
  <a class="btn" href="/?style=${b.style}&breed=${b.slug}#order">Paint my ${esc(b.name)} →</a>
</section>
<section><h2>Our pick for ${esc(plural(b.name))}: ${esc(style.name)}</h2>
<p>${esc(b.name)} owners love the ${esc(style.name.replace(/^The /, ""))} style — it suits ${esc(b.hook)} perfectly. Prefer something else? Choose from:</p><ul>${others}</ul></section>
<section><h2>Pricing</h2><ul>${priceList()}</ul><p>Every order includes ${config.image.variants} unique versions so you can pick your favorite.</p></section>
${faqHtml(items)}
<section class="cta"><a class="btn" href="/?style=${b.style}&breed=${b.slug}#order">Start my ${esc(b.name)} portrait</a></section>`;
  return layout({ title, description, path: `/portraits/${b.slug}`, body, jsonLd: [productLd(title, description), faqLd(items)] });
}

export function occasionPage(slug) {
  const o = OCCASIONS.find((x) => x.slug === slug);
  if (!o) return null;
  const description = `${o.intro} Digital from ${usd(PRODUCTS.digital.price)}.`;
  const items = faq('pet');
  const body = `
<section class="hero-seo"><h1>${esc(o.h1)}</h1><p class="lead">${esc(o.intro)}</p>
<a class="btn" href="/?style=${o.style}#order">Create the portrait →</a></section>
<section><h2>How it works</h2><ol><li>Upload a photo of the pet.</li><li>Choose a style (we suggest <strong>${esc(STYLES[o.style].name)}</strong>).</li><li>Get ${config.image.variants} hi-res versions by email — add a canvas print if you like.</li></ol></section>
<section><h2>Pricing</h2><ul>${priceList()}</ul></section>
${faqHtml(items)}
<section class="cta"><a class="btn" href="/?style=${o.style}#order">Order now</a></section>`;
  return layout({ title: o.title, description, path: `/gifts/${o.slug}`, body, jsonLd: [productLd(o.title, description), faqLd(items)] });
}

export function sitemap() {
  const urls = ['/', '/offer', ...OCCASIONS.map((o) => `/gifts/${o.slug}`), ...BREEDS.map((b) => `/portraits/${b.slug}`)];
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${config.baseUrl}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>`;
}

export function robots() {
  return `User-agent: *\nAllow: /\nDisallow: /o/\nDisallow: /files/\nDisallow: /admin\nDisallow: /api/\nDisallow: /samples\nSitemap: ${config.baseUrl}/sitemap.xml\n`;
}
