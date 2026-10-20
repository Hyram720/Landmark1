// Central configuration. Everything that changes between environments lives in env vars.
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: env.DATA_DIR || new URL('../data', import.meta.url).pathname,
  brandName: env.BRAND_NAME || 'GameDrop',
  adminKey: env.ADMIN_KEY || '',
  // DEV_MODE=true: confirm links are logged and the admin can send test issues without Resend.
  devMode: env.DEV_MODE === 'true',

  // When the weekly issue goes out. Epic rotates its free game Thursdays 15:00 UTC, so we follow an hour later.
  schedule: { weekday: Number(env.SEND_WEEKDAY ?? 4), hourUtc: Number(env.SEND_HOUR_UTC ?? 16) },

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  },

  email: {
    resendKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || 'GameDrop <drops@example.com>',
    alertTo: env.ALERT_EMAIL || '',
  },

  // Money: a sponsor slot in every issue, plus optional affiliate links on deals.
  sponsor: env.SPONSOR_TEXT && env.SPONSOR_URL ? { text: env.SPONSOR_TEXT, url: env.SPONSOR_URL } : null,
  // e.g. "https://www.example-affiliate.com/track?u={url}" ; {url} is replaced with the encoded deal URL.
  dealLinkTemplate: env.DEAL_LINK_TEMPLATE || '',
};

export default config;
