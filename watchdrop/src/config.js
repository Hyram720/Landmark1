// Central configuration. Everything that changes between environments lives in env vars.
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: env.DATA_DIR || new URL('../data', import.meta.url).pathname,
  brandName: env.BRAND_NAME || 'WatchDrop',
  adminKey: env.ADMIN_KEY || '',
  // DEV_MODE=true: confirm links are logged and the admin can send test issues without Resend.
  devMode: env.DEV_MODE === 'true',

  // When the weekly issue goes out (UTC). Thursday 16:00 lands before most people plan their weekend.
  schedule: { weekday: Number(env.SEND_WEEKDAY ?? 4), hourUtc: Number(env.SEND_HOUR_UTC ?? 16) },
  // How often the midweek preview on the site is rebuilt. Each build costs ~15 API requests.
  previewHours: Number(env.PREVIEW_HOURS || 24),

  // Streaming Availability API (movieofthenight.com). The free plan is 1,000 requests/month and
  // allows commercial use. Keys from rapidapi.com use a different host and header.
  streaming: {
    apiKey: env.STREAMING_API_KEY || '',
    viaRapidApi: env.STREAMING_API_VIA_RAPIDAPI === 'true',
    country: (env.COUNTRY || 'us').toLowerCase(),
    // Hard stop so a bug or a busy month can never run up a bill.
    monthlyBudget: Number(env.STREAMING_MONTHLY_BUDGET || 900),
  },

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  },

  email: {
    resendKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || 'WatchDrop <weekly@example.com>',
    alertTo: env.ALERT_EMAIL || '',
  },

  // Money: a sponsor slot in every issue.
  sponsor: env.SPONSOR_TEXT && env.SPONSOR_URL ? { text: env.SPONSOR_TEXT, url: env.SPONSOR_URL } : null,
};

export default config;
