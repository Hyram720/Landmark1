// Minimal Printify API client (https://developers.printify.com/).
// Deliberately has NO publish call: nothing created here reaches Etsy or any sales channel.
// Products created through the API stay "unpublished" in Printify until a human clicks Publish.
import config from './config.js';

const API = 'https://api.printify.com/v1';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PrintifyError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// One request with bounded retries on rate limits (429) and server errors. The token is only
// ever sent in the Authorization header and is never logged or stored on the order.
export async function printifyRequest(method, path, body, { attempts = 4, baseDelayMs = 2000 } = {}) {
  if (!config.printify.token) throw new PrintifyError('PRINTIFY_API_TOKEN is not set');
  if (/\/(publish|publishing_succeeded|publishing_failed|send_to_production)\.json/.test(path)) {
    throw new PrintifyError(`refusing to call ${path}: this integration never publishes or sends to production`);
  }
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.printify.token}`,
          'Content-Type': 'application/json;charset=utf-8',
          'User-Agent': 'CustomPetPortraitStudio',
        },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      lastErr = new PrintifyError(`${method} ${path}: ${err.message}`);
      await sleep(baseDelayMs * 2 ** i);
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    const msg = json.error_description || json.message || json.error || '';
    lastErr = new PrintifyError(`${method} ${path}: HTTP ${res.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`.trim(), res.status);
    if (!RETRYABLE.has(res.status)) throw lastErr;
    const retryAfter = Number(res.headers.get('retry-after')) * 1000;
    await sleep(retryAfter || baseDelayMs * 2 ** i);
  }
  throw lastErr;
}

// POST /v1/uploads/images.json. Base64 keeps the customer's portrait off any public URL.
// Printify plans to drop base64 uploads over 5 MB, so callers should send compact JPEGs.
export async function uploadImage({ fileName, buffer }, opts) {
  if (buffer.length > 5 * 1024 * 1024) throw new PrintifyError(`upload ${fileName} is over 5 MB`);
  return printifyRequest('POST', '/uploads/images.json', { file_name: fileName, contents: buffer.toString('base64') }, opts);
}

export const getProduct = (shopId, productId, opts) => printifyRequest('GET', `/shops/${shopId}/products/${productId}.json`, undefined, opts);
export const createProduct = (shopId, product, opts) => printifyRequest('POST', `/shops/${shopId}/products.json`, product, opts);
export const listShops = (opts) => printifyRequest('GET', '/shops.json', undefined, opts);

// Builds a new product from an existing Printify product used as a template: same blueprint,
// print provider, enabled variants and prices, and the same position/scale/angle for the photo
// layer. Every image layer is swapped for the new upload. Pure function, unit-tested.
export function buildProductFromTemplate(template, { uploadId, title, description, tags }) {
  if (!template?.blueprint_id || !template?.print_provider_id) throw new PrintifyError('template product is missing blueprint_id/print_provider_id');
  const variants = (template.variants || [])
    .filter((v) => v.is_enabled)
    .map((v) => ({ id: v.id, price: v.price, is_enabled: true }));
  if (!variants.length) throw new PrintifyError('template product has no enabled variants');
  const enabledIds = new Set(variants.map((v) => v.id));
  const print_areas = (template.print_areas || [])
    .map((area) => ({
      variant_ids: area.variant_ids.filter((id) => enabledIds.has(id)),
      placeholders: area.placeholders
        .map((ph) => {
          const photo = (ph.images || []).find((img) => !img.type || String(img.type).startsWith('image/'));
          if (!photo) return null; // text-only or empty side: left off the new product
          return {
            position: ph.position,
            images: [{ id: uploadId, x: photo.x ?? 0.5, y: photo.y ?? 0.5, scale: photo.scale ?? 1, angle: photo.angle ?? 0 }],
          };
        })
        .filter(Boolean),
      ...(area.background ? { background: area.background } : {}),
    }))
    .filter((a) => a.variant_ids.length && a.placeholders.length);
  if (!print_areas.length) throw new PrintifyError('template product has no image print areas to copy');
  return {
    title: String(title).slice(0, 140),
    description,
    tags: (tags || []).slice(0, 13),
    blueprint_id: template.blueprint_id,
    print_provider_id: template.print_provider_id,
    variants,
    print_areas,
    // "Hide in store": if a human ever publishes this product from Printify, Printify's Etsy
    // integration sends it to Etsy as a DRAFT listing instead of an active one.
    visible: false,
  };
}

// Recommended fulfillment route (not wired to checkout yet; the site does not sell ornaments):
// POST /v1/shops/{id}/orders.json creating the product on the fly from print_areas. Printify
// holds API orders until they are sent to production, which this client never does.
export function buildOrder({ externalId, blueprintId, printProviderId, variantId, imageUrl, address, quantity = 1 }) {
  return {
    external_id: externalId,
    label: externalId.slice(0, 12),
    line_items: [{ blueprint_id: blueprintId, print_provider_id: printProviderId, variant_id: variantId, print_areas: { front: imageUrl }, quantity }],
    shipping_method: 1,
    send_shipping_notification: false,
    address_to: address,
  };
}
export const createOrder = (shopId, order, opts) => printifyRequest('POST', `/shops/${shopId}/orders.json`, order, opts);
