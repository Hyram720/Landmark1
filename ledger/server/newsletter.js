// Marketing capture. Kit form 10172923 owns the list and the double opt-in.
// These routes do not store a subscriber table. Confirm and unsubscribe tokens
// are signed so a CAN-SPAM unsubscribe link can be checked without a local list.
// Our mailer does not send a second confirmation.
import crypto from 'node:crypto';
import { rateLimiter } from './auth.js';
import { postKitForm, noteKitEvent } from './kit-hook.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OK = { ok: true, message: 'Check your email to confirm. Kit sends that message when the list is connected.' };

function yes(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes';
}
function sign(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function open(secret, raw) {
  const [body, sig] = String(raw || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

export function mountNewsletter(app, { D, db }) {
  const limit = rateLimiter(20, 60 * 60 * 1000);
  const issued = [];

  function tokensFor(email) {
    const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const confirm = sign(D().secret, { e: email, p: 'confirm', exp });
    const unsubscribe = sign(D().secret, { e: email, p: 'unsub', exp });
    issued.push({ email, confirm, unsubscribe, at: new Date().toISOString() });
    return { confirm, unsubscribe };
  }

  app.post('/api/newsletter/subscribe', async (req, res) => {
    if (!limit(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const b = req.body || {};
    if (String(b.website || '').trim()) return res.json(OK);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    const firstName = String(b.firstName || '').trim().slice(0, 80);
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (!yes(b.consent)) return res.status(400).json({ error: 'Marketing consent is required. It is separate from any account terms.' });
    const tokens = tokensFor(email);
    try {
      await postKitForm({ email, firstName, source: String(b.source || 'newsletter').slice(0, 80) });
    } catch (e) {
      console.error('[kit] newsletter:', e.message);
    }
    db.audit({ actor: 'public', action: 'newsletter.subscribe', detail: 'kit form 10172923' });
    db.persist();
    // Tokens stay on the server stub log for tests and for a later email footer.
    // The HTTP body does not include them, and we do not send our own confirmation.
    void tokens;
    res.json(OK);
  });

  function take(raw, purpose) {
    const data = open(D().secret, raw);
    if (!data || data.p !== purpose || !(data.exp > Date.now()) || !data.e) return null;
    return data;
  }

  app.post('/api/newsletter/confirm', (req, res) => {
    const data = take((req.body || {}).token, 'confirm');
    if (!data) return res.status(400).json({ error: 'This confirmation link is invalid or expired.' });
    noteKitEvent('confirm', data.e);
    db.audit({ actor: 'public', action: 'newsletter.confirm', detail: 'kit double opt-in stub; no mail sent' });
    db.persist();
    res.json({ ok: true, via: 'kit', message: 'Confirmation is Kit’s double opt-in. No second email was sent.' });
  });

  function unsubscribe(req, res) {
    const raw = (req.body && req.body.token) || req.query.token;
    const data = take(raw, 'unsub');
    if (!data) {
      if (req.method === 'GET') return res.status(400).type('text/plain').send('This unsubscribe link is invalid or expired.');
      return res.status(400).json({ error: 'This unsubscribe link is invalid or expired.' });
    }
    noteKitEvent('unsubscribe', data.e);
    db.audit({ actor: 'public', action: 'newsletter.unsubscribe', detail: 'token' });
    db.persist();
    if (req.method === 'GET') return res.type('text/plain').send('You are unsubscribed from Credit Ledger marketing email.');
    res.json({ ok: true, unsubscribed: true });
  }
  app.post('/api/newsletter/unsubscribe', unsubscribe);
  app.get('/api/newsletter/unsubscribe', unsubscribe);

  // Test helper hangs off the app so tests can read tokens without a table.
  app.locals.newsletterIssued = issued;
}
