// Customer + owner email via Resend. Without a key, emails are logged instead of sent.
import config from './config.js';

export async function sendEmail({ to, subject, html }) {
  if (!config.email.resendKey) {
    console.log(`[email:dry-run] to=${to} subject="${subject}"`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.email.from, to, subject, html, ...(config.supportEmail && { reply_to: config.supportEmail }) }),
  });
  if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
}

// Only failures reach a human.
export async function alertOwner(subject, detail) {
  console.error(`[alert] ${subject}: ${detail}`);
  if (config.email.alertTo) {
    await sendEmail({
      to: config.email.alertTo,
      subject: `[${config.brandName}] ${subject}`,
      html: `<pre>${String(detail).replace(/</g, '&lt;')}</pre>`,
    }).catch((e) => console.error('alert email failed', e));
  }
}

export function reportReadyEmail(scan) {
  const link = `${config.baseUrl}/r/${scan.id}`;
  return {
    to: scan.email,
    subject: `Your ${config.brandName} report: ${scan.summary.total} issue${scan.summary.total === 1 ? '' : 's'} found`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#111">
        <h1 style="font-size:22px">Your full report is unlocked</h1>
        <p>${scan.summary.critical} critical, ${scan.summary.high} high, ${scan.summary.medium} medium, ${scan.summary.low} low.</p>
        <p>Every finding comes with a fix prompt you can paste straight into Cursor, Claude Code, Lovable or Bolt.</p>
        <p><a href="${link}" style="background:#16a34a;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">Open report</a></p>
        <p style="color:#666;font-size:13px">Keep this email: the link is your private report. Fixed things? Run a free re-scan any time to confirm.</p>
      </div>`,
  };
}
