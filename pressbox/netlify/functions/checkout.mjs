// POST /api/checkout  { items: [{ id, size, team?, qty }] }  ->  { url }
//
// Creates a Stripe Checkout session for the whole cart. Prices, sizes, team
// options and availability are re-checked against src/catalog.mjs so nothing
// the browser sends can change what the customer is charged.
// Needs one Netlify environment variable: STRIPE_SECRET_KEY.

import { PRODUCTS, SITE } from "../../src/catalog.mjs";

const BUNDLE_COUPON = "PRESSBOX_BUNDLE10";
const MAX_LINES = 20;
const MAX_QTY = 5;
let couponReady = false;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const cents = n => Math.round(n * 100);

async function stripe(path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || `Stripe ${path} failed`);
    err.code = data.error?.code;
    throw err;
  }
  return data;
}

async function ensureBundleCoupon() {
  if (couponReady) return;
  try {
    await stripe("coupons", {
      id: BUNDLE_COUPON,
      percent_off: String(SITE.bundlePercent),
      duration: "once",
      name: `Match Your Kicks: ${SITE.bundlePercent}% off ${SITE.bundleMinItems}+ items`
    });
  } catch (err) {
    if (err.code !== "resource_already_exists") throw err;
  }
  couponReady = true;
}

export function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0) return { error: "Your locker is empty." };
  if (items.length > MAX_LINES) return { error: "Too many different items in one order." };

  const lines = [];
  for (const item of items) {
    const p = PRODUCTS.find(x => x.id === item?.id);
    if (!p) return { error: "One of the items in your locker is no longer sold." };
    if (!p.available) return { error: `${p.name} isn't available to order yet.` };
    if (!p.sizes.includes(item.size)) return { error: `Pick a valid size for ${p.name}.` };
    if (p.teamOptions && !p.teamOptions.includes(item.team)) return { error: `Pick a team for ${p.name}.` };
    const qty = Number.parseInt(item.qty, 10);
    if (!(qty >= 1 && qty <= MAX_QTY)) return { error: `Quantity for ${p.name} must be 1–${MAX_QTY}.` };
    lines.push({ p, size: item.size, team: p.teamOptions ? item.team : null, qty });
  }

  const totalQty = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.p.price * l.qty, 0);
  const bundle = totalQty >= SITE.bundleMinItems;
  const afterDiscount = bundle ? subtotal * (1 - SITE.bundlePercent / 100) : subtotal;
  const freeShipping = afterDiscount >= SITE.freeShippingMin;
  return { lines, totalQty, subtotal, bundle, freeShipping };
}

export default async req => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(503, { error: `Online checkout isn't switched on yet. Email ${SITE.email} with your order and we'll send a payment link.` });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Bad request" });
  }

  const cart = validateCart(body.items);
  if (cart.error) return json(400, { error: cart.error });

  const base = (process.env.URL || SITE.url).replace(/\/$/, "");
  const params = {
    mode: "payment",
    success_url: `${base}/order-confirmed/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?checkout=cancelled`,
    "shipping_address_collection[allowed_countries][0]": "US",
    "phone_number_collection[enabled]": "true",
    "shipping_options[0][shipping_rate_data][type]": "fixed_amount",
    "shipping_options[0][shipping_rate_data][fixed_amount][amount]": String(cart.freeShipping ? 0 : cents(SITE.flatShipping)),
    "shipping_options[0][shipping_rate_data][fixed_amount][currency]": "usd",
    "shipping_options[0][shipping_rate_data][display_name]": cart.freeShipping ? "Free tracked shipping" : "Tracked shipping",
    "shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]": "business_day",
    "shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]": "3",
    "shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]": "business_day",
    "shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]": "8",
    "metadata[cart]": cart.lines.map(l => `${l.p.sku}|${l.size}${l.team ? `|${l.team}` : ""}|x${l.qty}`).join(", ").slice(0, 500)
  };

  cart.lines.forEach((l, i) => {
    const k = `line_items[${i}]`;
    const variant = [l.team, `Size ${l.size}`].filter(Boolean).join(" • ");
    params[`${k}[quantity]`] = String(l.qty);
    params[`${k}[price_data][currency]`] = "usd";
    params[`${k}[price_data][unit_amount]`] = String(cents(l.p.price));
    params[`${k}[price_data][product_data][name]`] = `${l.p.name} (${variant})`;
    params[`${k}[price_data][product_data][images][0]`] = SITE.url + l.p.image;
    params[`${k}[price_data][product_data][metadata][sku]`] = l.p.sku;
    params[`${k}[price_data][product_data][metadata][size]`] = l.size;
    if (l.team) params[`${k}[price_data][product_data][metadata][team]`] = l.team;
  });

  try {
    if (cart.bundle) {
      await ensureBundleCoupon();
      params["discounts[0][coupon]"] = BUNDLE_COUPON;
    }
    const session = await stripe("checkout/sessions", params);
    return json(200, { url: session.url });
  } catch (err) {
    console.error("checkout failed:", err.message);
    return json(502, { error: `Checkout couldn't start. Please try again, or email ${SITE.email}.` });
  }
};

export const config = { path: "/api/checkout" };
