// Stripe via the REST API directly (no SDK): Checkout Session creation + webhook verification.
import crypto from 'node:crypto';
import config from './config.js';

// Flattens nested objects into Stripe's form encoding: a[b][0][c]=v
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') formEncode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

export async function stripeRequest(method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: params ? formEncode(params) : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${body.error?.message || res.status}`);
  return body;
}

export async function createCheckoutSession(scan) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    client_reference_id: scan.id,
    customer_email: scan.email || undefined,
    success_url: `${config.baseUrl}/r/${scan.id}?paid=1`,
    cancel_url: `${config.baseUrl}/r/${scan.id}`,
    metadata: { scan_id: scan.id },
    allow_promotion_codes: true,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: config.price,
          product_data: { name: `${config.brandName} full report + fix prompts` },
        },
      },
    ],
  });
}

// Verifies the Stripe-Signature header against the raw request body.
export function verifyWebhook(rawBody, header, toleranceSec = 300) {
  if (!header) throw new Error('missing Stripe-Signature');
  const timestamp = Number(header.match(/(?:^|,)t=(\d+)/)?.[1]);
  const signatures = header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  if (!timestamp || !signatures.length) throw new Error('malformed Stripe-Signature');
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) throw new Error('stale webhook');

  const expected = crypto
    .createHmac('sha256', config.stripe.webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const ok = signatures.some(
    (sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
  if (!ok) throw new Error('bad signature');
  return JSON.parse(rawBody);
}
