// Central configuration. Everything that changes between environments lives in env vars.
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: env.DATA_DIR || new URL('../data', import.meta.url).pathname,
  brandName: env.BRAND_NAME || 'Custom Pet Portrait Studio',
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

  // IMAGE_PROVIDER=openai (default) or mock (copies the upload; for testing the pipeline).
  image: {
    provider: env.IMAGE_PROVIDER || 'openai',
    openaiKey: env.OPENAI_API_KEY || '',
    model: env.IMAGE_MODEL || 'gpt-image-1',
    variants: Number(env.IMAGE_VARIANTS || 4),
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

// Art styles. The prompt is sent with the customer's photo to the image model.
export const STYLES = {
  royal: {
    name: 'The Royal',
    prompt:
      'Transform this pet into a regal Renaissance oil painting portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Dress it in an ornate royal robe with ermine fur trim, a jeweled gold crown and a medallion necklace, seated on a red velvet throne. Dramatic Rembrandt lighting, dark rich background, visible brushstrokes, museum-quality classical portrait, vertical composition.',
  },
  admiral: {
    name: 'The Admiral',
    prompt:
      'Transform this pet into a classical 18th-century naval admiral oil portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Navy blue military coat with gold epaulettes, brass buttons and medals, stormy sea and tall ship behind. Old-master oil painting style, warm varnish tones, vertical composition.',
  },
  duchess: {
    name: 'The Duchess',
    prompt:
      'Transform this pet into an elegant 18th-century duchess oil portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Silk gown with lace collar, pearl necklace and tiara, soft pastel palace background with drapery. Rococo oil painting style, delicate lighting, vertical composition.',
  },
  astronaut: {
    name: 'The Astronaut',
    prompt:
      'Transform this pet into a heroic astronaut portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. White detailed space suit with mission patches, helmet visor open, Earth and stars glowing behind. Cinematic digital painting, crisp detail, vertical composition.',
  },
  watercolor: {
    name: 'Watercolor Classic',
    prompt:
      'Repaint this pet as a soft, elegant watercolor portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Loose wet-on-wet washes, fine ink detail on the eyes and nose, clean white paper background with gentle color bleeds. Fine-art print quality, vertical composition.',
  },
  holiday: {
    name: 'Holiday Edition',
    prompt:
      'Transform this pet into a cozy classic Christmas oil portrait. Keep the exact same animal: identical breed, fur colors, markings, eye color and face shape. Wearing a red velvet cape with white fur trim, beside a decorated Christmas tree with warm glowing lights and wrapped gifts. Warm nostalgic oil painting, vertical composition.',
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
  },
  canvas_large: {
    name: '16x24" Gallery Canvas + Digital',
    price: Number(env.PRICE_CANVAS_LARGE || 12900),
    physical: true,
    printfulVariantId: Number(env.PRINTFUL_VARIANT_CANVAS_LARGE || 19303),
  },
};

export default config;
