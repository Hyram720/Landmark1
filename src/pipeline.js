// The automation: paid order -> generate portraits -> email customer -> (customer picks) -> print & ship.
import fs from 'node:fs';
import path from 'node:path';
import config, { PRODUCTS, STYLES } from './config.js';
import { getOrder, updateOrder, listOrders, uploadsDir, outputDir } from './store.js';
import { generatePortraits } from './generate.js';
import { applyNameplate, cleanName, lookFor } from './nameplate.js';
import { enhancePortrait, upgradeToMaster, makePrintFile, ENHANCE_ENABLED, MASTER_VERSION } from './enhance.js';
import { sendEmail, alertOwner, portraitsReadyEmail } from './notify.js';
import { createPrintOrder } from './printful.js';
import { pushOrderToPrintify } from './printify-pipeline.js';

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
  if (order?.status === 'repainting') return processRepaint(order);
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
    nameplate: existing ? getOrder(id).nameplate : 'code',
    error: null,
    deliveredAt: new Date().toISOString(),
  });
  // Optional: copy the finished portrait into an unpublished Printify product. Off unless
  // PRINTIFY_PIPELINE_ENABLED=true; runs in the background and can never fail the order.
  if (config.printify.enabled) {
    pushOrderToPrintify(id).catch((err) => console.error(`Printify push for ${id}`, err.message));
  }
  // The gallery page already shows the portraits, so a failed email must not fail the order.
  if (!done.email) return; // Etsy orders: the gallery link goes to the buyer via Etsy messages
  try {
    await sendEmail(portraitsReadyEmail(done));
  } catch (err) {
    updateOrder(id, { emailError: String(err.message || err) });
    await alertOwner(`Delivery email failed for ${id}`, `Portraits are ready at ${config.baseUrl}/o/${id}\n\n${err.message || err}`);
  }
}

// --- One free repaint per order: self-serve from the gallery, no human involved ---
// Allowed once, within config.repaintDays of delivery, and only before anything is printed.
export function repaintStatus(order) {
  if (!order?.images?.length || !['delivered', 'awaiting_selection'].includes(order.status)) return { allowed: false };
  if (order.repaintedAt || order.repaint) return { allowed: false, used: true };
  const until = Date.parse(order.deliveredAt || order.updatedAt) + config.repaintDays * 86400_000;
  if (Date.now() > until) return { allowed: false, expired: true };
  return { allowed: true, until: new Date(until).toISOString() };
}

export function requestRepaint(id, styleKey) {
  const order = getOrder(id);
  if (!repaintStatus(order).allowed) throw new Error('This order has already used its free repaint, or the repaint window has passed.');
  const style = styleKey && STYLES[styleKey] ? styleKey : order.style;
  updateOrder(id, { status: 'repainting', repaint: { style, requestedAt: new Date().toISOString(), returnStatus: order.status } });
  enqueue(id);
}

async function processRepaint(order) {
  const { style, returnStatus } = order.repaint;
  const outDir = path.join(outputDir, order.id);
  const images = await generatePortraits({
    photoPath: path.join(uploadsDir, order.photo),
    mimeType: order.photoMime,
    style,
    petName: order.petName,
    outDir,
    prefix: 'repaint',
  });
  const done = updateOrder(order.id, {
    status: returnStatus,
    style,
    previousImages: order.images, // the first set stays downloadable
    images,
    repaintedAt: new Date().toISOString(),
    plateRev: (order.plateRev || 0) + 1,
    error: null,
  });
  if (!done.email) return;
  try {
    await sendEmail(portraitsReadyEmail(done, { repaint: true }));
  } catch (err) {
    updateOrder(order.id, { emailError: String(err.message || err) });
  }
}

// Called when the customer taps "Print this one" in their gallery.
export async function selectForPrint(id, imageName) {
  const order = getOrder(id);
  if (!order || order.status !== 'awaiting_selection') throw new Error('order is not awaiting a print selection');
  if (![...order.images, ...(order.previousImages || [])].includes(imageName)) throw new Error('unknown image');

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
    updateOrder(o.id, { status: o.repaint && !o.repaintedAt ? 'repainting' : 'paid' });
    enqueue(o.id);
  }
}

export function startRetryScheduler() {
  setInterval(() => retryFailed(), 5 * 60_000).unref();
}

// Re-renders the nameplate on every portrait from the unlettered masters. No AI cost, ~1s.
// Orders painted before code-drawn nameplates have no clean/ copy: their current image becomes
// the base and the new plate is drawn over the AI's (possibly misspelled) one.
export async function renameOrder(id, rawName) {
  const order = getOrder(id);
  if (!order?.images?.length) throw new Error('no portraits yet');
  if (['printing', 'sent_to_print'].includes(order.status)) throw new Error('the canvas is already in production');
  if (order.status === 'repainting') throw new Error('please wait until your repaint is finished');
  const petName = cleanName(rawName);
  const outDir = path.join(outputDir, id);
  fs.mkdirSync(path.join(outDir, 'clean'), { recursive: true });
  for (const name of [...order.images, ...(order.previousImages || [])]) {
    const cleanFile = path.join(outDir, 'clean', name);
    if (!fs.existsSync(cleanFile)) fs.copyFileSync(path.join(outDir, name), cleanFile);
    fs.writeFileSync(path.join(outDir, name), await applyNameplate(fs.readFileSync(cleanFile), petName, { look: lookFor(STYLES[order.style]) }));
  }
  return updateOrder(id, { petName, plateRev: (order.plateRev || 0) + 1, nameplate: 'code' });
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
  // Replace AI-painted (possibly misspelled) nameplates with code-drawn ones.
  for (const o of listOrders()) {
    if (o.nameplate === 'code' || !o.images?.length || !o.petName) continue;
    if (['printing', 'sent_to_print'].includes(o.status)) continue;
    try {
      await renameOrder(o.id, o.petName);
      console.log(`Redrew nameplate for ${o.id}`);
    } catch (err) {
      console.error(`Nameplate for ${o.id} failed`, err);
    }
  }
}

// After a restart, pick up anything that was mid-flight.
export function resumePending() {
  for (const o of listOrders()) if (['paid', 'generating', 'repainting'].includes(o.status)) enqueue(o.id);
}
