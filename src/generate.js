// Turns the customer's pet photo into styled portraits.
import fs from 'node:fs';
import path from 'node:path';
import config, { STYLES } from './config.js';
import { enhancePortrait } from './enhance.js';

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

// Writes N variants to outDir and returns their filenames.
export async function generatePortraits({ photoPath, mimeType, style, petName, outDir }) {
  const styleDef = STYLES[style];
  if (!styleDef) throw new Error(`unknown style ${style}`);
  fs.mkdirSync(outDir, { recursive: true });

  const files = [];
  for (let i = 1; i <= config.image.variants; i++) {
    const prompt = `${styleDef.prompt}${QUALITY} Variation ${i}: vary the pose, framing and background details slightly.${
      petName ? ` Include a small elegant engraved brass nameplate at the bottom reading "${petName}".` : ''
    }`;
    const raw =
      config.image.provider === 'mock'
        ? fs.readFileSync(photoPath)
        : await withRetry(() => generateOpenAI(photoPath, mimeType, prompt));
    const png = await enhancePortrait(raw);
    const name = `portrait-${i}.png`;
    fs.writeFileSync(path.join(outDir, name), png);
    files.push(name);
  }
  return files;
}
