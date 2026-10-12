import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import config, { STYLES, PRODUCTS } from './config.js';
import { newOrderId, getOrder, saveOrder, updateOrder, listOrders, uploadsDir, outputDir } from './store.js';
import { createCheckoutSession, verifyWebhook } from './stripe.js';
import { enqueue, selectForPrint, requestRepaint, repaintStatus, resumePending, startRetryScheduler, enhanceExistingOrders, renameOrder } from './pipeline.js';
import { cleanName } from './nameplate.js';
import { breedPage, occasionPage, sitemap, robots } from './seo.js';
import { startFollowupScheduler } from './followups.js';
import { setupStripe } from './stripe-setup.js';
import { startEmailDomainSetup, emailDomainStatus } from './email-domain.js';
import { generateMissingSamples, listShowcase, showcasePreview, masterPath } from './samples.js';
import { alertOwner } from './notify.js';
import { startHealthcheck } from './healthcheck.js';
import { runPrintfulSelftest } from './printful-selftest.js';
import { PROMO_VIDEO_SOURCE, promoVideoPath, promoVideoCached, cachePromoVideo } from './promo-video.js';

let stripeSetupStatus = 'pending';

const app = express();
app.set('trust proxy', true); // Railway terminates TLS; use X-Forwarded-* for host/protocol
const publicDir = new URL('../public', import.meta.url).pathname;

