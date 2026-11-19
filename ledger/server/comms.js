// Outbound email (Resend) and SMS (Twilio). Each channel is enabled only when its credentials are set.
import { emailFooter, CAN_SPAM_POSTAL_ADDRESS } from './email-footer.js';

export function commsConfig(env = process.env) {
  return {
    email: Boolean((env.LEDGER_RESEND_KEY || env.RESEND_API_KEY) && env.LEDGER_EMAIL_FROM),
    sms: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM)
  };
}

export async function sendEmail({ to, subject, text, html, attachments }, env = process.env) {
  const body = text && String(text).includes(CAN_SPAM_POSTAL_ADDRESS) ? text : `${text || ''}\n\n${emailFooter()}`;
  let htmlBody = html ? String(html) : '';
  if (htmlBody && !htmlBody.includes(CAN_SPAM_POSTAL_ADDRESS)) htmlBody += '<p>' + CAN_SPAM_POSTAL_ADDRESS.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';
  const payload = { from: env.LEDGER_EMAIL_FROM, to: [to], subject, text: body };
  if (htmlBody) payload.html = htmlBody;
  if (attachments && attachments.length) payload.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.LEDGER_RESEND_KEY || env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Email provider error ${res.status}`);
  return (await res.json()).id;
}

export async function sendSms({ to, text }, env = process.env) {
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: text })
  });
  if (!res.ok) throw new Error(`SMS provider error ${res.status}`);
  return (await res.json()).sid;
}
