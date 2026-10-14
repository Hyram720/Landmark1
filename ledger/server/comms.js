// Outbound email (Resend) and SMS (Twilio). Each channel is enabled only when its credentials are set.
export function commsConfig(env = process.env) {
  return {
    email: Boolean((env.LEDGER_RESEND_KEY || env.RESEND_API_KEY) && env.LEDGER_EMAIL_FROM),
    sms: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM)
  };
}

export async function sendEmail({ to, subject, text }, env = process.env) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.LEDGER_RESEND_KEY || env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.LEDGER_EMAIL_FROM, to: [to], subject, text })
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
