// Central configuration. Everything that changes between environments lives in env vars.
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: env.DATA_DIR || new URL('../data', import.meta.url).pathname,
  brandName: env.BRAND_NAME || 'Custom Pet Portrait Studio',
  supportEmail: env.SUPPORT_EMAIL || '',
  repaintDays: Number(env.REPAINT_DAYS || 7),
  // Launch promotion shown site-wide and pre-applied at checkout. LAUNCH_ENDS is YYYY-MM-DD (ET).
  launch: { code: env.LAUNCH_CODE || '', percent: Number(env.LAUNCH_PERCENT || 20), ends: env.LAUNCH_ENDS || '' },
  adminKey: env.ADMIN_KEY || '',

  // Set DEV_SKIP_PAYMENT=true to mark orders paid without Stripe (local testing only).
  devSkipPayment: env.DEV_SKIP_PAYMENT === 'true',

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    // Alternative to a secret key: Stripe Payment Links, one per product (buy.stripe.com/...).
    // The order id travels as client_reference_id; the webhook confirms payment.
    paymentLinks: {
      digital: env.STRIPE_LINK_DIGITAL || '',
      canvas_small: env.STRIPE_LINK_CANVAS_SMALL || '',
      canvas_large: env.STRIPE_LINK_CANVAS_LARGE || '',
    },
  },

  // IMAGE_PROVIDER=openai (default), qwen, or mock (copies the upload; for testing the pipeline).
  // Getters so a qwen process does not read OPENAI_API_KEY unless an OpenAI call actually runs.
  image: {
    get provider() {
      return (env.IMAGE_PROVIDER || 'openai').trim() || 'openai';
    },
    get openaiKey() {
      return env.OPENAI_API_KEY || '';
    },
    get model() {
      return env.IMAGE_MODEL || 'gpt-image-1';
    },
    get variants() {
      return Number(env.IMAGE_VARIANTS || 4);
    },
    get qwenBackend() {
      return (env.QWEN_BACKEND || 'hf').trim() || 'hf';
    },
    get hfToken() {
      return env.HF_TOKEN || '';
    },
    // wavespeed's Hub mapping is the 2511 model. fal-ai's current mapping is qwen-image-edit-plus.
    get qwenHfProvider() {
      return (env.QWEN_HF_PROVIDER || 'wavespeed').trim() || 'wavespeed';
    },
    get qwenHfUrl() {
      return (env.QWEN_HF_URL || '').trim();
    },
    get qwenModel() {
      return env.QWEN_MODEL || 'Qwen/Qwen-Image-Edit-2511';
    },
    get qwenEndpointUrl() {
      return (env.QWEN_ENDPOINT_URL || '').trim();
    },
    get qwenEndpointToken() {
      return env.QWEN_ENDPOINT_TOKEN || '';
    },
  },

  email: {
    resendKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || 'Custom Pet Portrait Studio <orders@example.com>',
    alertTo: env.ALERT_EMAIL || '',
  },

  printful: {
    token: env.PRINTFUL_TOKEN || '',
    // false = orders are created as drafts you approve in Printful; true = fully hands-off.
    autoConfirm: env.PRINTFUL_AUTO_CONFIRM === 'true',
  },
};

// Art styles. `prompt` is the OpenAI edit text. `edit` is the Qwen instruction for the same look.
// Neither names a living artist. Identity language is repeated in qwenInstruction().
export const QWEN_IDENTITY =
  'Edit this photo of a pet. Keep this exact animal: the same breed, fur colors, markings, eye color, face shape and identity. Do not replace it with a different animal, a human, or a generic pet. Change only the costume, setting and painting treatment described next.';

export function qwenInstruction(styleDef, variant = 1) {
  return `${QWEN_IDENTITY} ${styleDef.edit} Variation ${variant}: vary the pose, framing and background details slightly. Do not include any text, letters, numbers, signatures, logos, labels or nameplates anywhere in the image. Keep the bottom edge simple. Lighting: bright, warm, even light on the face and fur; the pet is clearly lit and the brightest part of the image. Crisp fine detail, sharp focus on the eyes, rich but not dark colors.`;
}

