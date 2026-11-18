// Sign-in method for public self-signup. One-line switch.
// 'password' matches invite-accept (the client chooses a password).
// 'magic_link' emails a one-time sign-in link. While LEDGER_MAIL_MODE is off
// (the default), that link is handed to the mailer and not delivered.
// This is not a deploy setting. Change the constant below to switch.
export const CLIENT_AUTH_METHOD = 'password';

export function clientAuthMethod(override) {
  const raw = override === undefined || override === null || override === '' ? CLIENT_AUTH_METHOD : override;
  const v = String(raw).toLowerCase().replace(/-/g, '_');
  return v === 'magic_link' ? 'magic_link' : 'password';
}
