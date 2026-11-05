// Read-only Printful launch preflight. Never places, confirms, or deletes orders.
// Logs only token validity, store count, and whether configured canvas variants exist.
import config, { PRODUCTS } from './config.js';

async function getPrintful(path) {
  const response = await fetch(`https://api.printful.com${path}`, {
    headers: { Authorization: `Bearer ${config.printful.token}` },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(payload.error?.message || 'request failed').slice(0, 180)}`);
  return payload.result;
}

export async function runPrintfulPreflight() {
  const log = (message) => console.log(`Printful preflight: ${message}`);
  if (!config.printful.token) return log('BLOCKED: token missing');
  try {
    const stores = await getPrintful('/stores');
    log(`API authentication OK; connected stores: ${Array.isArray(stores) ? stores.length : 'unknown'}`);
  } catch (error) {
    log(`BLOCKED: API/store check failed: ${error.message}`);
    return;
  }
  for (const [key, product] of Object.entries(PRODUCTS)) {
    if (!product.physical) continue;
    if (!Number.isInteger(product.printfulVariantId) || product.printfulVariantId <= 0) {
      log(`BLOCKED: ${key} invalid variant ID`);
      continue;
    }
    try {
      const variant = await getPrintful(`/products/variant/${product.printfulVariantId}`);
      const found = Number(variant?.variant?.id ?? variant?.id) === product.printfulVariantId;
      log(`${key}: ${found ? 'variant confirmed in Printful catalog' : 'BLOCKED: variant mismatch'} (ID ${product.printfulVariantId})`);
    } catch (error) {
      log(`${key}: BLOCKED: lookup failed for variant ${product.printfulVariantId}: ${error.message}`);
    }
  }
  log('Catalog checks do not verify Etsy synchronization, image sharpness, artwork placement, or order readiness.');
}
