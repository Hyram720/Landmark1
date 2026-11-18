// Marketing capture. Kit form 10172923 owns the list, the double opt-in, and the unsubscribe link.
// This app does not put its own unsubscribe link in email and does not claim a local opt-out.
import { rateLimiter } from './auth.js';
import { postKitForm } from './kit-hook.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OK = { ok: true, message: 'Check your email to confirm. Kit sends that message when the list is connected. Use the unsubscribe link in that email.' };
const KIT_ONLY = 'Marketing email is sent by Kit. Use the unsubscribe link in that email. This app does not keep a suppression list yet.';

function yes(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export function mountNewsletter(app, { db }) {
  const limit = rateLimiter(20, 60 * 60 * 1000);

  app.post('/api/newsletter/subscribe', async (req, res) => {
    if (!limit(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const b = req.body || {};
    if (String(b.website || '').trim()) return res.json(OK);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    const firstName = String(b.firstName || '').trim().slice(0, 80);
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (!yes(b.consent)) return res.status(400).json({ error: 'Marketing consent is required. It is separate from any account terms.' });
    try {
      await postKitForm({ email, firstName, source: String(b.source || 'newsletter').slice(0, 80) });
    } catch (e) {
      console.error('[kit] newsletter:', e.message);
    }
    db.audit({ actor: 'public', action: 'newsletter.subscribe', detail: 'kit form 10172923' });
    db.persist();
    res.json(OK);
  });

  app.post('/api/newsletter/confirm', (req, res) => {
    res.status(501).json({ error: 'Confirmation is Kit\'s double opt-in. This app does not record a second confirmation.' });
  });

  app.post('/api/newsletter/unsubscribe', (req, res) => {
    res.status(501).json({ error: KIT_ONLY });
  });

  app.get('/api/newsletter/unsubscribe', (req, res) => {
    res.status(405).type('text/plain').send(KIT_ONLY);
  });
}
