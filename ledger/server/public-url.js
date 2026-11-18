// Public origin used in emailed links. A constant, not a deploy env var.
// Local runs and tests use the ledger default port. Pass another origin into
// createApp({ publicBaseUrl }) when a host is known.
export const PUBLIC_BASE_URL = 'http://127.0.0.1:4100';

export function publicBaseUrl(override) {
  const raw = override === undefined || override === null || String(override).trim() === '' ? PUBLIC_BASE_URL : override;
  return String(raw).trim().replace(/\/+$/, '');
}
