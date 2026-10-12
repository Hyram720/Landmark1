// Customer + owner email via Resend. Without a key, emails are logged instead of sent.
import config from './config.js';

export async function sendEmail({ to, subject, html }) {
  if (!config.email.resendKey) {
    console.log(`[email:dry-run] to=${to} subject="${subject}"`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendKey}`,
      'Content-Type': 'application/json',
    },
    // Customer replies go to the support inbox.
    body: JSON.stringify({ from: config.email.from, to, subject, html, ...(config.supportEmail && { reply_to: config.supportEmail }) }),
  });
  if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
}

// The "5%": only failures reach a human.
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

export function portraitsReadyEmail(order) {
  const link = `${config.baseUrl}/o/${order.id}`;
  const printLine = order.physical
    ? '<p><strong>Next step:</strong> open your gallery and tap <em>"Print this one"</em> on your favorite. We\'ll ship it as a gallery canvas.</p>'
    : '';
  return {
    to: order.email,
    subject: `${order.petName || 'Your pet'}'s royal portrait is ready 👑`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#2b2118">
        <h1 style="color:#7a1f1f">Your portraits are ready!</h1>
        <p>We painted ${config.image.variants} versions of ${order.petName || 'your pet'}. Download them all in full resolution:</p>
        <p><a href="${link}" style="background:#7a1f1f;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">View &amp; download</a></p>
        ${printLine}
        <p>Please check the spelling on the nameplate — if anything is off, fix it on your gallery page and all portraits update instantly.</p>
        <p style="color:#7d6b5a;font-size:13px">Keep this email — the link is your private gallery.${config.supportEmail ? ` Questions? Just reply or email ${config.supportEmail}.` : ''}</p>
      </div>`,
  };
}
