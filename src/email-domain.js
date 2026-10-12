// Registers the sending domain with Resend and switches the From address over once Resend has
// verified it. Until then, mail goes out from Resend's shared test sender. Runs on boot and
// every 10 minutes until verified, logging the DNS records Resend needs.
import config from './config.js';

export const emailDomainStatus = { domain: process.env.EMAIL_DOMAIN || '', status: 'not configured', records: [] };

async function resend(method, path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${method} ${path}: ${res.status} ${json.message || ''}`);
  return json;
}

async function check() {
  const name = emailDomainStatus.domain;
  const { data = [] } = await resend('GET', '/domains');
  let domain = data.find((d) => d.name === name);
  if (!domain) domain = await resend('POST', '/domains', { name });
  const full = await resend('GET', `/domains/${domain.id}`);
  emailDomainStatus.status = full.status;
  emailDomainStatus.records = (full.records || []).map((r) => ({
    type: r.type, name: r.name, value: r.value, priority: r.priority, status: r.status,
  }));
  if (full.status === 'verified') {
    config.email.from = process.env.EMAIL_FROM_VERIFIED || `${config.brandName} <studio@${name}>`;
    console.log(`Email domain ${name} verified; sending from ${config.email.from}`);
    return true;
  }
  console.log(`Email domain ${name}: ${full.status}. DNS records needed: ${JSON.stringify(emailDomainStatus.records)}`);
  await resend('POST', `/domains/${domain.id}/verify`).catch(() => {});
  return false;
}

export function startEmailDomainSetup() {
  if (!emailDomainStatus.domain || !config.email.resendKey) return;
  emailDomainStatus.status = 'checking';
  const tick = async () => {
    try {
      if (await check()) clearInterval(timer);
    } catch (err) {
      emailDomainStatus.status = `error: ${err.message}`;
      console.error(`Email domain setup: ${err.message}`);
    }
  };
  const timer = setInterval(tick, 10 * 60_000);
  timer.unref();
  tick();
}
