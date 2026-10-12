// Print-on-demand fulfillment. Printful prints, packs and ships; we never touch inventory.
import config from './config.js';

export async function createPrintOrder({ order, variantId, fileUrl }) {
  const s = order.shipping;
  const url = `https://api.printful.com/orders${config.printful.autoConfirm ? '?confirm=true' : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.printful.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_id: order.id.slice(0, 32),
      recipient: {
        name: s.name,
        address1: s.address.line1,
        address2: s.address.line2 || undefined,
        city: s.address.city,
        state_code: s.address.state,
        country_code: s.address.country,
        zip: s.address.postal_code,
        email: order.email,
        phone: s.phone || undefined,
      },
      items: [{ variant_id: variantId, quantity: 1, files: [{ url: fileUrl }] }],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Printful: ${body.error?.message || body.result || res.status}`);
  return body.result;
}
