// Self-check of the outside services the store depends on. Runs at startup and every 6 hours,
// logs one line, and emails the owner when something that used to work stops working.
// The image line is not-ok when the active provider's credentials or endpoint are missing,
// and when the provider reports exhausted credits. GET /v1/models stays 200 in that case,
// so the OpenAI probe is an images request with the prompt omitted: a funded account is
// rejected as invalid (HTTP 400) and an exhausted account returns credit_balance_exhausted.
import config from './config.js';
import { alertOwner } from './notify.js';
import { classifyProviderHealth, isBillingMessage, safeDetail } from './providers/billing.js';
import { qwenConfigProblem, qwenTarget } from './providers/qwen.js';

export let lastHealth = null;
let billingHold = null;

export function noteImageProviderFailure(message) {
  if (!isBillingMessage(message)) return;
  billingHold = `credits out (${safeDetail(message)})`;
  if (lastHealth) lastHealth = { ...lastHealth, ok: false, image: billingHold };
}

export function noteImageProviderSuccess() {
  billingHold = null;
}

async function probe(url, token, fetchImpl) {
  if (!token) return 'not configured';
  try {
    const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? 'ok' : `failed (HTTP ${r.status})`;
  } catch (err) {
    return `failed (${err.message})`;
  }
}

async function probeOpenAI(fetchImpl) {
  const key = config.image.openaiKey;
  if (!key) return 'not configured';
  try {
    const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.image.model }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    return classifyProviderHealth(res.status, text);
  } catch (err) {
    return `failed (${err.message})`;
  }
}

async function probeQwen(fetchImpl) {
  const problem = qwenConfigProblem();
  if (problem) return problem;
  const target = qwenTarget();
  const headers = { 'Content-Type': 'application/json' };
  if (target.token) headers.Authorization = `Bearer ${target.token}`;
  try {
    // A body with no image should fail validation. HTTP 402 means the account cannot pay for inference.
    const res = await fetchImpl(target.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ probe: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    return classifyProviderHealth(res.status, text);
  } catch (err) {
    return `failed (${err.message})`;
  }
}

function applyHold(status) {
  if (String(status).startsWith('credits out')) {
    billingHold = status;
    return status;
  }
  if (status === 'ok') billingHold = null;
  return status;
}

export async function probeImageProvider(fetchImpl = fetch) {
  const provider = config.image.provider;
  if (provider === 'mock') return 'ok';
  if (provider === 'qwen') return applyHold(await probeQwen(fetchImpl));
  if (provider === 'openai') return applyHold(await probeOpenAI(fetchImpl));
  return `not configured (unknown provider ${provider})`;
}

export async function runHealthcheck(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const provider = config.image.provider;
  const [image, resend, printful] = await Promise.all([
    probeImageProvider(fetchImpl),
    probe('https://api.resend.com/domains', config.email.resendKey, fetchImpl),
    probe('https://api.printful.com/stores', config.printful.token, fetchImpl),
  ]);
  const result = {
    ok: image === 'ok',
    provider,
    image,
    resend,
    printful,
    paymentLinks: Object.values(config.stripe.paymentLinks).filter(Boolean).length,
    webhookSecret: config.stripe.webhookSecret ? 'set' : 'missing',
  };
  if (provider === 'openai') result.openai = image;
  const failing = Object.entries(result).filter(([, v]) => typeof v === 'string' && /failed|missing|not configured|credits out/.test(v));
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
