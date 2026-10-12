// The automation: paid order -> generate portraits -> email customer -> (customer picks) -> print & ship.
import path from 'node:path';
import config, { PRODUCTS } from './config.js';
import { getOrder, updateOrder, listOrders, uploadsDir, outputDir } from './store.js';
import { generatePortraits } from './generate.js';
import { sendEmail, alertOwner, portraitsReadyEmail } from './notify.js';
import { createPrintOrder } from './printful.js';

// Single in-process queue keeps API usage predictable and avoids double-processing.
const queue = [];
let running = false;

export function enqueue(orderId) {
  if (!queue.includes(orderId)) queue.push(orderId);
  drain();
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      await processOrder(id);
    } catch (err) {
      updateOrder(id, { status: 'failed', error: String(err.message || err) });
      await alertOwner(`Order ${id} failed`, err.stack || err);
    }
  }
  running = false;
}

async function processOrder(id) {
  const order = getOrder(id);
  if (!order || !['paid', 'generating'].includes(order.status)) return;

  updateOrder(id, { status: 'generating' });
  const images = await generatePortraits({
    photoPath: path.join(uploadsDir, order.photo),
    mimeType: order.photoMime,
    style: order.style,
    petName: order.petName,
    outDir: path.join(outputDir, id),
  });

  const done = updateOrder(id, {
    status: order.physical ? 'awaiting_selection' : 'delivered',
    images,
    error: null,
    deliveredAt: new Date().toISOString(),
  });
  await sendEmail(portraitsReadyEmail(done));
}

// Called when the customer taps "Print this one" in their gallery.
export async function selectForPrint(id, imageName) {
  const order = getOrder(id);
  if (!order || order.status !== 'awaiting_selection') throw new Error('order is not awaiting a print selection');
  if (!order.images.includes(imageName)) throw new Error('unknown image');

  const product = PRODUCTS[order.product];
  updateOrder(id, { status: 'printing', selectedImage: imageName });
  try {
    if (!config.printful.token || !product.printfulVariantId) {
      throw new Error('Printful is not configured (PRINTFUL_TOKEN / variant id)');
    }
    const result = await createPrintOrder({
      order,
      variantId: product.printfulVariantId,
      fileUrl: `${config.baseUrl}/files/${id}/${imageName}`,
    });
    updateOrder(id, { status: 'sent_to_print', printOrderId: result.id });
  } catch (err) {
    updateOrder(id, { status: 'print_failed', error: String(err.message || err) });
    await alertOwner(`Print order failed for ${id}`, err.stack || err);
  }
}

// After a restart, pick up anything that was mid-flight.
export function resumePending() {
  for (const o of listOrders()) if (['paid', 'generating'].includes(o.status)) enqueue(o.id);
}
