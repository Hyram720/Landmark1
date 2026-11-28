// Trust pages: /faq, /about, /contact and /policies (privacy, terms, returns, shipping).
// Plain, factual copy that matches current practice. Anything the owner still has to decide
// (legal entity, retention period, refund language, studio-named email) is left out of the
// pages on purpose and listed in DECISIONS.md, not guessed here.
import config, { PRODUCTS } from './config.js';
import { layout } from './seo.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const usd = (cents) => `$${(cents / 100).toFixed(0)}`;
const base = config.baseUrl;
const brand = config.brandName;
const mail = () => (config.supportEmail ? `<a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>` : '');
const emailLine = () => (config.supportEmail ? `Email ${mail()}.` : 'Use the order form on the homepage to reach us through your order email.');

const crumbs = (name, path) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
    { '@type': 'ListItem', position: 2, name, item: `${base}${path}` },
  ],
});

// Same Organization node as the homepage so every page agrees on who the business is.
export const organizationLd = () => ({
  '@context': 'https://schema.org', '@type': 'Organization', '@id': `${base}/#organization`,
  name: brand, url: `${base}/`, logo: `${base}/showcase/bella-golden.webp?w=480`,
  ...(config.supportEmail ? { email: config.supportEmail, contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', email: config.supportEmail, areaServed: ['US', 'CA'], availableLanguage: 'English' }] } : {}),
});

// First sentence of each answer is the plain answer; the rest adds detail.
export const FAQ_ITEMS = () => {
  const d = PRODUCTS.digital, s = PRODUCTS.canvas_small, l = PRODUCTS.canvas_large;
  return [
    ['What is a custom pet portrait and how does it work?',
      'A custom pet portrait is an artwork made from a photo of your own dog or cat. You upload one clear photo, pick a style, and we create 4 portraits of your pet with AI image generation, then email you a private gallery link. You can keep the digital files or pick a favorite for a gallery canvas.'],
    ['Are custom pet portraits made with AI?',
      'Ours are. Each portrait is created by an AI image model from your photo and the style you choose. They are digital artworks, not drawn by hand. We add a nameplate if you ask for one and send you the finished files. Other sellers may work differently, so it is worth asking before you buy.'],
    ['How much does a custom pet portrait cost?',
      `The ${d.name} is ${usd(d.price)}. The ${s.name} is ${usd(s.price)}, and the ${l.name} is ${usd(l.price)}. Prices are in US dollars. Canvas orders ship to the US and Canada. If a launch offer is running, the discount is applied automatically at checkout.`],
    ['How do I get a pet portrait from a photo?',
      'Upload one clear photo on the homepage, pick one of 6 styles, add your pet\'s name for the nameplate if you like, and pay at secure Stripe checkout. Your private gallery link arrives by email with 4 portraits. Photos with the eyes visible, good light and one pet in the shot work best.'],
    ['What is a good last minute gift for a pet lover?',
      'A digital portrait of their pet needs no shipping, so it suits a late gift. Order with your own email, then forward the private gallery link to the pet lover. For a canvas, check the Christmas page for the current order-by date, because carrier arrival varies and we cannot promise a delivery day.'],
    ['What do I get with a digital order?',
      'You get 4 portraits of your pet in your private gallery, ready to download. Each portrait is created at 1024 by 1536 pixels and then enlarged for download. Enlarging adds pixels, not new detail. That suits phones, screens and sharing, and prints sharpest at small sizes, up to about 3.4 by 5.1 inches.'],
    ['How does delivery work?',
      'Digital portraits are delivered by email as a private gallery link once they are ready. Canvas prints are made after you choose your favorite portrait in the gallery, and they ship 3 to 5 business days after you choose. Carrier arrival varies after that.'],
    ['How does the canvas order work?',
      'You pay for the canvas at checkout, and the 4 digital portraits are included. When they are ready, open your private gallery and tap the one you want printed. We send that one to print and ship it to the address you gave at checkout, in the US or Canada.'],
    ['What photo works best?',
      'A clear, well-lit photo with your pet\'s face and eyes visible works best. Daylight near a window beats flash, and the head and shoulders should fill most of the frame. Use one pet per photo. JPG, PNG and WEBP files work, and older photos are fine.'],
    ['What if the name on the nameplate is misspelled?',
      'The nameplate shows the name exactly as you typed it. If you made a typo, fix it on your gallery page and all portraits update, any time before a canvas is printed. Please check the spelling before you choose a canvas.'],
    ['What if a digital file is defective or missing?',
      'Digital files are final sale. Contact studio support for a replacement if a file is defective or was not delivered. Canvas print issues are reviewed by studio support. Our policies page has the details.'],
    ['Can I order as a gift?',
      'Yes. Use your own email so the surprise stays a surprise, then forward the gallery link. For a canvas, enter the recipient\'s shipping address at checkout, in the US or Canada.'],
  ];
};

const faqSection = (items) => items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n');
const faqLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

export function faqPage() {
  const items = FAQ_ITEMS();
  const description = 'Answers about custom pet portraits: how they work, that ours are made with AI, what they cost, how to order from a photo, and how delivery and canvas orders work.';
  const body = `<section class="hero-seo"><h1>Custom pet portrait questions</h1><p class="lead">Plain answers about how our portraits are made, what they cost and what you get.</p></section>
<section>${faqSection(items)}</section>
<section class="cta"><a class="btn" href="/#order">Create my pet's portrait</a></section>
<p class="center fine">More: <a href="/about">About</a> · <a href="/policies">Policies</a> · <a href="/contact">Contact</a> · <a href="/portraits/dog-from-photo">Dog portrait from a photo</a></p>`;
  return layout({ title: 'FAQ: Custom Pet Portraits', description, path: '/faq', body, jsonLd: [faqLd(items), crumbs('FAQ', '/faq'), organizationLd()] });
}

export function aboutPage() {
  const description = 'How Custom Pet Portrait Studio makes portraits: AI image generation from your photo, a nameplate if you want one, and an optional gallery canvas.';
  const body = `<section class="hero-seo"><h1>About ${esc(brand)}</h1><p class="lead">We turn one photo of your dog or cat into four custom portraits, with an optional gallery canvas.</p></section>
<section><h2>How a portrait is made</h2>
<p>Your portraits are made with AI image generation. When you order, your photo and the style you picked go to an AI image model, which creates 4 portraits. We then enlarge each one for download, add your pet's name on a nameplate if you asked for one, and place the results in your private gallery. They are digital artworks, not drawn by hand.</p>
<p>Enlarging adds pixels, not new detail, so the files suit phones, screens and sharing, and print sharpest at small sizes. Canvas prints are made from the same image and have a soft, painterly look up close.</p></section>
<section><h2>About our samples</h2>
<p>Most sample pets on this site are AI-generated demo photos. Khabba is a real customer's dog, shown with permission.</p></section>
<section><h2>What you can order</h2>
<ul><li>${esc(PRODUCTS.digital.name)}: ${usd(PRODUCTS.digital.price)}</li><li>${esc(PRODUCTS.canvas_small.name)}: ${usd(PRODUCTS.canvas_small.price)}</li><li>${esc(PRODUCTS.canvas_large.name)}: ${usd(PRODUCTS.canvas_large.price)}</li></ul>
<p>Canvas orders ship to the US and Canada. Payment is handled by Stripe checkout.</p></section>
<section><h2>Questions</h2><p>See the <a href="/faq">FAQ</a>, our <a href="/policies">policies</a>, or <a href="/contact">contact us</a>.</p></section>
<section class="cta"><a class="btn" href="/#order">Create my pet's portrait</a></section>`;
  const aboutLd = { '@context': 'https://schema.org', '@type': 'AboutPage', name: `About ${brand}`, url: `${base}/about`, about: { '@id': `${base}/#organization` } };
  return layout({ title: `About ${brand}`, description, path: '/about', body, jsonLd: [aboutLd, crumbs('About', '/about'), organizationLd()] });
}

export function contactPage() {
  const description = 'Contact Custom Pet Portrait Studio about an order, a gallery link, a defective or missing file, or a canvas print.';
  const body = `<section class="hero-seo"><h1>Contact us</h1><p class="lead">Questions about an order, your gallery link or a canvas print.</p></section>
<section><h2>Email</h2>
<p>${emailLine()}</p>
<p>To help us find your order, include the email address you used at checkout and your pet's name. If something is wrong with a file or a print, say what you see and attach a screenshot or photo if you can.</p></section>
<section><h2>Before you write</h2>
<ul><li>Name spelling: you can fix it yourself on your gallery page before a canvas is printed.</li><li>Answers to common questions are in the <a href="/faq">FAQ</a>.</li><li>Delivery, privacy and replacement details are on the <a href="/policies">policies page</a>.</li></ul></section>`;
  const contactLd = { '@context': 'https://schema.org', '@type': 'ContactPage', name: `Contact ${brand}`, url: `${base}/contact`, about: { '@id': `${base}/#organization` } };
  return layout({ title: 'Contact', description, path: '/contact', body, jsonLd: [contactLd, crumbs('Contact', '/contact'), organizationLd()] });
}

export function policiesPage() {
  const description = 'Privacy, terms, returns and replacements, and shipping for Custom Pet Portrait Studio.';
  const body = `<section class="hero-seo"><h1>Policies</h1><p class="lead">Privacy, terms, returns and replacements, and shipping.</p>
<p class="fine"><a href="#privacy">Privacy</a> · <a href="#terms">Terms</a> · <a href="#returns">Returns and replacements</a> · <a href="#shipping">Shipping</a></p></section>
<section id="privacy"><h2>Privacy</h2>
<p>When you order, we collect your email address, your pet's photo, your pet's name if you add one, the portrait style and product you pick, and the shipping address you enter at checkout for a canvas.</p>
<p>We use this to create and deliver your portraits, print and ship a canvas, take payment, and answer your questions. Card details are entered on Stripe's checkout page and are handled by Stripe. We do not see your card number.</p>
<p>To do this we use service providers: Stripe for payments, OpenAI for AI image generation (your photo and style choice are sent to it), Resend for email, Printful for canvas printing and shipping, and Railway for hosting.</p>
<p>We send emails about your order. If you start a checkout and do not finish, or after a portrait is delivered, we may send a follow-up email. Each of those emails has an unsubscribe link. If analytics or advertising tools are active on this site, they may collect standard usage data such as pages viewed.</p>
<p>${config.supportEmail ? `To ask a question about your information, email ${mail()}.` : 'To ask a question about your information, contact us through your order email.'}</p></section>
<section id="terms"><h2>Terms</h2>
<p>By placing an order you confirm that you own the photo you upload or have the right to use it, and that it shows a pet. Portraits are created by AI image generation, so results vary and we cannot promise a particular look. Prices are in US dollars and payment is taken at Stripe checkout. Digital files are final sale, see returns and replacements below. We may update these pages, and the version on this site is the current one.</p></section>
<section id="returns"><h2>Returns and replacements</h2>
<p>Digital files are final sale. Contact studio support for a replacement if a file is defective or was not delivered.</p>
<p>Canvas print issues are reviewed by studio support. ${emailLine()}</p></section>
<section id="shipping"><h2>Shipping</h2>
<p>Digital portraits are delivered by email as a private gallery link, so there is nothing to ship.</p>
<p>Canvas prints are made after you choose your favorite portrait in your private gallery, and they ship 3 to 5 business days after you choose. We ship to the United States and Canada. Carrier arrival varies, so we cannot promise a delivery date. The Christmas canvas order-by date is pending fulfillment confirmation, see the <a href="/gifts/christmas-gift">Christmas page</a>.</p></section>`;
  return layout({ title: 'Policies: Privacy, Terms, Returns and Shipping', description, path: '/policies', body, jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Policies', url: `${base}/policies`, isPartOf: { '@id': `${base}/#website` } }, crumbs('Policies', '/policies'), organizationLd()] });
}

export const trustRoutes = { '/faq': faqPage, '/about': aboutPage, '/contact': contactPage, '/policies': policiesPage };
export { faqLd };