export const STYLES = {
  royal: {
    name: 'The Royal',
    prompt:
      'Transform this pet into a regal Renaissance oil painting portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Dress it in an ornate royal robe with ermine fur trim, a jeweled gold crown and a medallion necklace, seated on a red velvet throne. Warm golden light illuminating the face, deep red and gold background, visible brushstrokes, museum-quality classical portrait, vertical composition.',
    edit:
      'Paint the pet as a regal court portrait: an ornate robe with ermine fur trim, a jeweled gold crown and a medallion necklace, seated on a red velvet throne. Deep red and gold background, warm golden light, visible brushstrokes, vertical composition.',
  },
  admiral: {
    name: 'The Admiral',
    prompt:
      'Transform this pet into a classical 18th-century naval admiral oil portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Navy blue military coat with gold epaulettes, brass buttons and medals, stormy sea and tall ship behind. Old-master oil painting style, warm luminous tones, vertical composition.',
    edit:
      'Paint the pet as an 18th-century naval officer: a navy blue coat with gold epaulettes, brass buttons and medals, and a stormy sea with a tall ship behind. Classical oil-portrait treatment, warm luminous tones, vertical composition.',
  },
  duchess: {
    name: 'The Duchess',
    prompt:
      'Transform this pet into an elegant 18th-century duchess oil portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Silk gown with lace collar, pearl necklace and tiara, soft pastel palace background with drapery. Rococo oil painting style, delicate lighting, vertical composition.',
    edit:
      'Paint the pet as an 18th-century court portrait: a silk gown with a lace collar, a pearl necklace and a tiara, in a soft pastel palace interior with drapery. Delicate Rococo-era oil-portrait treatment, vertical composition.',
  },
  astronaut: {
    name: 'The Astronaut',
    prompt:
      'Transform this pet into a heroic astronaut portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. White detailed space suit with fictional mission patches (no real agency logos, no flags), helmet visor open, Earth and stars glowing behind. Cinematic digital painting, crisp detail, vertical composition.',
    edit:
      'Paint the pet as an astronaut: a white space suit with fictional mission patches only, no real agency logos and no flags, helmet visor open, Earth and stars behind. Cinematic painted portrait, crisp detail, vertical composition.',
  },
  watercolor: {
    name: 'Watercolor Classic',
    tone: 'light',
    prompt:
      'Repaint this pet as a soft, elegant watercolor portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Loose wet-on-wet washes, fine ink detail on the eyes and nose, clean white paper background with gentle color bleeds. Fine-art print quality, vertical composition.',
    edit:
      'Repaint the pet as a soft watercolor on white paper while keeping the animal unchanged. Loose wet-on-wet washes, fine detail on the eyes and nose, gentle color bleeds, clean paper background, vertical composition.',
  },
  holiday: {
    name: 'Holiday Edition',
    prompt:
      'Transform this pet into a cozy classic Christmas oil portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Wearing a red velvet cape with white fur trim, beside a decorated Christmas tree with warm glowing lights and wrapped gifts. Warm nostalgic oil painting, vertical composition.',
    edit:
      'Paint the pet in a cozy Christmas portrait: a red velvet cape with white fur trim, beside a decorated Christmas tree with warm lights and wrapped gifts. Warm nostalgic oil-portrait treatment, vertical composition.',
  },
};

// Products. Prices in cents. Canvas sizes are 2:3 to match the 1024x1536 portraits (no cropping).
// Defaults are Printful "Canvas (in)" variants: 19299 = 12x18 (~$24.99), 19303 = 16x24 (~$31.11)
// before shipping. Override via env to use other sizes (GET https://api.printful.com/products/3).
export const PRODUCTS = {
  digital: {
    name: 'Digital Portrait (4 hi-res versions)',
    price: Number(env.PRICE_DIGITAL || 2900),
    physical: false,
  },
  canvas_small: {
    name: '12x18" Gallery Canvas + Digital',
    price: Number(env.PRICE_CANVAS_SMALL || 8900),
    physical: true,
    printfulVariantId: Number(env.PRINTFUL_VARIANT_CANVAS_SMALL || 19299),
    printInches: { w: 12, h: 18 },
  },
  canvas_large: {
    name: '16x24" Gallery Canvas + Digital',
    price: Number(env.PRICE_CANVAS_LARGE || 12900),
    physical: true,
    printfulVariantId: Number(env.PRINTFUL_VARIANT_CANVAS_LARGE || 19303),
    printInches: { w: 16, h: 24 },
  },
};

export default config;
