// The automation: paid order -> generate portraits -> email customer -> (customer picks) -> print & ship.
import fs from 'node:fs';
import path from 'node:path';
import config, { PRODUCTS } from './config.js';
import { getOrder, updateOrder, listOrders, uploadsDir, outputDir } from './store.js';
import { generatePortraits } from './generate.js';
import { enhancePortrait, upgradeToMaster, makePrintFile, ENHANCE_ENABLED, MASTER_VERSION } from './enhance.js';
import { sendEmail, alertOwner, portraitsReadyEmail } from './notify.js';
import { createPrintOrder } from './printful.js';

// Single in-process queue keeps API usage predictable and avoids double-processing.
const queue = [];
const MAX_ATTEMPTS = 8;
const RETRY_MINUTES = 30;
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
      const attempts = (getOrder(id)?.attempts || 0) + 1;
      updateOrder(id, { status: 'failed', error: String(err.message || err), attempts, failedAt: new Date().toISOString() });
      // Alert once on the first failure and again when retries are exhausted, not on every retry.
      if (attempts === 1 || attempts === MAX_ATTEMPTS) {
        const note = attempts < MAX_ATTEMPTS ? `Will retry automatically every ${RETRY_MINUTES} min.` : 'Retries exhausted — use the retry button in /admin.';
        await alertOwner(`Order ${id} failed (attempt ${attempts})`, `${note}\n\n${err.stack || err}`);
      }
    }
  }
  running = false;
}

async function processOrder(id) {
  const order = getOrder(id);
  if (!order || !['paid', 'generating'].includes(order.status)) return;

  updateOrder(id, { status: 'generating' });
  // Reuse portraits from an earlier attempt instead of paying to paint them again.
  const outDir = path.join(outputDir, id);
  const existing = order.images?.length && order.images.every((f) => fs.existsSync(path.join(outDir, f)));
  const images = existing
    ? order.images
    : await generatePortraits({
        photoPath: path.join(uploadsDir, order.photo),
        mimeType: order.photoMime,
        style: order.style,
        petName: order.petName,
        outDir,
      });

  const done = updateOrder(id, {
    status: order.physical ? 'awaiting_selection' : 'delivered',
    images,
    enhanced: existing ? getOrder(id).enhanced : ENHANCE_ENABLED,
    master: existing ? getOrder(id).master : ENHANCE_ENABLED && MASTER_VERSION,
    error: null,
    deliveredAt: new Date().toISOString(),
  });
  // The gallery page already shows the portraits, so a failed email must not fail the order.
  try {
    await sendEmail(portraitsReadyEmail(done));
  } catch (err) {
    updateOrder(id, { emailError: String(err.message || err) });
    await alertOwner(`Delivery email failed for ${id}`, `Portraits are ready at ${config.baseUrl}/o/${id}\n\n${err.message || err}`);
  }
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
    // Exact canvas size at 300 DPI (e.g. 16x24 -> 4800x7200 px).
    const { w, h } = product.printInches;
    const printFile = `print-${w}x${h}-${imageName.replace(/\.png$/, '')}.jpg`;
    const outDir = path.join(outputDir, id);
    fs.writeFileSync(path.join(outDir, printFile), await makePrintFile(fs.readFileSync(path.join(outDir, imageName)), { w, h }));
    updateOrder(id, { printFile });
    const result = await createPrintOrder({
      order,
      variantId: product.printfulVariantId,
      fileUrl: `${config.baseUrl}/files/${id}/${printFile}`,
    });
    updateOrder(id, { status: 'sent_to_print', printOrderId: result.id });
  } catch (err) {
    updateOrder(id, { status: 'print_failed', error: String(err.message || err) });
    await alertOwner(`Print order failed for ${id}`, err.stack || err);
  }
}

// Transient failures (e.g. an empty AI credit balance) resolve on their own once fixed, so paid
// orders retry automatically instead of waiting for a human.
export function retryFailed(now = Date.now()) {
  for (const o of listOrders()) {
    if (o.status !== 'failed' || (o.attempts || 0) >= MAX_ATTEMPTS) continue;
    if (now - Date.parse(o.failedAt || o.updatedAt) < RETRY_MINUTES * 60_000) continue;
    updateOrder(o.id, { status: 'paid' });
    enqueue(o.id);
  }
}

export function startRetryScheduler() {
  setInterval(() => retryFailed(), 5 * 60_000).unref();
}

// One-time upgrade for portraits painted before enhancement existed (runs at startup).
export async function enhanceExistingOrders() {
  if (!ENHANCE_ENABLED) return;
  for (const o of listOrders()) {
    if (!o.images?.length || o.master === MASTER_VERSION) continue;
    try {
      // Never-toned images get the full treatment; already-toned ones are only resized.
      const finish = o.enhanced ? upgradeToMaster : enhancePortrait;
      for (const name of o.images) {
        const file = path.join(outputDir, o.id, name);
        if (fs.existsSync(file)) fs.writeFileSync(file, await finish(fs.readFileSync(file)));
      }
      updateOrder(o.id, { enhanced: true, master: MASTER_VERSION });
      console.log(`Upgraded portraits to ${MASTER_VERSION} for ${o.id}`);
    } catch (err) {
      console.error(`Enhancing ${o.id} failed`, err);
    }
  }
}

// After a restart, pick up anything that was mid-flight.
export function resumePending() {
  for (const o of listOrders()) if (['paid', 'generating'].includes(o.status)) enqueue(o.id);
}
