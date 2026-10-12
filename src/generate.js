// Turns the customer's pet photo into styled portraits.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import config, { STYLES } from './config.js';
import { enhancePortrait } from './enhance.js';
import { applyNameplate, lookFor } from './nameplate.js';

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
  const raw =
    config.image.provider === 'mock'
      ? fs.readFileSync(photoPath)
      : await withRetry(() => generateOpenAI(photoPath, mimeType, prompt));
  return enhancePortrait(raw, { tone: styleDef.tone });
}

// Writes N variants to outDir and returns their filenames.
export async function generatePortraits({ photoPath, mimeType, style, petName, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  // clean/ keeps the unlettered master so the nameplate can be re-rendered if the name changes.
  fs.mkdirSync(path.join(outDir, 'clean'), { recursive: true });
  const files = [];
  for (let i = 1; i <= config.image.variants; i++) {
    const clean = await paintPortrait({ photoPath, mimeType, style, variant: i });
    const name = `portrait-${i}.png`;
    fs.writeFileSync(path.join(outDir, 'clean', name), clean);
    fs.writeFileSync(path.join(outDir, name), await applyNameplate(clean, petName, { look: lookFor(STYLES[style]) }));
    files.push(name);
  }
  return files;
}
