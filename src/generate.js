// Turns the customer's pet photo into styled portraits.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import config, { STYLES } from './config.js';
import { enhancePortrait } from './enhance.js';
import { applyNameplate, lookFor } from './nameplate.js';
import { kreaEdit } from './krea.js';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';

const markFont = opentype.loadSync(createRequire(import.meta.url).resolve('@fontsource/cinzel/files/cinzel-latin-700-normal.woff'));

// Appended to every style: keeps portraits bright and sharp instead of murky old-master darkness.
const QUALITY = ' Lighting: bright, warm, even light on the face and fur; the pet is clearly lit and the brightest part of the image. Crisp fine detail, sharp focus on the eyes, rich but not dark colors, no murky shadows. Ultra high detail.';

async function generateOpenAI(photoPath, mimeType, prompt) {
  const form = new FormData();
  form.append('model', config.image.model);
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', 'high');
  form.append('n', '1');
  form.append(
    'image',
    new Blob([fs.readFileSync(photoPath)], { type: mimeType }),
    path.basename(photoPath)
  );

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.image.openaiKey}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI: ${body.error?.message || res.status}`);
  return Buffer.from(body.data[0].b64_json, 'base64');
}

// Text-to-image, used only to create demo pet "customer photos" for the showcase gallery.
export async function generatePhoto(prompt) {
  if (config.image.provider === 'mock') {
    return sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#c9a46b' } }).png().toBuffer();
  }
  if (config.image.provider === 'krea') {
    return withRetry(() => kreaEdit({ prompt, thinkingMode: 'fast' }));
  }
  return withRetry(async () => {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.image.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.image.model, prompt, size: '1024x1536', quality: 'high', n: 1 }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`OpenAI: ${body.error?.message || res.status}`);
    return Buffer.from(body.data[0].b64_json, 'base64');
  });
}

// Retries transient failures (rate limits, timeouts) with backoff.
async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

// Paints one finished (enhanced, 300 DPI) portrait with no lettering and returns the PNG buffer.
export async function paintPortrait({ photoPath, mimeType, style, variant = 1 }) {
  const styleDef = STYLES[style];
  if (!styleDef) throw new Error(`unknown style ${style}`);
  // No lettering from the AI: models misspell names. The nameplate is added by code afterwards.
  const prompt = `${styleDef.prompt}${QUALITY} Variation ${variant}: vary the pose, framing and background details slightly. Do not include any text, letters, numbers, signatures, labels or nameplates anywhere in the image; keep the bottom edge of the painting simple.`;
  return enhancePortrait(await paintRaw({ photoPath, mimeType, prompt }), { tone: styleDef.tone });
}

// One un-finished image from the configured provider.
async function paintRaw({ photoPath, mimeType, prompt }) {
  if (config.image.provider === 'mock') return fs.readFileSync(photoPath);
  if (config.image.provider === 'krea') return withRetry(() => kreaEdit({ photoPath, mimeType, prompt }));
  return withRetry(() => generateOpenAI(photoPath, mimeType, prompt));
}

// Cheap, small, watermarked preview shown before checkout (Krea 3 at 1K, fast mode).
export async function paintPreview({ photoPath, mimeType, style }) {
  const styleDef = STYLES[style];
  if (!styleDef) throw new Error(`unknown style ${style}`);
  const prompt = `${styleDef.prompt}${QUALITY} Do not include any text, letters, numbers, signatures, labels or nameplates anywhere in the image.`;
  const raw =
    config.image.provider === 'krea'
      ? await kreaEdit({ photoPath, mimeType, prompt, resolution: '1K', thinkingMode: 'fast', timeoutMs: 90_000 })
      : fs.readFileSync(photoPath); // mock mode: the photo itself
  return watermark(raw);
}

// 640x960, diagonal repeating "PREVIEW" marks: good enough to judge likeness, not to print.
// The word is drawn as vector outlines from the bundled font, so no system fonts are needed.
const MARK = markFont.getPath('PREVIEW', 0, 0, 46).toPathData(1);
async function watermark(input) {
  const marks = [];
  for (let y = -200; y < 1300; y += 190) for (let x = -300; x < 900; x += 330) marks.push(`<path transform="translate(${x + ((y / 190) % 2) * 165} ${y})" d="${MARK}"/>`);
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960">
      <g transform="rotate(-30 320 480)" fill="#ffffff" fill-opacity="0.4" stroke="#000000" stroke-opacity="0.2" stroke-width="1">${marks.join('')}</g>
    </svg>`
  );
  return sharp(input).rotate().resize({ width: 640, height: 960, fit: 'cover' }).composite([{ input: overlay }]).jpeg({ quality: 78 }).toBuffer();
}

// Writes N variants to outDir and returns their filenames.
export async function generatePortraits({ photoPath, mimeType, style, petName, outDir, prefix = 'portrait' }) {
  fs.mkdirSync(outDir, { recursive: true });
  // clean/ keeps the unlettered master so the nameplate can be re-rendered if the name changes.
  fs.mkdirSync(path.join(outDir, 'clean'), { recursive: true });
  const finish = async (i) => {
    const clean = await paintPortrait({ photoPath, mimeType, style, variant: i });
    const name = `${prefix}-${i}.png`;
    fs.writeFileSync(path.join(outDir, 'clean', name), clean);
    fs.writeFileSync(path.join(outDir, name), await applyNameplate(clean, petName, { look: lookFor(STYLES[style]) }));
    return name;
  };
  const variants = Array.from({ length: config.image.variants }, (_, i) => i + 1);
  // Krea 3 returns in seconds, so paint all variants at once; OpenAI stays sequential (rate limits).
  if (config.image.provider === 'krea') return Promise.all(variants.map(finish));
  const files = [];
  for (const i of variants) files.push(await finish(i));
  return files;
}
