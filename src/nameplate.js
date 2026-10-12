// Engraved brass nameplate drawn by code, not by the AI. Image models misspell text, so portraits
// are painted with no lettering and the pet's name is added here, spelled exactly as entered.
// Text is converted to vector outlines with a bundled font, so no system fonts are needed.
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import sharp from 'sharp';
import { DPI } from './enhance.js';

const require = createRequire(import.meta.url);
const font = opentype.loadSync(require.resolve('@fontsource/cinzel/files/cinzel-latin-700-normal.woff'));

export const NAME_MAX = 24;

// Letters (any language), digits, spaces and a little punctuation; collapses whitespace.
export function cleanName(input) {
  return String(input || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} '&.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

const r = (n) => Math.round(n * 10) / 10;

function plateSvg(width, height, name) {
  const plateW = width * 0.42;
  const plateH = height * 0.07;
  const x = (width - plateW) / 2;
  const y = height * 0.945 - plateH / 2;

  // Largest size that fits inside the plate with margins.
  let size = plateH * 0.5;
  const maxText = plateW * 0.72;
  const advance = font.getAdvanceWidth(name, size);
  if (advance > maxText) size *= maxText / advance;
  const textW = font.getAdvanceWidth(name, size);
  const tx = (width - textW) / 2;
  const ty = y + plateH / 2 + size * 0.35; // Cinzel cap height is ~0.7em
  const glyphs = font.getPath(name, tx, ty, size).toPathData(2);
  const highlight = font.getPath(name, tx, ty + Math.max(1, size * 0.04), size).toPathData(2);
  const sw = plateH * 0.045;
  const screw = plateH * 0.07;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f1d98f"/><stop offset="0.45" stop-color="#c9a046"/>
      <stop offset="0.55" stop-color="#b8892b"/><stop offset="1" stop-color="#8f6a22"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-30%" width="120%" height="180%">
      <feGaussianBlur stdDeviation="${r(plateH * 0.08)}"/>
    </filter>
  </defs>
  <rect x="${r(x)}" y="${r(y + plateH * 0.08)}" width="${r(plateW)}" height="${r(plateH)}" rx="${r(plateH * 0.12)}" fill="#000" opacity="0.45" filter="url(#shadow)"/>
  <rect x="${r(x)}" y="${r(y)}" width="${r(plateW)}" height="${r(plateH)}" rx="${r(plateH * 0.12)}" fill="url(#brass)" stroke="#5a4012" stroke-width="${r(sw)}"/>
  <rect x="${r(x + sw * 2)}" y="${r(y + sw * 2)}" width="${r(plateW - sw * 4)}" height="${r(plateH - sw * 4)}" rx="${r(plateH * 0.08)}" fill="none" stroke="#fff3cf" stroke-opacity="0.55" stroke-width="${r(sw * 0.6)}"/>
  <circle cx="${r(x + plateH * 0.28)}" cy="${r(y + plateH / 2)}" r="${r(screw)}" fill="#7a5a1c"/>
  <circle cx="${r(x + plateW - plateH * 0.28)}" cy="${r(y + plateH / 2)}" r="${r(screw)}" fill="#7a5a1c"/>
  <path d="${highlight}" fill="#fff1c4" fill-opacity="0.55"/>
  <path d="${glyphs}" fill="#3a2a0d"/>
</svg>`;
}

// Returns the portrait with the nameplate composited (or unchanged when there's no name).
export async function applyNameplate(cleanPng, name) {
  const text = cleanName(name);
  if (!text) return cleanPng;
  const { width, height } = await sharp(cleanPng).metadata();
  return sharp(cleanPng)
    .composite([{ input: Buffer.from(plateSvg(width, height, text)) }])
    .withMetadata({ density: DPI })
    .png({ compressionLevel: 8 })
    .toBuffer();
}
