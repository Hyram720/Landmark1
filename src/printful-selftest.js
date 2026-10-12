// One-time end-to-end check of the Printful connection, run on the server so the token never
// leaves it. Enable with PRINTFUL_SELFTEST=true: it creates a DRAFT order (never charged or
// shipped), reads it back, logs costs and any file/address problems, then deletes the draft.
import config, { PRODUCTS } from './config.js';

const pf = async (method, path, body) => {
  const res = await fetch(`https://api.printful.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.printful.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${json.error?.message || json.result || ''}`);
  return json.result;
};

export async function runPrintfulSelftest() {
  const log = (msg) => console.log(`Printful self-test: ${msg}`);
  if (!config.printful.token) return log('FAILED - no PRINTFUL_TOKEN');
  let draftId;
  try {
    const stores = await pf('GET', '/stores');
    log(`token ok, stores: ${stores.map((s) => `${s.name} (${s.type})`).join(', ')}`);
    const product = PRODUCTS.canvas_small;
    draftId = (
      await pf('POST', '/orders', {
        external_id: `selftest${Date.now()}`,
        recipient: { name: 'Self Test', address1: '1600 Pennsylvania Ave NW', city: 'Washington', state_code: 'DC', country_code: 'US', zip: '20500' },
        items: [{ variant_id: product.printfulVariantId, quantity: 1, files: [{ url: `${config.baseUrl}/samples/khabba-royal.png` }] }],
      })
    ).id;
    await new Promise((r) => setTimeout(r, 8000)); // let Printful fetch the print file
    const o = await pf('GET', `/orders/${draftId}`);
    const file = o.items?.[0]?.files?.[0];
    log(`draft order ${draftId} created: status=${o.status}, item cost=$${o.costs?.subtotal}, shipping=$${o.costs?.shipping}, tax=$${o.costs?.tax}, total=$${o.costs?.total}; file status=${file?.status} (${file?.width}x${file?.height})`);
    log('RESULT OK - canvas orders can be placed');
  } catch (err) {
    log(`FAILED - ${err.message}`);
  } finally {
    if (draftId) {
      await pf('DELETE', `/orders/${draftId}`)
        .then(() => log(`draft ${draftId} deleted`))
        .catch((e) => log(`could not delete draft ${draftId}: ${e.message}`));
    }
  }
}
