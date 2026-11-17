// Shared reading of provider HTTP failures. OpenAI publishes credit exhaustion as HTTP 429
// with code credit_balance_exhausted; a models-list request stays 200 when that happens.
// Hugging Face Inference Providers return HTTP 402 when included credits are used up.
const BILLING_CODE = /credit_balance_exhausted|insufficient_quota|organization_spend_limit_exceeded|project_spend_limit_exceeded|organization_usage_limit_exceeded/;
const BILLING_TEXT = /credit_balance_exhausted|insufficient_quota|organization_spend_limit_exceeded|project_spend_limit_exceeded|organization_usage_limit_exceeded|exceeded your monthly included credits|payment required|insufficient credits/i;

export function isBillingMessage(text) {
  return BILLING_TEXT.test(String(text || ''));
}

export function safeDetail(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-redacted')
    .replace(/hf_[A-Za-z0-9]+/g, 'hf_redacted')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

// A 2xx/4xx that is not an auth or billing failure means the account accepted the call.
// The OpenAI probe omits the prompt on purpose, so a funded account comes back as 400.
export function classifyProviderHealth(status, bodyText) {
  const text = String(bodyText || '');
  const code = text.match(BILLING_CODE)?.[0];
  if (status === 402 || isBillingMessage(text)) return `credits out${code ? ` (${code})` : ` (HTTP ${status})`}`;
  if (status === 401 || status === 403) return `failed (HTTP ${status})`;
  if (status === 429) return 'failed (HTTP 429)';
  if (status >= 500) return `failed (HTTP ${status})`;
  if (status >= 200 && status < 500) return 'ok';
  return `failed (HTTP ${status})`;
}
