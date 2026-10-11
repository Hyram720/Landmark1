import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import config, { STYLES, PRODUCTS } from './config.js';
import { newOrderId, getOrder, saveOrder, updateOrder, listOrders, uploadsDir, outputDir } from './store.js';
import { createCheckoutSession, verifyWebhook } from './stripe.js';
import { enqueue, selectForPrint, resumePending } from './pipeline.js';
import { breedPage, occasionPage, sitemap, robots } from './seo.js';
import { startFollowupScheduler } from './followups.js';

const app = express();
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
    const id = session.metadata?.order_id;
    const order = id && getOrder(id);
    if (order && order.status === 'pending_payment' && session.payment_status === 'paid') {
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

app.use(express.json());
app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/catalog', (req, res) => {
  res.json({
    brand: config.brandName,
    styles: Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, s.name])),
    products: Object.fromEntries(Object.entries(PRODUCTS).map(([k, p]) => [k, { name: p.name, price: p.price }])),
  });
});

app.post('/api/orders', upload.single('photo'), async (req, res) => {
  if (!config.devSkipPayment && !config.stripe.secretKey) {
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
      petName: petName.trim().slice(0, 40),
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
});

const findOrder = (id) => {
  try {
    return getOrder(id);
  } catch {
    return null;
  }
};

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

// Finished portraits. The order id is the unguessable access token (Printful also fetches from here).
app.get('/files/:id/:name', (req, res) => {
  const order = findOrder(req.params.id);
  if (!order || !(order.images || []).includes(req.params.name)) return res.sendStatus(404);
  res.sendFile(path.join(outputDir, order.id, req.params.name));
});

app.get('/o/:id', (req, res) => res.sendFile(path.join(publicDir, 'order.html')));

app.get('/u/:id', (req, res) => {
  const order = findOrder(req.params.id);
  if (order) updateOrder(order.id, { noMarketing: true });
  res.send('<p style="font-family:sans-serif">You are unsubscribed from marketing emails.</p>');
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

app.post('/admin/retry/:id', requireAdmin, (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.sendStatus(404);
  if (order.status === 'failed') {
    updateOrder(order.id, { status: 'paid', error: null });
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
  resumePending();
  startFollowupScheduler();
});
