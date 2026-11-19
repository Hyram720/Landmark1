// Public self-signup. Creates the same kind of client user invite-accept creates
// (scrypt password, role client, clientId) and leaves the client pending.
// No payment provider is called from this module.
// TODO(billing): do not charge here. Results-on-the-report is the business rule.
import crypto from 'node:crypto';
import { hashPassword, passwordProblem, rateLimiter } from './auth.js';
import { sendMail, mailMode } from './mailer.js';
import { clientAuthMethod } from './auth-method.js';
import { postKitForm } from './kit-hook.js';
import { mailingAddress, enrollmentStatus } from './croa-docs.js';
import { etYmd } from './croa-window.js';

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VERIFY_TTL = 24 * 60 * 60 * 1000;

export const SIGNUP_OK = {
  ok: true,
  message: 'Check your email for the next step. If this address can be used, a message is on its way.'
};
export const SIGNUP_DISABLED = 'Self-signup is disabled.';
export const MARKETING_CONSENT_TEXT = 'Email me occasional credit tips and Credit Ledger news, which may include offers. Optional.';
const ACCOUNT_TERMS_VERSION = 'placeholder-client-terms-2026-11-18';

function cleanName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}
function yes(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export function selfSignupEnabled(env = process.env, override) {
  if (typeof override === 'boolean') return override;
  const v = String(env.LEDGER_SELF_SIGNUP_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export function mountSignup(app, deps) {
  const { D, db, workspace, startSession, uid, activity, commitWorkspace, authMethod, signupRateLimit, enabled, publicBaseUrl: baseOverride, now } = deps;
  const today = () => etYmd(typeof now === 'function' ? now() : new Date());
  const method = () => clientAuthMethod(typeof authMethod === 'function' ? authMethod() : authMethod);
  const limit = rateLimiter(signupRateLimit || 8, 15 * 60 * 1000);
  const origin = () => String(baseOverride || '').replace(/\/+$/, '');

  function issueVerify(user) {
    const raw = crypto.randomBytes(32).toString('base64url');
    D().authTokens = (D().authTokens || []).filter(t => !(t.userId === user.id && t.kind === 'verify'));
    D().authTokens.push({ hash: sha(raw), kind: 'verify', userId: user.id, expiresAt: Date.now() + VERIFY_TTL, usedAt: null });
    return raw;
  }

  async function sendVerify(user, raw) {
    const link = `${origin()}/portal#verify=${raw}`;
    const verb = method() === 'magic_link'
      ? `Confirm your email and sign in (works once, expires in 24 hours):\n${link}\n\nThis link is how you sign in. If you did not ask for it, ignore this email.`
      : `Confirm your email (works once, expires in 24 hours):\n${link}\n\nAfter you confirm, sign in with the password you chose. If you did not ask for this, ignore this email.`;
    try {
      await sendMail({ to: user.email, subject: 'Confirm your Credit Ledger portal email', text: verb });
    } catch (e) {
      console.error('[mail] signup verify:', e.message);
    }
    if (mailMode() === 'off') console.info('[mail] signup verification stubbed (LEDGER_MAIL_MODE=off)');
  }

  app.post('/api/signup', async (req, res) => {
    if (!enabled) return res.status(404).json({ error: SIGNUP_DISABLED });
    if (!limit(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const b = req.body || {};
    if (String(b.website || b.company_website || '').trim()) {
      db.audit({ actor: 'public', action: 'signup.honeypot', detail: req.ip });
      db.persist();
      return res.json(SIGNUP_OK);
    }
    const first = cleanName(b.firstName);
    const last = cleanName(b.lastName);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    if (!first || !last || !EMAIL.test(email)) return res.status(400).json({ error: 'First name, last name, and a valid email are required.' });
    if (!yes(b.acceptAccountTerms)) return res.status(400).json({ error: 'Accept the account terms to create a portal account.' });
    if (String(b.state || '').trim().toUpperCase() !== 'NJ' || !yes(b.njResident)) return res.status(400).json({ error: 'Credit Ledger serves New Jersey residents. Confirm that you live in New Jersey.' });
    const street = String(b.address || '').trim().slice(0, 120);
    const city = String(b.city || '').trim().slice(0, 60);
    const zip = String(b.zip || '').trim().slice(0, 10);
    if (street || city || zip) {
      const draft = { address: street, city, state: 'NJ', zip };
      if (!mailingAddress(draft)) return res.status(400).json({ error: enrollmentStatus(draft, {}).message });
    }
    const mode = method();
    let passwordHash;
    if (mode === 'password') {
      const prob = passwordProblem(b.password);
      if (prob) return res.status(400).json({ error: prob });
      passwordHash = hashPassword(b.password);
    } else {
      passwordHash = hashPassword(crypto.randomBytes(24).toString('base64url'));
    }
    const normEmail = value => String(value || '').trim().toLowerCase();
    const exists = D().users.some(u => normEmail(u.email) === email && !u.disabled);
    if (exists) {
      db.audit({ actor: 'public', action: 'signup.duplicate', detail: 'email not revealed' });
      db.persist();
      return res.json(SIGNUP_OK);
    }
    const matchedClient = (workspace().clients || []).find(c => c && normEmail(c.email) === email);
    const clientId = uid();
    const now = new Date().toISOString();
    const client = {
      id: clientId,
      name: `${first} ${last}`,
      firstName: first,
      lastName: last,
      kind: 'personal',
      email,
      phone: '',
      address: street, city, state: 'NJ', zip, dob: '', ssnLast4: '',
      status: 'pending',
      signupSource: 'self',
      addedBy: 'Self-signup',
      createdAt: now,
      notes: 'Self-signup. No service work until the contract is signed and the cancellation window ends.',
      onboarding: {},
      njResidentAt: now,
      marketingConsent: yes(b.marketingConsent),
      marketingConsentAt: yes(b.marketingConsent) ? now : null,
      marketingConsentText: yes(b.marketingConsent) ? MARKETING_CONSENT_TEXT : '',
      marketingConsentSha256: yes(b.marketingConsent) ? sha(MARKETING_CONSENT_TEXT) : '',
      accountTermsVersion: ACCOUNT_TERMS_VERSION,
      accountTermsSha256: sha(ACCOUNT_TERMS_VERSION),
      signupIp: req.ip,
      signupUserAgent: String(req.get('user-agent') || '').slice(0, 300)
    };
    if (matchedClient) client.possible_duplicate = matchedClient.id;
    const user = {
      id: uid(),
      name: client.name,
      email,
      role: 'client',
      clientId,
      password: passwordHash,
      sessionEpoch: 1,
      createdAt: now,
      signupSource: 'self',
      emailVerifiedAt: null,
      authMethod: mode
    };
    workspace().clients.push(client);
    if (matchedClient) {
      workspace().tasks = workspace().tasks || [];
      workspace().tasks.push({ id: uid(), clientId, title: `Review a possible duplicate signup for ${client.name} and merge it with the existing client if they are the same person.`, due: today(), done: false, createdAt: now, kind: 'possible_duplicate', matchedClientId: matchedClient.id });
    }
    D().users.push(user);
    const raw = issueVerify(user);
    activity(`Self-signup pending: ${client.name}. No service work until CROA onboarding clears.`, clientId);
    db.audit({ actor: email, action: 'signup.create', detail: mode });
    commitWorkspace('public', 'signup.create', clientId);
    await sendVerify(user, raw);
    if (yes(b.marketingConsent)) {
      try { await postKitForm({ email, firstName: first, source: 'account-signup' }); }
      catch (e) { console.error('[kit] signup:', e.message); }
    }
    res.json(SIGNUP_OK);
  });

  app.post('/api/signup/verify', (req, res) => {
    if (!limit('v:' + req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const raw = String((req.body || {}).token || '');
    const rec = (D().authTokens || []).find(t => t.kind === 'verify' && t.hash === sha(raw) && !t.usedAt && t.expiresAt > Date.now());
    if (!rec) return res.status(400).json({ error: 'This confirmation link is invalid, expired, or already used.' });
    const user = D().users.find(u => u.id === rec.userId && !u.disabled);
    if (!user) return res.status(400).json({ error: 'This confirmation link is invalid, expired, or already used.' });
    rec.usedAt = new Date().toISOString();
    user.emailVerifiedAt = rec.usedAt;
    db.audit({ actor: user.email, action: 'signup.verify', detail: user.authMethod || 'password' });
    db.persist();
    startSession(req, res, user);
    res.json({ ok: true, user: { id: user.id, email: user.email, role: user.role, clientId: user.clientId } });
  });
}
