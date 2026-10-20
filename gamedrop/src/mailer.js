// Email via Resend. Without a key, emails are logged instead of sent (handy in DEV_MODE).
import config from './config.js';

export async function sendEmail({ to, subject, html, unsubscribeUrl }) {
  if (!config.email.resendKey) {
    console.log(`[email:dry-run] to=${to} subject="${subject}"`);
    return { dryRun: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.email.from,
      to,
      subject,
      html,
      // One-click unsubscribe: required by Gmail/Yahoo for bulk senders.
      ...(unsubscribeUrl && {
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    }),
  });
  if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function alertOwner(subject, detail) {
  console.error(`[alert] ${subject}: ${detail}`);
  if (!config.email.alertTo) return;
  await sendEmail({
    to: config.email.alertTo,
    subject: `[${config.brandName}] ${subject}`,
    html: `<pre>${String(detail).replace(/</g, '&lt;')}</pre>`,
  }).catch((e) => console.error('alert email failed', e.message));
}

export function confirmEmail(sub) {
  const link = `${config.baseUrl}/confirm/${sub.id}`;
  return {
    to: sub.email,
    subject: `Confirm your ${config.brandName} subscription`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#111">
      <h2>One click and you're in</h2>
      <p>Every Thursday: the free games worth claiming and the deals worth buying, filtered to your platforms.</p>
      <p><a href="${link}" style="background:#7c3aed;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">Confirm my email</a></p>
      <p style="color:#888;font-size:12px">Didn't sign up? Ignore this and you won't hear from us.</p>
    </div>`,
  };
}
