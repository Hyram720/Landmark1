// Pluggable outbound mail for sign-in links, invites and client notifications.
//   LEDGER_MAIL_MODE = off (default) | console | resend | smtp
//   off      nothing is sent; links are NOT logged (safe default for production)
//   console  the message (including any sign-in link) is printed to the server log — local dev only
//   resend   sends through Resend: LEDGER_RESEND_KEY (or RESEND_API_KEY) + LEDGER_EMAIL_FROM
//   smtp     sends through SMTP: LEDGER_SMTP_URL (smtp[s]://user:pass@host:port) + LEDGER_EMAIL_FROM;
//            needs the optional `nodemailer` package installed
// AWS SES is not wired on this build. Production access is not approved.
// LEDGER_MAIL_MODE defaults to off: nothing is sent and links are not logged.
// Signup verification and portal sign-in links call sendMail, so they stay
// stubbed until a mail mode is turned on. Do not add SES keys in deploy config.
// Tests inject their own transport with setTransport().
import { sendEmail as resendSend } from './comms.js';
import { emailFooter, CAN_SPAM_POSTAL_ADDRESS } from './email-footer.js';

let override = null;
export function setTransport(fn) { override = fn; }

export function mailMode(env = process.env) {
  const m = String(env.LEDGER_MAIL_MODE || 'off').toLowerCase();
  return ['off', 'console', 'resend', 'smtp'].includes(m) ? m : 'off';
}
export function mailEnabled(env = process.env) { return !!override || mailMode(env) !== 'off'; }

function withFooter(text) {
  const body = String(text || '');
  if (body.includes(CAN_SPAM_POSTAL_ADDRESS)) return body;
  return `${body}${body ? '\n\n' : ''}${emailFooter()}`;
}

/** Returns { sent: boolean, mode }. Never throws for "off"; throws provider errors otherwise. */
export async function sendMail({ to, subject, text, attachments }, env = process.env) {
  const full = withFooter(text);
  const files = Array.isArray(attachments) ? attachments : [];
  if (override) { await override({ to, subject, text: full, attachments: files }); return { sent: true, mode: 'test' }; }
  const mode = mailMode(env);
  if (mode === 'off') return { sent: false, mode };
  if (mode === 'console') {
    const names = files.map(a => `${a.filename || 'file'} (${Buffer.byteLength(a.content || '')} bytes)`).join(', ');
    console.log(`[mail:console] to=${to} subject=${JSON.stringify(subject)}${names ? ' attachments=' + names : ''}\n${full}\n[/mail]`);
    return { sent: true, mode };
  }
  if (mode === 'resend') {
    if (!(env.LEDGER_RESEND_KEY || env.RESEND_API_KEY) || !env.LEDGER_EMAIL_FROM) throw new Error('Resend is not configured');
    const encoded = files.map(a => ({ filename: a.filename, content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content }));
    await resendSend({ to, subject, text: full, attachments: encoded }, env);
    return { sent: true, mode };
  }
  if (!env.LEDGER_SMTP_URL || !env.LEDGER_EMAIL_FROM) throw new Error('SMTP is not configured');
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; } catch { throw new Error('SMTP mode needs the nodemailer package (npm i nodemailer)'); }
  await nodemailer.createTransport(env.LEDGER_SMTP_URL).sendMail({ from: env.LEDGER_EMAIL_FROM, to, subject, text: full, attachments: files.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })) });
  return { sent: true, mode };
}
