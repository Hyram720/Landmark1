// Sign-in upgrades on top of the existing invite + password login:
//  - Forgot password: single-use, hashed, 30-minute reset token; same response whether or not
//    the email exists; resetting bumps sessionEpoch (signs out every other device).
//  - Magic-link sign-in (optional, owner toggle): single-use, hashed, 15 minutes.
//  - Email one-time code after the password (optional, owner toggle "2-step sign-in").
//  - Client email notifications: dispute response recorded, item removed/corrected, deadline near.
//    Clients can opt out in the portal. Emails carry no account details — only "sign in to see".
// All mail goes through mailer.js, which is OFF by default (nothing is sent, links aren't logged).
import crypto from 'node:crypto';
import { hashPassword, passwordProblem, rateLimiter } from './auth.js';
import { sendMail, mailEnabled, mailMode } from './mailer.js';
import { Business } from './shared.js';

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const RESET_TTL = 30 * 60 * 1000, MAGIC_TTL = 15 * 60 * 1000, OTP_TTL = 10 * 60 * 1000;
const NEUTRAL = 'If an account exists for that email, we sent a link. It expires soon and works once.';
const pageFor = role => (role === 'client' ? 'portal' : role === 'partner' ? 'partner' : 'app');

export function mountClientAuth(app, { D, db, need, startSession, publicUser, workspace }) {
  const ipLimit = rateLimiter(10, 15 * 60 * 1000);
  const emailLimit = rateLimiter(5, 60 * 60 * 1000);
  const otpLimit = rateLimiter(10, 15 * 60 * 1000);
  const settings = () => (D().authSettings = D().authSettings || { magicLink: false, emailOtp: false, notifications: true });
  const tokens = () => (D().authTokens = D().authTokens || []);
  const prune = () => { const now = Date.now(); D().authTokens = tokens().filter(t => t.expiresAt > now && !t.usedAt); };
  const origin = req => `${req.protocol}://${req.get('host')}`;
  const userByEmail = e => D().users.find(u => u.email === String(e || '').toLowerCase().trim() && !u.disabled);

  function issue(kind, u, ttl, extra) {
    prune();
    // One live token of each kind per user.
    D().authTokens = tokens().filter(t => !(t.userId === u.id && t.kind === kind));
    const raw = kind === 'otp' ? String(crypto.randomInt(0, 1e6)).padStart(6, '0') : crypto.randomBytes(32).toString('base64url');
    const rec = Object.assign({ hash: sha(raw), kind, userId: u.id, expiresAt: Date.now() + ttl, usedAt: null, attempts: 0 }, extra || {});
    tokens().push(rec);
    db.persist();
    return { raw, rec };
  }
  function consume(kind, raw, match) {
    const t = tokens().find(x => x.kind === kind && x.hash === sha(raw) && !x.usedAt && x.expiresAt > Date.now() && (!match || match(x)));
    if (!t) return null;
    t.usedAt = new Date().toISOString();
    return D().users.find(u => u.id === t.userId && !u.disabled) || null;
  }
  async function mail(u, subject, text) {
    try { await sendMail({ to: u.email, subject, text }); } catch (e) { console.error(`[mail] ${subject}: ${e.message}`); }
  }
  const company = () => ((workspace().settings || {}).company || {}).name || 'our team';

  // ---------- forgot / reset ----------
  app.post('/api/auth/forgot', async (req, res) => {
    const email = String((req.body || {}).email || '').toLowerCase().slice(0, 200);
    if (!ipLimit(req.ip) || !emailLimit('f:' + email)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    const u = userByEmail(email);
    if (u) {
      const { raw } = issue('reset', u, RESET_TTL);
      db.audit({ actor: u.email, action: 'auth.reset.request', detail: mailMode() });
      await mail(u, `Reset your ${company()} password`, `Someone asked to reset the password for this email.\n\nReset it here (works once, expires in 30 minutes):\n${origin(req)}/${pageFor(u.role)}#reset=${raw}\n\nIf this wasn’t you, ignore this email — your password won’t change.`);
    }
    res.json({ ok: true, message: NEUTRAL });
  });

  app.post('/api/auth/reset', (req, res) => {
    const { token, password } = req.body || {};
    if (!ipLimit('r:' + req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const prob = passwordProblem(password);
    if (prob) return res.status(400).json({ error: prob });
    const u = consume('reset', String(token || ''));
    if (!u) return res.status(400).json({ error: 'This reset link is invalid, expired or already used. Request a new one.' });
    u.password = hashPassword(password);
    u.sessionEpoch = (u.sessionEpoch || 1) + 1; // signs out every existing session
    db.audit({ actor: u.email, action: 'auth.reset.done', detail: 'sessions revoked' });
    db.persist();
    startSession(req, res, u);
    res.json({ user: publicUser(u) });
  });

  // Owner can create a reset link to hand over when email is off.
  app.post('/api/users/:id/reset-link', need('owner'), (req, res) => {
    const u = D().users.find(x => x.id === req.params.id && !x.disabled);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const { raw } = issue('reset', u, RESET_TTL);
    db.audit({ actor: req.user.email, action: 'auth.reset.link', detail: u.email });
    db.persist();
    res.json({ url: `${origin(req)}/${pageFor(u.role)}#reset=${raw}`, expiresInMinutes: 30 });
  });

  // ---------- magic link ----------
  app.post('/api/auth/magic', async (req, res) => {
    if (!settings().magicLink) return res.status(404).json({ error: 'Email sign-in links are not turned on.' });
    const email = String((req.body || {}).email || '').toLowerCase().slice(0, 200);
    if (!ipLimit(req.ip) || !emailLimit('m:' + email)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    const u = userByEmail(email);
    if (u) {
      const { raw } = issue('magic', u, MAGIC_TTL);
      db.audit({ actor: u.email, action: 'auth.magic.request', detail: mailMode() });
      await mail(u, `Your ${company()} sign-in link`, `Sign in here (works once, expires in 15 minutes):\n${origin(req)}/${pageFor(u.role)}#magic=${raw}\n\nIf you didn’t ask for this, ignore this email.`);
    }
    res.json({ ok: true, message: NEUTRAL });
  });
  app.post('/api/auth/magic/verify', (req, res) => {
    if (!ipLimit('mv:' + req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const u = consume('magic', String((req.body || {}).token || ''));
    if (!u) return res.status(400).json({ error: 'This sign-in link is invalid, expired or already used.' });
    db.audit({ actor: u.email, action: 'login.magic', detail: req.ip });
    db.persist();
    startSession(req, res, u);
    res.json({ user: publicUser(u) });
  });

  // ---------- email one-time code (2-step) ----------
  const OTP_COOKIE = 'ledger_otp';
  function otpRequired(u) { return !!settings().emailOtp && mailEnabled(); }
  async function startOtp(req, res, u) {
    const pending = crypto.randomBytes(18).toString('base64url');
    const { raw } = issue('otp', u, OTP_TTL, { pending: sha(pending) });
    res.cookie(OTP_COOKIE, pending, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: OTP_TTL, path: '/api/auth' });
    await mail(u, `Your ${company()} sign-in code`, `Your sign-in code is ${raw}. It expires in 10 minutes. If you didn’t try to sign in, change your password.`);
    res.json({ otpRequired: true, message: 'We emailed you a 6-digit code.' });
  }
  app.post('/api/auth/otp', (req, res) => {
    const pending = (String(req.headers.cookie || '').match(/ledger_otp=([\w-]+)/) || [])[1];
    if (!pending || !otpLimit(pending) || !otpLimit('ip:' + req.ip)) return res.status(429).json({ error: 'Too many attempts. Sign in again.' });
    const rec = tokens().find(t => t.kind === 'otp' && t.pending === sha(pending) && !t.usedAt && t.expiresAt > Date.now());
    if (!rec) return res.status(400).json({ error: 'Your code expired. Sign in again.' });
    rec.attempts += 1;
    if (rec.attempts > 5) { rec.usedAt = 'locked'; db.persist(); return res.status(400).json({ error: 'Too many wrong codes. Sign in again.' }); }
    const u = consume('otp', String((req.body || {}).code || '').trim(), t => t === rec);
    if (!u) { db.persist(); return res.status(400).json({ error: 'That code is not correct.' }); }
    res.clearCookie(OTP_COOKIE, { path: '/api/auth' });
    db.audit({ actor: u.email, action: 'login.otp', detail: req.ip });
    db.persist();
    startSession(req, res, u);
    res.json({ user: publicUser(u) });
  });

  // ---------- owner settings ----------
  app.get('/api/settings/auth', need('owner'), (req, res) => res.json(Object.assign({}, settings(), { mailMode: mailMode(), mailEnabled: mailEnabled() })));
  app.put('/api/settings/auth', need('owner'), (req, res) => {
    const b = req.body || {};
    const next = { magicLink: !!b.magicLink, emailOtp: !!b.emailOtp, notifications: b.notifications !== false };
    if ((next.magicLink || next.emailOtp) && !mailEnabled()) return res.status(400).json({ error: 'Turn on outbound email first (LEDGER_MAIL_MODE=resend or smtp on the server). Otherwise nobody could receive links or codes.' });
    Object.assign(settings(), next);
    db.audit({ actor: req.user.email, action: 'settings.auth', detail: JSON.stringify(next) });
    db.persist();
    res.json(Object.assign({}, settings(), { mailMode: mailMode(), mailEnabled: mailEnabled() }));
  });
  app.get('/api/auth/options', (req, res) => res.json({ magicLink: !!settings().magicLink && mailEnabled(), forgot: true }));

  // ---------- client notifications ----------
  app.get('/api/portal/notifications', need('client'), (req, res) => res.json({ email: !req.user.notifyOptOut, available: mailEnabled() && settings().notifications !== false }));
  app.put('/api/portal/notifications', need('client'), (req, res) => {
    req.user.notifyOptOut = !(req.body || {}).email;
    db.audit({ actor: req.user.email, action: 'portal.notifications', detail: req.user.notifyOptOut ? 'opt-out' : 'opt-in' });
    db.persist();
    res.json({ email: !req.user.notifyOptOut });
  });

  const sent = () => (D().notified = D().notified || {});
  async function notifyClient(clientId, key, subject, line, req) {
    if (settings().notifications === false || sent()[key]) return;
    sent()[key] = new Date().toISOString();
    const users = D().users.filter(u => u.role === 'client' && u.clientId === clientId && !u.disabled && !u.notifyOptOut);
    const link = req ? `${origin(req)}/portal` : 'your client portal';
    for (const u of users) await mail(u, subject, `${line}\n\nSign in to see the details: ${link}\n\nYou can turn these emails off in the portal.`);
    db.audit({ actor: 'system', action: 'notify', detail: `${key} → ${users.length}` });
  }

  /** Called after staff save the workspace: diff disputes and email the affected clients. */
  function onWorkspaceSaved(before, after, req) {
    const old = new Map(((before && before.disputes) || []).map(d => [d.id, d]));
    ((after && after.disputes) || []).forEach(d => {
      const p = old.get(d.id) || { items: [] };
      if (d.outcome && !p.outcome) notifyClient(d.clientId, `resp:${d.id}`, 'Update on your credit file', `A response from ${d.recipient} has been recorded on your file.`, req);
      (d.items || []).forEach((it, i) => {
        const was = (p.items || [])[i] || {};
        if (['deleted', 'corrected'].includes(it.result) && it.result !== was.result) notifyClient(d.clientId, `item:${d.id}:${i}:${it.result}`, 'Good news on your credit file', `An item you disputed with ${d.recipient || 'a bureau'} was ${it.result === 'deleted' ? 'removed' : 'corrected'}.`, req);
      });
    });
    db.persistSoon();
  }

  /** Hourly: email clients when a bureau response is due within 3 days. */
  function deadlineSweep() {
    const soon = Date.now() + 3 * 86400000;
    ((workspace().disputes) || []).forEach(d => {
      if (d.sentAt && !d.outcome && d.dueAt && Date.parse(d.dueAt) <= soon && Date.parse(d.dueAt) >= Date.now() - 86400000) notifyClient(d.clientId, `due:${d.id}`, 'A dispute deadline is coming up', `${d.recipient}’s response to your dispute is due by ${d.dueAt}. We’ll follow up if it doesn’t arrive.`);
    });
    // Business credit plan: remind the client when a step is due within 2 days (once per step and due date).
    const t0 = new Date().toISOString().slice(0, 10);
    ((workspace().clients) || []).filter(c => c.kind !== 'personal' && c.creditPlan && c.creditPlan.startedAt).forEach(c => {
      const cur = Business.coachState(c, workspace(), t0).current;
      if (cur && Date.parse(cur.due) <= Date.now() + 2 * 86400000 && !(c.creditPlan.clientConfirmed || {})[cur.key]) notifyClient(c.id, `step:${c.id}:${cur.key}:${cur.due}`, 'Your next business credit step', `Your next business credit plan step is due ${cur.due}: ${cur.title.split(':')[0]}. Sign in to your portal to see how to do it, and tap “I’ve done this” when it’s finished.`);
    });
    db.persistSoon();
  }
  const timer = setInterval(deadlineSweep, 60 * 60 * 1000);
  timer.unref();

  return { otpRequired, startOtp, onWorkspaceSaved, deadlineSweep, notifyClient, stop: () => clearInterval(timer) };
}