const ALLOWED_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, `${newOrderId()}${ALLOWED_MIME[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(ALLOWED_MIME[file.mimetype])),
});

const findOrder = (id) => {
  try {
    return getOrder(id);
  } catch {
    return null;
  }
};

// Launch discount, auto-applied on Stripe Payment Links via prefilled_promo_code.
const launchOffer = () => {
  const { code, percent, ends } = config.launch;
  if (!code || (ends && Date.now() > Date.parse(`${ends}T23:59:59-05:00`))) return null;
  return { code, percent, ends };
};

const linkFor = (productKey) => !config.stripe.secretKey && config.stripe.paymentLinks[productKey];
const checkoutReady = () =>
  config.devSkipPayment ||
  (Boolean(config.stripe.webhookSecret) &&
    (Boolean(config.stripe.secretKey) || Object.keys(PRODUCTS).every((k) => config.stripe.paymentLinks[k])));

// Stripe needs the raw body for signature verification, so this route comes before json().
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = verifyWebhook(req.body.toString('utf8'), req.get('stripe-signature'));
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // API checkout puts the id in metadata; Payment Links carry it as client_reference_id.
    // Other apps on the same Stripe account send events here too, so unknown ids are ignored.
    const id = session.metadata?.order_id || session.client_reference_id;
    const order = id && findOrder(id);
    if (order && order.status === 'pending_payment' && session.payment_status === 'paid') {
      // A Payment Link buyer could pair a cheap link with a pricier order; make sure it matches.
      const product = PRODUCTS[order.product];
      const viaLink = !session.metadata?.order_id;
      if (viaLink && (session.metadata?.product !== order.product || session.amount_subtotal < product.price)) {
        updateOrder(id, { status: 'payment_mismatch', stripeSessionId: session.id, amountPaid: session.amount_total });
        alertOwner(`Payment mismatch on order ${id}`, `Paid for ${session.metadata?.product} (${session.amount_subtotal}) but ordered ${order.product}. Refund or fulfil manually.`);
        return res.json({ received: true });
      }
      const details = session.collected_information?.shipping_details || session.shipping_details;
      updateOrder(id, {
        status: 'paid',
        paidAt: new Date().toISOString(),
        amountPaid: session.amount_total,
        stripeSessionId: session.id,
        email: session.customer_details?.email || order.email,
        shipping: details ? { ...details, phone: session.customer_details?.phone } : null,
      });
      enqueue(id);
    }
  }
  res.json({ received: true });
});

// One canonical host: send browsers on any other host for this domain (e.g. the bare domain)
// to BASE_URL's host. GET/HEAD only, so webhooks and API posts are never redirected.
const canonicalHost = new URL(config.baseUrl).hostname;
app.use((req, res, next) => {
  const host = req.hostname;
  const sameSite = host === canonicalHost.replace(/^www\./, '') || host === `www.${canonicalHost}`;
  if (sameSite && host !== canonicalHost && ['GET', 'HEAD'].includes(req.method)) {
    return res.redirect(301, `${config.baseUrl}${req.originalUrl}`);
  }
  next();
});

app.use(express.json());
app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/catalog', (req, res) => {
  res.json({
    brand: config.brandName,
    supportEmail: config.supportEmail,
    launch: launchOffer(),
    promoVideo: PROMO_VIDEO_SOURCE ? '/media/infomercial.mp4' : null,
    styles: Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, s.name])),
    products: Object.fromEntries(Object.entries(PRODUCTS).map(([k, p]) => [k, { name: p.name, price: p.price }])),
  });
});

app.post('/api/orders', upload.single('photo'), async (req, res) => {
  // Don't take money until Stripe can also tell us about it (webhook secret in place).
  if (!checkoutReady()) {
    return res.status(503).json({ error: "We're opening very soon — please check back shortly!" });
  }
  try {
    const { email, petName = '', style, product: productKey } = req.body;
    const product = PRODUCTS[productKey];
    if (!req.file) return res.status(400).json({ error: 'Please upload a JPG, PNG or WEBP photo.' });
    if (!STYLES[style] || !product) return res.status(400).json({ error: 'Pick a style and a product.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) return res.status(400).json({ error: 'Enter a valid email.' });

    const order = saveOrder({
      id: newOrderId(),
      createdAt: new Date().toISOString(),
      status: 'pending_payment',
      email: email.trim(),
      petName: cleanName(petName),
      style,
      product: productKey,
      physical: product.physical,
      photo: req.file.filename,
      photoMime: req.file.mimetype,
      source: String(req.body.source || '').slice(0, 100), // utm/ad attribution
    });

    if (config.devSkipPayment) {
      updateOrder(order.id, { status: 'paid', paidAt: new Date().toISOString(), amountPaid: 0 });
      enqueue(order.id);
      return res.json({ url: `/o/${order.id}` });
    }
    const link = linkFor(productKey);
    if (link) {
      const promo = launchOffer();
      const url = `${link}?client_reference_id=${order.id}&prefilled_email=${encodeURIComponent(order.email)}${promo ? `&prefilled_promo_code=${encodeURIComponent(promo.code)}` : ''}`;
      return res.json({ url });
    }
    const session = await createCheckoutSession({ order, product });
    updateOrder(order.id, { stripeSessionId: session.id });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong starting checkout. Please try again.' });
  }
});

const publicOrder = (o) => ({
  status: o.status,
  petName: o.petName,
  style: STYLES[o.style]?.name,
  product: PRODUCTS[o.product]?.name,
  physical: o.physical,
  images: o.images || [],
  selectedImage: o.selectedImage || null,
  rev: o.plateRev || 0, // cache-buster after a nameplate edit
  canEditName: Boolean(o.images?.length) && !['printing', 'sent_to_print', 'repainting'].includes(o.status),
  previousImages: o.previousImages || [],
  styleKey: o.style,
  repaint: repaintStatus(o),
  supportEmail: config.supportEmail,
});


app.get('/api/orders/:id', (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'not found' });
  res.json(publicOrder(order));
});

app.post('/api/orders/:id/select', async (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    await selectForPrint(order.id, String(req.body.image || ''));
    res.json(publicOrder(getOrder(order.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// One free, self-serve repaint (optionally in a different style).
app.post('/api/orders/:id/repaint', (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    requestRepaint(order.id, String(req.body.style || ''));
    res.json(publicOrder(getOrder(order.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Customer fixes the spelling (or removes) the name on the nameplate. Free and instant.
app.post('/api/orders/:id/name', async (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    await renameOrder(order.id, req.body.petName);
    res.json(publicOrder(getOrder(order.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Finished portraits. The order id is the unguessable access token (Printful also fetches from here).
app.get('/files/:id/:name', (req, res) => {
  const order = findOrder(req.params.id);
  const allowed = [...(order?.images || []), ...(order?.previousImages || []), order?.printFile].filter(Boolean);
  if (!order || !allowed.includes(req.params.name)) return res.sendStatus(404);
  res.sendFile(path.join(outputDir, order.id, req.params.name));
});

// Payment Links return here with the Checkout Session id; the webhook links it to the order.
app.get('/checkout/done', (req, res) => {
  const sessionId = String(req.query.session_id || '');
  const order = /^cs_[A-Za-z0-9_]+$/.test(sessionId) && listOrders().find((o) => o.stripeSessionId === sessionId);
  if (order) return res.redirect(`/o/${order.id}?paid=1`);
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2"><link rel="stylesheet" href="/styles.css">
<section class="block center"><div class="spinner"></div><p>Payment received — opening your gallery…</p>
<p style="color:#7d6b5a;font-size:14px">We've also emailed you a link.</p></section>`);
});

