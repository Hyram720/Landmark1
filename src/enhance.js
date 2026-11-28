// Image finishing for every portrait. Runs locally, so it adds no per-order cost.
//  - Master files: brightened, sharpened and upscaled to 2400x3600 px. The model paints 1024x1536 px, so
//    this adds pixels, not detail. Master files carry the neutral 72 ppi screen tag, never 300, because a
//    300 tag would claim print detail the files do not have.
//  - Print files: upscaled to the exact canvas pixel size when a canvas is ordered (sent to Printful only;
//    the density tag there only sizes the file for the printer and is not shown to customers).
// Upscaling is high-quality Lanczos interpolation plus sharpening; set ENHANCE_IMAGES=false to disable.
import sharp from 'sharp';

export const DPI = 300; // used only to size print files for Printful, never stamped on customer downloads
export const SCREEN_PPI = 72; // honest, neutral density tag for customer download files
export const MASTER = { width: 2400, height: 3600 }; // upscaled from the 1024x1536 model output, same 2:3 shape
// Internal cache key for the startup re-finish pass. Keep the value: changing it re-processes existing orders.
export const MASTER_VERSION = 'v2-300dpi';
export const ENHANCE_ENABLED = process.env.ENHANCE_IMAGES !== 'false';

const toMasterSize = (img) => img.resize(MASTER.width, MASTER.height, { kernel: 'lanczos3', fit: 'cover' });

// Full finishing for a fresh AI image: tone + upscale + sharpen. Tuned on real output.
// tone 'light' (e.g. watercolor on white paper) skips the exposure lift, which would wash it out.
export async function enhancePortrait(input, { tone = 'dark' } = {}) {
  if (!ENHANCE_ENABLED) return input;
  if (tone === 'light') {
    return toMasterSize(sharp(input))
      .normalise({ lower: 0.3, upper: 99.9 })
      .sharpen({ sigma: 1.1, m1: 0.8, m2: 2 })
      .withMetadata({ density: SCREEN_PPI })
      .png({ compressionLevel: 8 })
      .toBuffer();
  }
  return toMasterSize(sharp(input))
    .normalise({ lower: 0.5, upper: 99.7 }) // stretch levels: true blacks/whites
    .modulate({ brightness: 1.35 }) // lift the overall exposure
    .linear(1.0, 10) // raise the deepest shadows slightly
    .sharpen({ sigma: 1.3, m1: 1, m2: 2.2 }) // crisp fur and eyes after upscaling
    .withMetadata({ density: SCREEN_PPI })
    .png({ compressionLevel: 8 })
    .toBuffer();
}

// Resize-only upgrade for images that were already toned (no double brightening).
export async function upgradeToMaster(input) {
  return toMasterSize(sharp(input))
    .sharpen({ sigma: 0.8 })
    .withMetadata({ density: SCREEN_PPI })
    .png({ compressionLevel: 8 })
    .toBuffer();
}

// Exact-size print file, e.g. 16x24 in -> 4800x7200 px. JPEG keeps it uploadable.
export async function makePrintFile(input, { w, h }) {
  return sharp(input)
    .resize(w * DPI, h * DPI, { kernel: 'lanczos3', fit: 'cover' })
    .sharpen({ sigma: 0.8 })
    .withMetadata({ density: DPI })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
