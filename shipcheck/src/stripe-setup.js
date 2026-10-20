// Stripe setup that runs on every boot and is safe to repeat:
//  - creates (or replaces) the webhook endpoint for BASE_URL and stores its signing secret
//  - creates the recovery promotion code used by the follow-up email
// With this, the only Stripe value the owner provides is STRIPE_SECRET_KEY.
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { stripeRequest, STRIPE_API_VERSION } from './stripe.js';

const APP_TAG = 'shipcheck';
const secretFile = path.join(config.dataDir, 'stripe-webhook.json');

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
    description: `${config.brandName} reports`,
    metadata: { app: APP_TAG },
  });
  fs.writeFileSync(secretFile, JSON.stringify({ id: created.id, url, secret: created.secret }), { mode: 0o600 });
  config.stripe.webhookSecret = created.secret;
  return `webhook created (${url})`;
}

async function ensureRecoveryCode() {
  const { code, percentOff } = config.recovery;
  try {
    await stripeRequest('GET', `/coupons/${encodeURIComponent(code)}`);
  } catch (err) {
    if (err.code !== 'resource_missing') throw err;
    await stripeRequest('POST', '/coupons', { id: code, percent_off: percentOff, duration: 'once', name: `Recovery ${percentOff}% off` });
  }
  const { data } = await stripeRequest('GET', `/promotion_codes?code=${encodeURIComponent(code)}&limit=1`);
  if (data.length) return `${code} ok`;
  await stripeRequest('POST', '/promotion_codes', { coupon: code, code });
  return `${code} created`;
}

export async function setupStripe() {
  if (!config.stripe.secretKey) return 'Stripe not configured';
  return `${await ensureWebhook()}; ${await ensureRecoveryCode()}`;
}
