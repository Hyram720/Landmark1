// Finished portrait -> unpublished Printify product (Etsy-connected store), behind a feature flag.
//
// Flow: crop the chosen portrait to a square ornament file -> upload to Printify -> read the
// template product (the ornament drafts already set up in Printify) -> create a copy with the new
// image, a pet-specific title, the listing description and the 13 Etsy tags -> record the result
// on the order. It never calls publish, so nothing appears on Etsy until a human publishes it in
// Printify (and the product is created with "Hide in store", so even that lands as an Etsy draft).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import config from './config.js';
import { getOrder, updateOrder, outputDir } from './store.js';
import { uploadImage, getProduct, createProduct, buildProductFromTemplate } from './printify.js';
import { alertOwner } from './notify.js';

// Copy from the Etsy listing package (listings 01 and 02). Tags: 13, each <= 20 characters.
export const TEMPLATES = {
  ceramic: {
    title: (pet) => `${pet} Custom Pet Photo Ornament, Personalized Christmas Keepsake, 2-Sided Ceramic`,
    tags: ['pet photo ornament', 'custom pet ornament', 'dog photo ornament', 'cat photo ornament', 'dog christmas gift', 'personalized pet', 'ornament with photo', 'first christmas dog', 'dog mom gift', 'pet lover gift', 'christmas 2026', 'stocking stuffer', 'ceramic ornament'],
    description:
      "A keepsake ornament with your own pet's portrait. Printed on both sides of a glazed ceramic ornament, so it looks finished from every angle on the tree.\n\nMade to order and checked by hand before printing.\n\nDesigned by me, SunCustomDesigns. Printed and shipped by my production partner Printify.",
  },
  metal: {
    title: (pet) => `${pet} Pet Memorial Ornament with Photo, Custom Remembrance Christmas Ornament`,
    tags: ['pet memorial', 'pet loss gift', 'dog memorial gift', 'cat memorial gift', 'rainbow bridge', 'pet sympathy gift', 'memorial ornament', 'in loving memory pet', 'pet remembrance', 'loss of dog gift', 'dog angel ornament', 'christmas in heaven', 'photo memorial'],
    description:
      "A gentle way to keep them on the tree this year. Your pet's portrait on lightweight aluminum that will not shatter.\n\nMade to order and checked by hand before printing.\n\nDesigned by me, SunCustomDesigns. Printed and shipped by my production partner Printify.",
  },
};

export const printifyReady = () => config.printify.enabled && Boolean(config.printify.token && config.printify.shopId);

// Ornaments are round or square: crop the 2:3 portrait to a square around the most salient
// region (the pet's face), 2400x2400 px, as a compact JPEG well under Printify's 5 MB base64 cap.
export async function makeOrnamentFile(input) {
  return sharp(input)
    .resize(2400, 2400, { fit: 'cover', position: sharp.strategy.attention, kernel: 'lanczos3' })
    .withMetadata({ density: 300 })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

// Idempotent: templates that already have a product on this order are skipped, so a retry only
// redoes what failed. Errors are recorded on the order and never thrown into the order pipeline.
export async function pushOrderToPrintify(orderId, { imageName, force = false } = {}) {
  if (!force && !config.printify.enabled) return { skipped: 'PRINTIFY_PIPELINE_ENABLED is not true' };
  if (!config.printify.token || !config.printify.shopId) {
    const note = 'Printify is not configured (PRINTIFY_API_TOKEN / PRINTIFY_SHOP_ID)';
    updateOrder(orderId, { printify: { ...(getOrder(orderId)?.printify || {}), status: 'not_configured', error: note } });
    return { skipped: note };
  }
  const order = getOrder(orderId);
  if (!order?.images?.length) return { skipped: 'no portraits yet' };
  const image = imageName || order.selectedImage || order.images[0];
  if (![...order.images, ...(order.previousImages || [])].includes(image)) throw new Error('unknown image');

  const state = { ...(order.printify || {}), status: 'working', image, error: null, products: { ...(order.printify?.products || {}) } };
  if (state.image !== order.printify?.image) state.uploadId = null; // new picture -> new upload
  updateOrder(orderId, { printify: state });

  const pet = (order.petName || 'Your Pet').slice(0, 30);
  const errors = [];
  try {
    if (!state.uploadId) {
      const file = await makeOrnamentFile(fs.readFileSync(path.join(outputDir, orderId, image)));
      const upload = await uploadImage({ fileName: `order-${orderId.slice(0, 8)}-${image.replace(/\.\w+$/, '')}.jpg`, buffer: file });
      state.uploadId = upload.id;
      state.uploadSize = `${upload.width}x${upload.height}`;
    }
    for (const key of config.printify.templates) {
      const tpl = TEMPLATES[key];
      const templateId = config.printify.templateIds[key];
      if (!tpl || !templateId) {
        errors.push(`${key}: unknown template`);
        continue;
      }
      if (state.products[key]?.image === image && state.products[key]?.productId) continue;
      try {
        const template = await getProduct(config.printify.shopId, templateId);
        const body = buildProductFromTemplate(template, {
          uploadId: state.uploadId,
          title: tpl.title(pet),
          description: tpl.description,
          tags: tpl.tags,
        });
        const created = await createProduct(config.printify.shopId, body);
        state.products[key] = {
          productId: created.id,
          image,
          templateId,
          tags: body.tags.length,
          url: `https://printify.com/app/product-details/${created.id}`,
          createdAt: new Date().toISOString(),
          published: false,
        };
      } catch (err) {
        errors.push(`${key}: ${err.message}`);
      }
      updateOrder(orderId, { printify: state });
    }
  } catch (err) {
    errors.push(err.message);
  }
  state.status = errors.length ? 'failed' : 'created';
  state.error = errors.join('; ') || null;
  state.attempts = (order.printify?.attempts || 0) + 1;
  state.updatedAt = new Date().toISOString();
  updateOrder(orderId, { printify: state });
  if (errors.length) {
    await alertOwner(`Printify product creation failed for ${orderId}`, `${state.error}\n\nRetry from /admin. Nothing was published.`).catch(() => {});
  }
  return state;
}
