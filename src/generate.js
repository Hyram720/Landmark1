// Turns the customer's pet photo into styled portraits.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import config, { STYLES, qwenInstruction } from './config.js';
import { enhancePortrait } from './enhance.js';
import { applyNameplate, lookFor } from './nameplate.js';
import { editorFor } from './providers/image.js';
import { generateOpenAIPhoto } from './providers/openai.js';
import { isBillingMessage } from './providers/billing.js';
import { noteImageProviderFailure, noteImageProviderSuccess } from './healthcheck.js';

// Appended to every OpenAI style prompt: keeps portraits bright and sharp instead of murky old-master darkness.
const QUALITY = ' Lighting: bright, warm, even light on the face and fur; the pet is clearly lit and the brightest part of the image. Crisp fine detail, sharp focus on the eyes, rich but not dark colors, no murky shadows. Ultra high detail.';

function openaiPrompt(styleDef, variant) {
  return `${styleDef.prompt}${QUALITY} Variation ${variant}: vary the pose, framing and background details slightly. Do not include any text, letters, numbers, signatures, labels or nameplates anywhere in the image; keep the bottom edge of the painting simple.`;
}

// Text-to-image, used only to create demo pet "customer photos" for the showcase gallery.
// Qwen Image Edit cannot invent those photos, and this branch does not read OPENAI_API_KEY.
export async function generatePhoto(prompt) {
  if (config.image.provider === 'mock') {
    return sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#c9a46b' } }).png().toBuffer();
  }
  if (config.image.provider === 'qwen') {
    throw new Error('Qwen Image Edit edits a photo; it does not create demo subject photos. Add the subject PNG under the samples cache.');
  }
  return withRetry(() => generateOpenAIPhoto(prompt));
}

// Retries transient failures (rate limits, timeouts) with backoff. Billing failures are not retried.
async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isBillingMessage(`${err.code || ''} ${err.message || ''}`)) throw err;
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

// Paints one finished (enhanced, 300 DPI) portrait with no lettering and returns the PNG buffer.
export async function paintPortrait({ photoPath, mimeType, style, variant = 1, fetchImpl }) {
  const styleDef = STYLES[style];
  if (!styleDef) throw new Error(`unknown style ${style}`);
  const provider = config.image.provider;
  // No lettering from the model: models misspell names. The nameplate is added by code afterwards.
  const prompt = provider === 'qwen' ? qwenInstruction(styleDef, variant) : openaiPrompt(styleDef, variant);
  const edit = editorFor(provider);
  let raw;
  if (provider === 'mock') {
    raw = await edit({ photoPath });
  } else {
    try {
      raw = await withRetry(() => edit({ photoPath, mimeType, prompt, variant, fetchImpl }));
      noteImageProviderSuccess();
    } catch (err) {
      noteImageProviderFailure(`${err.code || ''} ${err.message || ''}`);
      throw err;
    }
  }
  return enhancePortrait(raw, { tone: styleDef.tone });
}

// Writes N variants to outDir and returns their filenames.
export async function generatePortraits({ photoPath, mimeType, style, petName, outDir, prefix = 'portrait' }) {
  fs.mkdirSync(outDir, { recursive: true });
  // clean/ keeps the unlettered master so the nameplate can be re-rendered if the name changes.
  fs.mkdirSync(path.join(outDir, 'clean'), { recursive: true });
  const files = [];
  for (let i = 1; i <= config.image.variants; i++) {
    const clean = await paintPortrait({ photoPath, mimeType, style, variant: i });
    const name = `${prefix}-${i}.png`;
    fs.writeFileSync(path.join(outDir, 'clean', name), clean);
    fs.writeFileSync(path.join(outDir, name), await applyNameplate(clean, petName, { look: lookFor(STYLES[style]) }));
    files.push(name);
  }
  return files;
}
