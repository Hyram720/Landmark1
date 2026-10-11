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

export async function createCheckoutSession({ order, product }) {
  const params = {
    mode: 'payment',
    client_reference_id: order.id,
    customer_email: order.email,
    success_url: `${config.baseUrl}/o/${order.id}?paid=1`,
    cancel_url: `${config.baseUrl}/?canceled=1`,
    metadata: { order_id: order.id },
    payment_intent_data: { metadata: { order_id: order.id } },
    allow_promotion_codes: true,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: product.price,
          product_data: { name: `${config.brandName} — ${product.name}` },
        },
      },
    ],
  };
  if (product.physical) {
    params.shipping_address_collection = { allowed_countries: ['US', 'CA'] };
    params.phone_number_collection = { enabled: true };
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(params),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${body.error?.message || res.status}`);
  return body;
}

// Verifies the Stripe-Signature header against the raw request body.
export function verifyWebhook(rawBody, header, toleranceSec = 300) {
  if (!header) throw new Error('missing Stripe-Signature');
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i), p.slice(i + 1)];
    })
  );
  const signatures = header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  const timestamp = Number(parts.t);
  if (!timestamp || !signatures.length) throw new Error('malformed Stripe-Signature');
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) throw new Error('stale webhook');

  const expected = crypto
    .createHmac('sha256', config.stripe.webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const ok = signatures.some(
    (sig) =>
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
  if (!ok) throw new Error('bad signature');
  return JSON.parse(rawBody);
}