app.get('/o/:id', (req, res) => res.sendFile(path.join(publicDir, 'order.html')));

app.get('/u/:id', (req, res) => {
  const order = findOrder(req.params.id);
  if (order) updateOrder(order.id, { noMarketing: true });
  res.send('<p style="font-family:sans-serif">You are unsubscribed from marketing emails.</p>');
});

// --- Infomercial: served from the volume copy (supports range requests), else the CDN ---
app.get('/media/infomercial.mp4', (req, res) => {
  if (!PROMO_VIDEO_SOURCE) return res.status(404).end();
  if (!promoVideoCached()) return res.redirect(302, PROMO_VIDEO_SOURCE);
  res.sendFile(promoVideoPath, { maxAge: '7d', headers: { 'Content-Type': 'video/mp4' } });
});

// --- Showcase gallery (homepage, /offer) and the internal review page ---
app.get('/api/showcase', (req, res) => res.json(listShowcase()));
app.get('/showcase/:file', async (req, res) => {
  const m = /^([a-z0-9-]+?)(-before)?\.webp$/.exec(req.params.file);
  const width = [480, 900].includes(Number(req.query.w)) ? Number(req.query.w) : 900;
  const img = m && (await showcasePreview(m[1], m[2] || '', width));
  if (!img) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=86400').type('webp').send(img);
});
app.get('/samples', (req, res) => {
  const items = listShowcase()
    .map((s) => `<figure style="margin:0"><img src="/showcase/${s.key}.webp" style="width:100%;border-radius:8px"><figcaption style="text-align:center;padding:6px"><b>${s.styleName}</b> · ${s.name} · <a href="/samples/${s.key}.png">full 300 DPI</a></figcaption></figure>`)
    .join('');
  res.send(`<!doctype html><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Showcase review</title><body style="font-family:sans-serif;margin:16px;background:#fbf7f0">
<h1>Showcase (${listShowcase().length})</h1><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${items}</div>`);
});
app.get('/samples/:key.png', (req, res) => {
  const file = masterPath(req.params.key);
  if (!file || !fs.existsSync(file)) return res.sendStatus(404);
  res.sendFile(file);
});

// --- SEO surface ---
app.get('/portraits/:slug', (req, res) => {
  const html = breedPage(req.params.slug);
  html ? res.send(html) : res.sendStatus(404);
});
app.get('/gifts/:slug', (req, res) => {
  const html = occasionPage(req.params.slug);
  html ? res.send(html) : res.sendStatus(404);
});
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(sitemap()));
app.get('/robots.txt', (req, res) => res.type('text/plain').send(robots()));

// --- Owner dashboard: the ~5% that needs a human ---
const requireAdmin = (req, res, next) =>
  config.adminKey && req.query.key === config.adminKey ? next() : res.sendStatus(401);

