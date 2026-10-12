// One-time Stripe setup that runs on every boot and is safe to repeat:
//  - creates (or replaces) the webhook endpoint for BASE_URL and stores its signing secret
//  - creates the recovery and referral coupons + promotion codes used by the follow-up emails
// With this, the only Stripe value the owner provides is STRIPE_SECRET_KEY.
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { stripeRequest, STRIPE_API_VERSION } from './stripe.js';

const APP_TAG = 'custom-pet-portrait-studio';
const secretFile = path.join(config.dataDir, 'stripe-webhook.json');

const DISCOUNTS = [
  { code: process.env.RECOVERY_CODE || 'COMEBACK15', percentOff: 15, name: 'Abandoned checkout 15% off' },
  { code: process.env.REFERRAL_CODE || 'FRIEND20', percentOff: 20, name: 'Friend referral 20% off' },
];

function readStored() {
  try {
    return JSON.parse(fs.readFileSync(secretFile, 'utf8'));
  } catch {
    return null;
  }
}

async function ensureWebhook() {
  // An explicitly configured secret wins (e.g. an endpoint created by hand in the dashboard).
  if (process.env.STRIPE_WEBHOOK_SECRET) return 'using STRIPE_WEBHOOK_SECRET';

  const url = `${config.baseUrl}/webhooks/stripe`;
  const stored = readStored();
  const { data: endpoints } = await stripeRequest('GET', '/webhook_endpoints?limit=100');
  const ours = endpoints.filter((e) => e.metadata?.app === APP_TAG);

  const current = ours.find((e) => e.url === url && e.status === 'enabled');
  if (current && stored?.id === current.id) {
    config.stripe.webhookSecret = stored.secret;
    return `webhook ok (${url})`;
  }

  // Remove stale endpoints (old domain, or one whose secret we no longer have).
  for (const e of ours) await stripeRequest('DELETE', `/webhook_endpoints/${e.id}`);

  const created = await stripeRequest('POST', '/webhook_endpoints', {
    url,
    enabled_events: ['checkout.session.completed'],
    api_version: STRIPE_API_VERSION,
    description: `${config.brandName} orders`,
    metadata: { app: APP_TAG },
  });
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(secretFile, JSON.stringify({ id: created.id, url, secret: created.secret }), { mode: 0o600 });
  config.stripe.webhookSecret = created.secret;
  return `webhook created (${url})`;
}

async function ensureDiscounts() {
  const results = [];
  for (const d of DISCOUNTS) {
    try {
      await stripeRequest('GET', `/coupons/${encodeURIComponent(d.code)}`);
    } catch (err) {
      if (err.code !== 'resource_missing') throw err;
      await stripeRequest('POST', '/coupons', { id: d.code, percent_off: d.percentOff, duration: 'once', name: d.name });
    }
    const { data } = await stripeRequest('GET', `/promotion_codes?code=${encodeURIComponent(d.code)}&limit=1`);
    if (!data.length) {
      await stripeRequest('POST', '/promotion_codes', { coupon: d.code, code: d.code });
      results.push(`${d.code} created`);
    } else {
      results.push(`${d.code} ok`);
    }
  }
  return results.join(', ');
}

export async function setupStripe() {
  if (!config.stripe.secretKey) return 'Stripe not configured';
  const webhook = await ensureWebhook();
  const discounts = await ensureDiscounts();
  return `${webhook}; ${discounts}`;
}
