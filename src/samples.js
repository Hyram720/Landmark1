// Style samples: one finished portrait per style, painted from a real order's photo. Used to
// review quality after prompt changes and as ready-made marketing images. Triggered on boot by
// SAMPLE_ORDER_ID; bump SAMPLE_VERSION to repaint (each style costs one AI image).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import config, { STYLES } from './config.js';
import { getOrder, uploadsDir } from './store.js';
import { paintPortrait } from './generate.js';

const version = () => (process.env.SAMPLE_VERSION || '1').replace(/[^a-z0-9-]/gi, '');
export const samplesDir = () => path.join(config.dataDir, 'samples', version());

export function listSamples() {
  const dir = samplesDir();
  return Object.keys(STYLES).filter((k) => fs.existsSync(path.join(dir, `${k}.png`)));
}

export async function generateMissingSamples() {
  const orderId = process.env.SAMPLE_ORDER_ID;
  if (!orderId) return;
  const order = getOrder(orderId);
  if (!order?.photo) return console.warn(`SAMPLE_ORDER_ID ${orderId} has no photo`);
  fs.mkdirSync(samplesDir(), { recursive: true });
  for (const style of Object.keys(STYLES)) {
    const file = path.join(samplesDir(), `${style}.png`);
    if (fs.existsSync(file)) continue;
    try {
      const png = await paintPortrait({
        photoPath: path.join(uploadsDir, order.photo),
        mimeType: order.photoMime,
        style,
        petName: order.petName,
      });
      fs.writeFileSync(file, png);
      const meta = await sharp(png).metadata();
      console.log(`Sample ${style}: ${meta.width}x${meta.height} @ ${meta.density} DPI`);
    } catch (err) {
      console.error(`Sample ${style} failed: ${err.message}`);
    }
  }
}

// Small preview for the review page (full files are ~10MB).
export async function samplePreview(style) {
  return sharp(path.join(samplesDir(), `${style}.png`)).resize(800).jpeg({ quality: 85 }).toBuffer();
}