app.get('/admin', requireAdmin, (req, res) => {
  const orders = listOrders();
  const paid = orders.filter((o) => o.paidAt);
  const revenue = paid.reduce((sum, o) => sum + (o.amountPaid || 0), 0);
  const rows = orders
    .slice(0, 200)
    .map(
      (o) => `<tr><td>${o.createdAt.slice(0, 16)}</td><td>${o.status}</td><td>${o.email}</td><td>${o.style}</td><td>${o.product}</td>
      <td>${o.source || ''}</td><td>${o.error ? `<small>${String(o.error).replace(/</g, '&lt;')}</small>` : ''}</td>
      <td><a href="/o/${o.id}" target="_blank">view</a>${['failed', 'print_failed'].includes(o.status) ? ` · <form method="post" action="/admin/retry/${o.id}?key=${encodeURIComponent(req.query.key)}" style="display:inline"><button>retry</button></form>` : ''}</td></tr>`
    )
    .join('');
  res.send(`<!doctype html><title>Admin</title><style>body{font-family:sans-serif;padding:16px}td,th{padding:4px 8px;border-bottom:1px solid #ddd;font-size:13px;text-align:left}</style>
  <h1>${config.brandName}</h1><p><strong>${paid.length}</strong> paid orders · <strong>$${(revenue / 100).toFixed(2)}</strong> revenue · ${orders.length - paid.length} unpaid</p>
  <table><tr><th>Created</th><th>Status</th><th>Email</th><th>Style</th><th>Product</th><th>Source</th><th>Error</th><th></th></tr>${rows}</table>`);
});

// Confirms each API key works without exposing it. Returns only pass/fail per service.
app.get('/admin/check', requireAdmin, async (req, res) => {
  const probe = async (url, token) => {
    if (!token) return 'not configured';
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      return r.ok ? 'ok' : `failed (HTTP ${r.status})`;
    } catch (err) {
      return `failed (${err.message})`;
    }
  };
  const [openai, resend, printful, stripe] = await Promise.all([
    probe('https://api.openai.com/v1/models', config.image.openaiKey),
    probe('https://api.resend.com/domains', config.email.resendKey),
    probe('https://api.printful.com/stores', config.printful.token),
    probe('https://api.stripe.com/v1/balance', config.stripe.secretKey),
  ]);
  res.json({ openai, resend, printful, stripe, stripeSetup: stripeSetupStatus, emailDomain: emailDomainStatus });
});

app.post('/admin/retry/:id', requireAdmin, (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.sendStatus(404);
  if (order.status === 'failed') {
    updateOrder(order.id, { status: 'paid', error: null, attempts: 0 });
    enqueue(order.id);
  } else if (order.status === 'print_failed') {
    updateOrder(order.id, { status: 'awaiting_selection', error: null });
    selectForPrint(order.id, order.selectedImage).catch(() => {});
  }
  res.redirect(`/admin?key=${encodeURIComponent(req.query.key)}`);
});

if (!fs.existsSync(path.join(publicDir, 'index.html'))) console.warn('public/index.html missing');

app.listen(config.port, () => {
  console.log(`${config.brandName} listening on ${config.baseUrl}`);
  if (config.devSkipPayment) console.warn('DEV_SKIP_PAYMENT is on — orders are not charged.');
  enhanceExistingOrders()
    .then(() => generateMissingSamples())
    .catch((err) => console.error('startup image tasks', err));
  resumePending();
  startRetryScheduler();
  startFollowupScheduler();
  startEmailDomainSetup();
  startHealthcheck();
  if (process.env.PRINTFUL_SELFTEST === 'true') setTimeout(() => runPrintfulSelftest(), 20_000);
  cachePromoVideo().catch((err) => console.error('promo video', err.message));
  setupStripe()
    .then((status) => {
      stripeSetupStatus = status;
      console.log(`Stripe setup: ${status}`);
    })
    .catch((err) => {
      stripeSetupStatus = `failed: ${err.message}`;
      alertOwner('Stripe setup failed', err.stack || err);
    });
});
