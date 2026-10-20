import express from 'express';
import multer from 'multer';
import config from './config.js';
import { newScanId, getScan, saveScan, updateScan, listScans } from './store.js';
import { scanFiles, summarize, fixPrompt } from './scanner.js';
import { parseGithubUrl, fetchGithubZip, filesFromZip } from './intake.js';
import { createCheckoutSession, verifyWebhook } from './stripe.js';
import { sendEmail, alertOwner, reportReadyEmail } from './notify.js';

const app = express();
app.set('trust proxy', true);
const publicDir = new URL('../public', import.meta.url).pathname;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.limits.archiveBytes, files: 1 } });

const findScan = (id) => {
  try {
    return getScan(id);
  } catch {
    return null;
  }
};

async function unlock(scan, patch) {
  const updated = updateScan(scan.id, { ...patch, paid: true, paidAt: new Date().toISOString() });
  if (updated.email) await sendEmail(reportReadyEmail(updated)).catch((e) => alertOwner('Report email failed', `${scan.id}: ${e.message}`));
  return updated;
}

// Stripe needs the raw body for signature verification, so this route comes before json().
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = verifyWebhook(req.body.toString('utf8'), req.get('stripe-signature'));
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const scan = findScan(session.metadata?.scan_id || session.client_reference_id || '');
    if (scan && !scan.paid && session.payment_status === 'paid') {
      await unlock(scan, { email: session.customer_details?.email || scan.email, amountPaid: session.amount_total, stripeSessionId: session.id });
    }
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/r/:id', (req, res) => res.sendFile(`${publicDir}/report.html`));

// Free scans are cheap but not free to run; cap each visitor at a handful per hour.
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many scans from your network. Try again in an hour.' });
  hits.set(req.ip, [...recent, now]);
  next();
}

app.post('/api/scan', rateLimit, upload.single('archive'), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().slice(0, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address looks off.');
    let zip;
    let source;
    if (req.file) {
      zip = req.file.buffer;
      source = { type: 'upload', name: req.file.originalname.slice(0, 120) };
    } else {
      const repo = parseGithubUrl(req.body.repoUrl);
      if (!repo) throw new Error('Paste a GitHub link like https://github.com/you/your-app, or upload a .zip.');
      zip = await fetchGithubZip(repo);
      source = { type: 'github', name: `${repo.owner}/${repo.repo}` };
    }
    const files = filesFromZip(zip);
    if (!files.length) throw new Error('No source files found to scan.');
    const findings = scanFiles(files);
    const scan = saveScan({
      id: newScanId(),
      createdAt: new Date().toISOString(),
      email,
      source,
      filesScanned: files.length,
      summary: summarize(findings),
      findings,
      paid: false,
    });
    console.log(`[scan] ${scan.id} ${source.type}:${source.name} files=${files.length} findings=${findings.length}`);
    res.json({ id: scan.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// The free preview names each problem; where it is and how to fix it are in the paid report.
app.get('/api/scan/:id', (req, res) => {
  const scan = findScan(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Report not found' });
  const unlocked = scan.paid || config.devSkipPayment;
  res.json({
    id: scan.id,
    brand: config.brandName,
    price: config.price,
    source: scan.source,
    createdAt: scan.createdAt,
    filesScanned: scan.filesScanned,
    summary: scan.summary,
    unlocked,
    findings: scan.findings.map((f) =>
      unlocked ? { ...f, prompt: fixPrompt(f) } : { severity: f.severity, title: f.title }
    ),
  });
});

app.post('/api/scan/:id/checkout', async (req, res) => {
  const scan = findScan(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Report not found' });
  if (scan.paid) return res.json({ url: `/r/${scan.id}` });
  try {
    if (config.devSkipPayment) {
      await unlock(scan, { amountPaid: 0 });
      return res.json({ url: `/r/${scan.id}?paid=1` });
    }
    if (!config.stripe.secretKey) throw new Error('Checkout is not configured yet.');
    const session = await createCheckoutSession(scan);
    res.json({ url: session.url });
  } catch (err) {
    alertOwner('Checkout failed', `${scan.id}: ${err.message}`);
    res.status(500).json({ error: 'Checkout is unavailable right now. Please try again shortly.' });
  }
});

app.get('/admin', (req, res) => {
  if (!config.adminKey || req.query.key !== config.adminKey) return res.status(401).send('unauthorized');
  const scans = listScans();
  const paid = scans.filter((s) => s.paid);
  res.json({
    scans: scans.length,
    paid: paid.length,
    conversion: scans.length ? `${((paid.length / scans.length) * 100).toFixed(1)}%` : '0%',
    revenue: `$${(paid.reduce((n, s) => n + (s.amountPaid || 0), 0) / 100).toFixed(2)}`,
    recent: scans.slice(0, 50).map((s) => ({ id: s.id, at: s.createdAt, source: s.source, issues: s.summary.total, score: s.summary.score, paid: s.paid })),
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload rejected: ${err.message}` });
  next(err);
});

app.listen(config.port, () => {
  console.log(`${config.brandName} on ${config.baseUrl}${config.devSkipPayment ? ' (payments skipped)' : ''}`);
  if (!config.devSkipPayment && !(config.stripe.secretKey && config.stripe.webhookSecret)) {
    console.warn('Stripe is not fully configured: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
  }
});
