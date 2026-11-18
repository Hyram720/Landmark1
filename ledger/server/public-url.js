// Public origin for links in email. Read from PUBLIC_BASE_URL.
// Not written into Railway or other deploy config; the owner sets the domain later.
// Outside production, an unset value falls back to the local ledger port so tests
// and dev still have a link. In production there is no localhost default.
// Tests inject a URL with createApp({ publicBaseUrl }).

export const DEV_PUBLIC_BASE_URL = 'http://127.0.0.1:4100';

function nodeEnvUnset(env) {
  return env.NODE_ENV === undefined || env.NODE_ENV === null || String(env.NODE_ENV).trim() === '';
}

export function isProductionEnv(env = process.env) {
  if (env.NODE_ENV === 'production') return true;
  if (!nodeEnvUnset(env)) return false;
  return Boolean(String(env.RAILWAY_ENVIRONMENT || '').trim() || String(env.RAILWAY_ENVIRONMENT_NAME || '').trim());
}

export function readPublicBaseUrl(env = process.env, override) {
  const hasOverride = override !== undefined && override !== null && String(override).trim() !== '';
  const raw = (hasOverride ? String(override) : String(env.PUBLIC_BASE_URL || '')).trim().replace(/\/+$/, '');
  if (raw) return raw;
  if (isProductionEnv(env)) return '';
  return DEV_PUBLIC_BASE_URL;
}

export function isHttpsPublicBaseUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * In production, self-signup stays off unless the public origin is https.
 * `signupRequested` is the LEDGER_SELF_SIGNUP_ENABLED flag (or a test override).
 */
export function resolveSignupAccess({ env = process.env, signupRequested = false, publicBaseUrl: override } = {}) {
  const baseUrl = readPublicBaseUrl(env, override);
  if (!signupRequested) return { enabled: false, baseUrl, warning: '' };
  if (!isProductionEnv(env)) return { enabled: true, baseUrl, warning: '' };
  if (!baseUrl) {
    return {
      enabled: false,
      baseUrl: '',
      warning: '[signup] PUBLIC_BASE_URL is not set. Self-signup stays disabled in production until it is an https origin. This is not set in deploy config; set the domain when it is ready.'
    };
  }
  if (!isHttpsPublicBaseUrl(baseUrl)) {
    return {
      enabled: false,
      baseUrl,
      warning: `[signup] PUBLIC_BASE_URL must be https in production (got ${baseUrl}). Self-signup stays disabled.`
    };
  }
  return { enabled: true, baseUrl, warning: '' };
}
