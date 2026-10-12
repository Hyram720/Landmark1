// Self-check of the outside services the store depends on. Runs at startup and every 6 hours,
// logs one line, and emails the owner when something that used to work stops working.
import config from './config.js';
import { alertOwner } from './notify.js';

export let lastHealth = null;

async function probe(url, token) {
  if (!token) return 'not configured';
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? 'ok' : `failed (HTTP ${r.status})`;
  } catch (err) {
    return `failed (${err.message})`;
  }
}

export async function runHealthcheck() {
  const [openai, resend, printful] = await Promise.all([
    probe('https://api.openai.com/v1/models', config.image.openaiKey),
    probe('https://api.resend.com/domains', config.email.resendKey),
    probe('https://api.printful.com/stores', config.printful.token),
  ]);
  const result = { openai, resend, printful, paymentLinks: Object.values(config.stripe.paymentLinks).filter(Boolean).length, webhookSecret: config.stripe.webhookSecret ? 'set' : 'missing' };
  const failing = Object.entries(result).filter(([, v]) => typeof v === 'string' && /failed|missing|not configured/.test(v));
  console.log(`Health check: ${JSON.stringify(result)}`);
  const key = failing.map(([k]) => k).join(',');
  if (failing.length && key !== lastHealth?.failingKey) {
    alertOwner('Store health check: something needs attention', failing.map(([k, v]) => `${k}: ${v}`).join('\n'));
  }
  lastHealth = { ...result, failingKey: key, at: new Date().toISOString() };
  return lastHealth;
}

export function startHealthcheck() {
  const tick = () => runHealthcheck().catch((e) => console.error('health check', e));
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 6 * 3600_000).unref();
}
