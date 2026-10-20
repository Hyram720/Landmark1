// Central configuration. Everything that changes between environments lives in env vars.
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: env.DATA_DIR || new URL('../data', import.meta.url).pathname,
  brandName: env.BRAND_NAME || 'ShipCheck',
  supportEmail: env.SUPPORT_EMAIL || '',
  adminKey: env.ADMIN_KEY || '',
  price: Number(env.PRICE_REPORT || 1900), // cents

  // Set DEV_SKIP_PAYMENT=true to unlock reports without Stripe (local testing only).
  devSkipPayment: env.DEV_SKIP_PAYMENT === 'true',

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  },

  email: {
    resendKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || 'ShipCheck <reports@example.com>',
    alertTo: env.ALERT_EMAIL || '',
  },

  // Limits that keep one scan cheap and the server safe from oversized or hostile archives.
  limits: {
    archiveBytes: Number(env.MAX_ARCHIVE_MB || 40) * 1024 * 1024,
    fileBytes: 512 * 1024,
    files: 5000,
  },
};

export default config;
