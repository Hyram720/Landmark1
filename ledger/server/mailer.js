// Pluggable outbound mail for sign-in links, invites and client notifications.
//   LEDGER_MAIL_MODE = off (default) | console | resend | smtp
//   off      nothing is sent; links are NOT logged (safe default for production)
//   console  the message (including any sign-in link) is printed to the server log — local dev only
//   resend   sends through Resend: LEDGER_RESEND_KEY (or RESEND_API_KEY) + LEDGER_EMAIL_FROM
//   smtp     sends through SMTP: LEDGER_SMTP_URL (smtp[s]://user:pass@host:port) + LEDGER_EMAIL_FROM;
//            needs the optional `nodemailer` package installed
// Tests inject their own transport with setTransport().
import { sendEmail as resendSend } from './comms.js';

let override = null;
export function setTransport(fn) { override = fn; }

export function mailMode(env = process.env) {
  const m = String(env.LEDGER_MAIL_MODE || 'off').toLowerCase();
  return ['off', 'console', 'resend', 'smtp'].includes(m) ? m : 'off';
}
export function mailEnabled(env = process.env) { return !!override || mailMode(env) !== 'off'; }

/** Returns { sent: boolean, mode }. Never throws for "off"; throws provider errors otherwise. */
export async function sendMail({ to, subject, text }, env = process.env) {
  if (override) { await override({ to, subject, text }); return { sent: true, mode: 'test' }; }
  const mode = mailMode(env);
  if (mode === 'off') return { sent: false, mode };
  if (mode === 'console') {
    console.log(`[mail:console] to=${to} subject=${JSON.stringify(subject)}\n${text}\n[/mail]`);
    return { sent: true, mode };
  }
  if (mode === 'resend') {
    if (!(env.LEDGER_RESEND_KEY || env.RESEND_API_KEY) || !env.LEDGER_EMAIL_FROM) throw new Error('Resend is not configured');
    await resendSend({ to, subject, text }, env);
    return { sent: true, mode };
  }
  if (!env.LEDGER_SMTP_URL || !env.LEDGER_EMAIL_FROM) throw new Error('SMTP is not configured');
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; } catch { throw new Error('SMTP mode needs the nodemailer package (npm i nodemailer)'); }
  await nodemailer.createTransport(env.LEDGER_SMTP_URL).sendMail({ from: env.LEDGER_EMAIL_FROM, to, subject, text });
  return { sent: true, mode };
}
