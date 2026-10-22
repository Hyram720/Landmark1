// Showcase gallery: finished portraits used on the homepage and the /offer sales page, plus the
// quality-review page at /samples. Painted once on boot (missing items only); bump
// SAMPLE_VERSION to repaint everything.
//  - "order" items repaint a real customer's photo (SAMPLE_ORDER_ID, with the owner's consent).
//  - "subject" items paint AI-generated demo pets, so the gallery shows a range of breeds.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import config, { STYLES } from './config.js';
import { getOrder, uploadsDir } from './store.js';
import { paintPortrait, generatePhoto } from './generate.js';
import { applyNameplate, lookFor } from './nameplate.js';

const PHOTO = 'Realistic casual smartphone photo, natural soft daylight, sharp focus on the face, looking toward the camera, plain home background, no people, no text.';
const SUBJECTS = {
  golden: `A happy golden retriever sitting on a living room rug. ${PHOTO}`,
  blackcat: `A sleek black cat with bright green eyes sitting on a sofa. ${PHOTO}`,
  frenchie: `A fawn French bulldog with big upright ears sitting on a wooden floor. ${PHOTO}`,
  shepherd: `A black and tan German shepherd sitting in a backyard. ${PHOTO}`,
  tabby: `A fluffy orange tabby cat sitting on a windowsill. ${PHOTO}`,
  lab: `A chocolate Labrador retriever lying on a cozy blanket. ${PHOTO}`,
};

// Order: the first item of each style becomes that style's thumbnail.
export const SHOWCASE = [
  { key: 'khabba-royal', from: 'order', style: 'royal' },
  { key: 'bella-golden', subject: 'golden', style: 'royal', name: 'Bella' },
  { key: 'luna-blackcat', subject: 'blackcat', style: 'duchess', name: 'Luna' },
  { key: 'khabba-admiral', from: 'order', style: 'admiral' },
  { key: 'bruno-frenchie', subject: 'frenchie', style: 'admiral', name: 'Bruno' },
  { key: 'max-shepherd', subject: 'shepherd', style: 'astronaut', name: 'Max' },
  { key: 'khabba-duchess', from: 'order', style: 'duchess' },
  { key: 'ginger-tabby', subject: 'tabby', style: 'holiday', name: 'Ginger' },
  { key: 'daisy-lab', subject: 'lab', style: 'watercolor', name: 'Daisy' },
  { key: 'khabba-astronaut', from: 'order', style: 'astronaut' },
  { key: 'khabba-watercolor', from: 'order', style: 'watercolor' },
  { key: 'khabba-holiday', from: 'order', style: 'holiday' },
];

const version = () => (process.env.SAMPLE_VERSION || '1').replace(/[^a-z0-9-]/gi, '');
export const samplesDir = () => path.join(config.dataDir, 'samples', version());
const fileOf = (key, kind = '') => path.join(samplesDir(), `${key}${kind}.png`);

export function listShowcase() {
  return SHOWCASE.filter((s) => fs.existsSync(fileOf(s.key))).map((s) => ({
    key: s.key,
    style: s.style,
    styleName: STYLES[s.style]?.name,
    name: s.name || getOrder(process.env.SAMPLE_ORDER_ID || '')?.petName || '',
    before: fs.existsSync(fileOf(s.key, '-before')),
    real: s.from === 'order', // a real customer's pet (shown with consent) vs an AI-generated demo pet
  }));
}

async function sourcePhoto(item) {
  if (item.from === 'order') {
    const order = getOrder(process.env.SAMPLE_ORDER_ID || '');
    if (!order?.photo) return null;
    return { buffer: fs.readFileSync(path.join(uploadsDir, order.photo)), mime: order.photoMime, name: order.petName };
  }
  const cached = path.join(config.dataDir, 'samples', 'subjects', `${item.subject}.png`);
  if (!fs.existsSync(cached)) {
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, await generatePhoto(SUBJECTS[item.subject]));
  }
  return { buffer: fs.readFileSync(cached), mime: 'image/png', name: item.name };
}

export async function generateMissingSamples() {
  if (!process.env.SAMPLE_ORDER_ID) return;
  fs.mkdirSync(samplesDir(), { recursive: true });
  for (const item of SHOWCASE) {
    if (fs.existsSync(fileOf(item.key))) continue;
    try {
      const src = await sourcePhoto(item);
      if (!src) continue;
      const tmp = path.join(samplesDir(), `${item.key}-src`);
      fs.writeFileSync(tmp, src.buffer);
      const clean = await paintPortrait({ photoPath: tmp, mimeType: src.mime, style: item.style });
      fs.writeFileSync(fileOf(item.key, '-before'), await sharp(src.buffer).png().toBuffer());
      fs.writeFileSync(fileOf(item.key), await applyNameplate(clean, src.name, { look: lookFor(STYLES[item.style]) }));
      fs.rmSync(tmp, { force: true });
      console.log(`Showcase ${item.key} ready`);
    } catch (err) {
      console.error(`Showcase ${item.key} failed: ${err.message}`);
    }
  }
}

// Web-sized preview (full masters are ~10MB). kind: '' or '-before'. Cached on disk.
export async function showcasePreview(key, kind = '', width = 900) {
  if (!SHOWCASE.some((s) => s.key === key)) return null;
  const src = fileOf(key, kind);
  if (!fs.existsSync(src)) return null;
  const cache = path.join(samplesDir(), `${key}${kind}-${width}.webp`);
  if (!fs.existsSync(cache)) {
    fs.writeFileSync(cache, await sharp(src).resize(width).webp({ quality: 82 }).toBuffer());
  }
  return fs.readFileSync(cache);
}

export const masterPath = (key) => (SHOWCASE.some((s) => s.key === key) ? fileOf(key) : null);
