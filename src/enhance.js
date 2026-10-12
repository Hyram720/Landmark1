// Post-processing for every painted portrait: doubles resolution (2048x3072, ~128 DPI on a
// 16x24 canvas) and opens up shadows so the pet's face and fur read clearly. Runs locally,
// so it adds no per-order cost. Tuned on real output; set ENHANCE_IMAGES=false to disable.
import sharp from 'sharp';

export const ENHANCE_ENABLED = process.env.ENHANCE_IMAGES !== 'false';

export async function enhancePortrait(input) {
  if (!ENHANCE_ENABLED) return input;
  return sharp(input)
    .resize(2048, 3072, { kernel: 'lanczos3', fit: 'cover' })
    .normalise({ lower: 0.5, upper: 99.7 }) // stretch levels: true blacks/whites
    .modulate({ brightness: 1.35 }) // lift the overall exposure
    .linear(1.0, 10) // raise the deepest shadows slightly
    .sharpen({ sigma: 1.3, m1: 1, m2: 2.2 }) // crisp fur and eyes after upscaling
    .png({ compressionLevel: 8 })
    .toBuffer();
}
