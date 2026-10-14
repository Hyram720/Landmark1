// Ledger API + static host. Staff use the workspace app, clients use the portal, and prospects use
// the public intake form. Run with `npm run ledger`.
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import { commsConfig, sendEmail, sendSms } from './comms.js';
import { askAssistant, assistantConfigured, setKeyProvider, checkKey } from './assistant.js';
import { scanReport, planRound } from './ai.js';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, passwordProblem, rateLimiter } from './auth.js';
import { Law, Partners, Store, Sales, Invoices } from './shared.js';
import { parseAddress, checkLobKey, sendLetter, getLetter } from './mail.js';
import { checkCredentials, hostedPaymentToken, findPayment, PAY_PAGE } from './payments.js';

const SESSION_COOKIE = 'ledger_session';
const SESSION_TTL = 60 * 60 * 12; // 12 hours
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ledgerDir = path.resolve(new URL('..', import.meta.url).pathname);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);
const plain = (o) => JSON.parse(JSON.stringify(o));

export function createApp({ dataDir, encryptionKey } = {}) {
  const db = openDb({ dir: dataDir, encryptionKey });
  const filesDir = path.join(dataDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  const fileKey = encryptionKey ? crypto.createHash('sha256').update('files:' + encryptionKey).digest() : null;
  const D = () => db.data;
  setKeyProvider(() => (db.data.secrets && db.data.secrets.anthropicKey) || '');
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  const loginLimit = rateLimiter(10, 15 * 60 * 1000);
  const intakeLimit = rateLimiter(5, 60 * 60 * 1000);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
    });
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  // ---------- helpers ----------
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  function currentUser(req) {
    const p = verifyToken(cookies(req)[SESSION_COOKIE], D().secret);
    if (!p) return null;
    const u = D().users.find(x => x.id === p.uid && !x.disabled);
    return u && u.sessionEpoch === p.ep ? u : null;
  }
  function startSession(req, res, u) {
    const token = signToken({ uid: u.id, ep: u.sessionEpoch }, D().secret, SESSION_TTL);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_TTL * 1000, path: '/' });
  }
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, clientId: u.clientId || null, referralId: u.referralId || null });
  const need = (...roles) => (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Sign in required' });
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
    req.user = u;
    next();
  };
  function workspace() {
    if (!D().workspace) D().workspace = plain(Store.empty());
    return D().workspace;
  }
  function commitWorkspace(actor, action, detail) {
    D().workspaceVersion += 1;
    db.audit({ actor, action, detail });
    db.persist();
  }
  function activity(text, clientId) {
    workspace().activity.unshift({ id: uid(), at: new Date().toISOString(), text, clientId: clientId || null });
  }

  // ---------- session ----------
  app.get('/api/session', (req, res) => {
    const u = currentUser(req);
    res.json({ mode: 'server', setupRequired: D().users.length === 0, setupCodeRequired: !!process.env.LEDGER_SETUP_CODE, user: u ? publicUser(u) : null, encrypted: db.encrypted });
  });

  app.post('/api/setup', (req, res) => {
    if (D().users.length) return res.status(409).json({ error: 'Already set up' });
    const { name, email, password, setupCode } = req.body || {};
    if (process.env.LEDGER_SETUP_CODE && String(setupCode || '').replace(/\s+/g, '').toUpperCase() !== process.env.LEDGER_SETUP_CODE.replace(/\s+/g, '').toUpperCase()) return res.status(403).json({ error: 'That setup code is not correct. Check the LEDGER_SETUP_CODE value in Railway → Variables.' });
    const prob = passwordProblem(password);
    if (!name || !/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'Name and a valid email are required' });
    if (prob) return res.status(400).json({ error: prob });
    const u = { id: uid(), name, email: email.toLowerCase(), role: 'owner', password: hashPassword(password), sessionEpoch: 1, createdAt: new Date().toISOString() };
    D().users.push(u);
    db.audit({ actor: u.email, action: 'setup', detail: 'Owner account created' });
    db.persist();
    startSession(req, res, u);
    res.json({ user: publicUser(u) });
  });

  app.post('/api/login', (req, res) => {
    if (!loginLimit(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const { email, password } = req.body || {};
    const u = D().users.find(x => x.email === String(email || '').toLowerCase() && !x.disabled);
    if (!u || !verifyPassword(password, u.password)) return res.status(401).json({ error: 'Email or password is incorrect' });
    db.audit({ actor: u.email, action: 'login', detail: req.ip });
    db.persist();
    startSession(req, res, u);
    res.json({ user: publicUser(u) });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // ---------- staff workspace ----------
  app.get('/api/workspace', need('owner', 'staff'), (req, res) => res.json({ version: D().workspaceVersion, data: workspace() }));
  app.get('/api/workspace/version', need('owner', 'staff'), (req, res) => res.json({ version: D().workspaceVersion }));
  app.put('/api/workspace', need('owner', 'staff'), (req, res) => {
    const { baseVersion, data } = req.body || {};
    if (!data || data.version !== 2 || !Array.isArray(data.clients)) return res.status(400).json({ error: 'Invalid workspace' });
    if (baseVersion !== D().workspaceVersion) return res.status(409).json({ error: 'Workspace changed elsewhere', version: D().workspaceVersion, data: workspace() });
    D().workspace = data;
    commitWorkspace(req.user.email, 'workspace.save', `${data.clients.length} clients`);
    res.json({ version: D().workspaceVersion });
  });

  // ---------- team & invites ----------
  app.get('/api/users', need('owner'), (req, res) => res.json(D().users.map(publicUser)));
  app.delete('/api/users/:id', need('owner'), (req, res) => {
    const u = D().users.find(x => x.id === req.params.id);
    if (!u || u.id === req.user.id) return res.status(400).json({ error: 'Cannot remove this user' });
    u.disabled = true;
    u.sessionEpoch += 1;
    db.audit({ actor: req.user.email, action: 'user.disable', detail: u.email });
    db.persist();
    res.json({ ok: true });
  });
  app.post('/api/invites', need('owner', 'staff'), (req, res) => {
    const { role, clientId, referralId, name, email } = req.body || {};
    if (role === 'staff' && req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can invite staff' });
    if (!['staff', 'client', 'partner'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    let c, rf;
    if (role === 'client') {
      c = workspace().clients.find(x => x.id === clientId);
      if (!c) return res.status(404).json({ error: 'Client not found' });
    }
    if (role === 'partner') {
      rf = (workspace().referrals || []).find(x => x.id === referralId);
      if (!rf) return res.status(404).json({ error: 'Referral partner not found' });
    }
    const token = crypto.randomBytes(24).toString('base64url');
    D().invites.push({ hash: sha(token), role, clientId: clientId || null, referralId: rf ? rf.id : null, name: name || (c && c.name) || (rf && rf.name) || '', email: (email || (c && c.email) || (rf && rf.email) || '').toLowerCase(), expiresAt: Date.now() + INVITE_TTL_MS, usedAt: null });
    db.audit({ actor: req.user.email, action: 'invite.create', detail: `${role} ${email || (c && c.name) || (rf && rf.name) || ''}` });
    db.persist();
    const page = role === 'client' ? 'portal' : role === 'partner' ? 'partner' : 'app';
    res.json({ url: `${req.protocol}://${req.get('host')}/${page}#invite=${token}`, expiresInDays: 7 });
  });
  app.post('/api/invites/accept', (req, res) => {
    const { token, password, email } = req.body || {};
    const inv = D().invites.find(i => i.hash === sha(token) && !i.usedAt && i.expiresAt > Date.now());
    if (!inv) return res.status(400).json({ error: 'This invitation is invalid or has expired' });
    const prob = passwordProblem(password);
    if (prob) return res.status(400).json({ error: prob });
    const addr = (inv.email || String(email || '')).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return res.status(400).json({ error: 'A valid email is required' });
    if (D().users.some(u => u.email === addr && !u.disabled)) return res.status(409).json({ error: 'An account already exists for this email' });
    const u = { id: uid(), name: inv.name, email: addr, role: inv.role, clientId: inv.clientId, referralId: inv.referralId || null, password: hashPassword(password), sessionEpoch: 1, createdAt: new Date().toISOString() };
    D().users.push(u);
    inv.usedAt = new Date().toISOString();
    db.audit({ actor: addr, action: 'invite.accept', detail: inv.role });
    db.persist();
    startSession(req, res, u);
    res.json({ user: publicUser(u) });
  });
  app.get('/api/audit', need('owner'), (req, res) => res.json(D().audit.slice(0, 300)));

  // ---------- client portal ----------
  const company = () => workspace().settings.company || {};
  function portalClient(req) { return workspace().clients.find(c => c.id === req.user.clientId); }
  function documentsFor(c) {
    const cs = Store.croaStatus(c);
    return {
      disclosure: Law.CROA_DISCLOSURE,
      contract: Law.contractTerms(company(), c, workspace().settings.defaultFee),
      cancellation: Law.cancellationNotice(company(), cs.deadline)
    };
  }
  app.get('/api/portal/me', need('client'), (req, res) => {
    const ws = workspace();
    const c = portalClient(req);
    if (!c) return res.status(404).json({ error: 'Your file is not available. Contact us.' });
    const cs = Store.croaStatus(c);
    const scores = {};
    ws.reports.filter(r => r.clientId === c.id).sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(r => Object.entries(r.scores || {}).forEach(([b, v]) => { if (v) (scores[b] = scores[b] || []).push({ date: r.date, score: Number(v) }); }));
    const disputes = ws.disputes.filter(d => d.clientId === c.id).map(d => ({
      id: d.id, recipient: d.recipient, type: (Law.DISPUTE_TYPES[d.type] || {}).label, round: d.round, state: Store.disputeState(d),
      sentAt: d.sentAt, dueAt: d.dueAt, respondedAt: d.respondedAt, items: d.items.map(i => i.creditor + (i.result === 'deleted' ? ' (removed)' : i.result === 'corrected' ? ' (corrected)' : ''))
    }));
    const removed = []; ws.disputes.filter(d => d.clientId === c.id).forEach(d => d.items.forEach(i => { if (i.result === 'deleted' || i.result === 'corrected' || (!i.result && ['deleted', 'corrected'].includes(d.outcome))) removed.push({ creditor: i.creditor, bureau: i.bureau || d.recipient, result: i.result || d.outcome, at: i.resultAt || d.respondedAt }); }));
    const recs = (ws.partnerReferrals || []).filter(r => r.clientId === c.id && r.status !== 'declined').map(r => {
      const o = ws.offers.find(x => x.id === r.offerId) || {};
      return { id: r.id, name: o.name, category: o.category, why: r.note || o.note, url: `/go/${r.id}`, status: r.status };
    });
    res.json({
      client: { name: c.name, kind: c.kind, status: c.status },
      company: { name: company().name, phone: company().phone, email: company().email },
      croa: { required: cs.required, steps: cs.steps.map(s => ({ label: s.label, done: s.done, date: s.date })), deadline: cs.deadline, inWindow: cs.inWindow, cancelled: cs.cancelled,
        disclosureSigned: !!(c.onboarding || {}).disclosureSignedAt, contractSigned: !!(c.onboarding || {}).contractSignedAt },
      documents: documentsFor(c), wins: removed, uploads: (ws.documents || []).filter(d => d.clientId === c.id).map(d => ({ id: d.id, name: d.name, type: d.type, uploadedAt: d.uploadedAt })), scores, disputes, recommendations: recs, referralDisclosure: Partners.DISCLOSURE,
      business: c.kind !== 'personal' ? { name: (c.business || {}).legalName || '', checklist: c.businessChecklist || {}, scores: c.businessScores || [] } : null
    });
  });

  app.post('/api/portal/sign', need('client'), (req, res) => {
    const c = portalClient(req);
    const { doc, typedName, agree } = req.body || {};
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!['disclosure', 'contract'].includes(doc)) return res.status(400).json({ error: 'Unknown document' });
    if (!agree || String(typedName || '').trim().toLowerCase() !== String(c.name).trim().toLowerCase()) return res.status(400).json({ error: `Type your full name exactly as “${c.name}” and check the box to sign.` });
    c.onboarding = c.onboarding || {};
    if (doc === 'contract' && !c.onboarding.disclosureSignedAt) return res.status(400).json({ error: 'Please acknowledge the Consumer Credit File Rights statement first.' });
    if (c.onboarding[doc === 'disclosure' ? 'disclosureSignedAt' : 'contractSignedAt']) return res.status(409).json({ error: 'Already signed' });
    const text = documentsFor(c)[doc];
    const sig = { id: uid(), clientId: c.id, doc, typedName, at: new Date().toISOString(), ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300), documentSha256: sha(text), consent: 'E-SIGN consent to sign electronically' };
    workspace().signatures.push(sig);
    if (doc === 'disclosure') c.onboarding.disclosureSignedAt = today();
    else {
      c.onboarding.contractSignedAt = today();
      c.onboarding.authorizationAt = c.onboarding.authorizationAt || today();
      if (c.status === 'lead') c.status = 'onboarding';
    }
    activity(`${c.name} e-signed the ${doc === 'disclosure' ? 'rights disclosure' : 'services agreement'} in the portal`, c.id);
    commitWorkspace(req.user.email, 'portal.sign', `${doc} ${sig.documentSha256.slice(0, 12)}`);
    res.json({ ok: true, signature: sig });
  });

  app.post('/api/portal/cancel', need('client'), (req, res) => {
    const c = portalClient(req);
    if (!c) return res.status(404).json({ error: 'Not found' });
    c.onboarding = c.onboarding || {};
    if (c.onboarding.cancelledAt) return res.json({ ok: true });
    c.onboarding.cancelledAt = today();
    c.status = 'cancelled';
    activity(`${c.name} cancelled through the portal — refund anything paid`, c.id);
    workspace().tasks.push({ id: uid(), clientId: c.id, title: `Process cancellation for ${c.name} (refund any payments)`, due: today(), done: false, createdAt: new Date().toISOString() });
    commitWorkspace(req.user.email, 'portal.cancel', c.id);
    res.json({ ok: true });
  });

  // ---------- partner referral redirects ----------
  app.get('/go/:id', (req, res) => {
    const ws = workspace();
    const r = (ws.partnerReferrals || []).find(x => x.id === req.params.id);
    const o = r ? ws.offers.find(x => x.id === r.offerId) : ws.offers.find(x => x.id === req.params.id);
    if (!o) return res.status(404).send('Link not found');
    const dest = o.affiliateUrl || o.url;
    if (!/^https:\/\//.test(dest || '')) return res.status(404).send('Link not configured');
    if (r) {
      r.clicks = (r.clicks || 0) + 1;
      if (!r.clickedAt) r.clickedAt = new Date().toISOString();
      if (r.status === 'recommended') r.status = 'clicked';
    } else o.clicks = (o.clicks || 0) + 1;
    commitWorkspace('public', 'referral.click', o.key);
    res.redirect(302, dest);
  });

  // ---------- public intake ----------
  app.post('/api/intake', (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot
    if (!intakeLimit(req.ip)) return res.status(429).json({ error: 'Too many submissions. Please call us instead.' });
    const kind = ['personal', 'business', 'both'].includes(b.kind) ? b.kind : 'personal';
    const first = String(b.firstName || '').trim().slice(0, 60), last = String(b.lastName || '').trim().slice(0, 60);
    if (!first || !last || !/^\S+@\S+\.\S+$/.test(b.email || '')) return res.status(400).json({ error: 'Name and a valid email are required' });
    if (!b.consent) return res.status(400).json({ error: 'Please agree to be contacted' });
    const c = {
      id: uid(), name: `${first} ${last}`, firstName: first, lastName: last, kind, email: String(b.email).toLowerCase().slice(0, 120), phone: String(b.phone || '').slice(0, 30),
      address: '', city: '', state: String(b.state || '').slice(0, 2).toUpperCase(), zip: '', dob: '', ssnLast4: '', status: 'lead', createdAt: new Date().toISOString(),
      notes: [b.goals && `Goals: ${String(b.goals).slice(0, 1000)}`, b.source && `Heard about us: ${String(b.source).slice(0, 100)}`].filter(Boolean).join('\n'),
      referralId: (workspace().referrals || []).some(r => r.id === b.ref) ? b.ref : '', onboarding: {}, smsConsent: !!b.smsConsent,
      business: kind !== 'personal' ? { legalName: String(b.businessName || '').slice(0, 120), entityType: String(b.entityType || '').slice(0, 30), formedOn: '', website: String(b.businessWebsite || '').slice(0, 120) } : undefined
    };
    workspace().clients.push(c);
    workspace().tasks.push({ id: uid(), clientId: c.id, title: `Call new ${kind} lead ${c.name}`, due: today(), done: false, createdAt: new Date().toISOString() });
    activity(`New ${kind} lead from the website: ${c.name}`, c.id);
    commitWorkspace('public', 'intake', c.id);
    res.json({ ok: true });
  });

  // ---------- communications ----------
  // ---------- owner settings: AI key ----------
  const keyInfo = () => {
    const env = process.env.ANTHROPIC_API_KEY, saved = D().secrets && D().secrets.anthropicKey;
    const k = env || saved || '';
    return { configured: !!k, source: env ? 'server' : saved ? 'settings' : null, last4: k ? k.slice(-4) : '', savedAt: (D().secrets || {}).anthropicKeySavedAt || null };
  };
  app.get('/api/settings/ai', need('owner'), (req, res) => res.json(keyInfo()));
  app.put('/api/settings/ai', need('owner'), async (req, res) => {
    const key = String((req.body || {}).anthropicKey || '').trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return res.status(400).json({ error: 'That doesn’t look like an Anthropic API key. It starts with sk-ant-.' });
    const check = await checkKey(key);
    if (check === 'invalid') return res.status(400).json({ error: 'Anthropic rejected this key. Copy it again from console.anthropic.com.' });
    D().secrets = Object.assign(D().secrets || {}, { anthropicKey: key, anthropicKeySavedAt: new Date().toISOString() });
    db.audit({ actor: req.user.email, action: 'settings.ai_key', detail: `saved …${key.slice(-4)} (${check})` });
    db.persist();
    res.json(Object.assign(keyInfo(), { verified: check === 'ok' }));
  });
  app.delete('/api/settings/ai', need('owner'), (req, res) => {
    if (D().secrets) { delete D().secrets.anthropicKey; delete D().secrets.anthropicKeySavedAt; }
    db.audit({ actor: req.user.email, action: 'settings.ai_key', detail: 'removed' });
    db.persist();
    res.json(keyInfo());
  });

  app.get('/api/config', need('owner', 'staff'), (req, res) => res.json(Object.assign(commsConfig(), { assistant: assistantConfigured() })));
  const aiLimit = rateLimiter(60, 60 * 60 * 1000);
  app.post('/api/assistant', need('owner', 'staff'), async (req, res) => {
    if (!assistantConfigured()) return res.status(501).json({ error: 'AI is off. The owner can add an Anthropic API key in Settings → AI settings.' });
    if (!aiLimit(req.user.id)) return res.status(429).json({ error: 'Hourly assistant limit reached. Try again later.' });
    const { clientId, history } = req.body || {};
    if (!Array.isArray(history) || !history.length) return res.status(400).json({ error: 'Ask a question first' });
    try {
      const out = await askAssistant({ ws: workspace(), clientId, history });
      db.audit({ actor: req.user.email, action: 'assistant.ask', detail: clientId || 'general' });
      db.persist();
      res.json(out);
    } catch (e) {
      const status = e.status === 429 ? 429 : e.status >= 400 && e.status < 500 ? 400 : 502;
      res.status(status).json({ error: status === 429 ? 'The AI service is busy. Try again in a minute.' : `Assistant error: ${e.message}` });
    }
  });
  app.post('/api/messages', need('owner', 'staff'), async (req, res) => {
    const { clientId, channel, subject, body } = req.body || {};
    const c = workspace().clients.find(x => x.id === clientId);
    if (!c) return res.status(404).json({ error: 'Client not found' });
    if (!String(body || '').trim()) return res.status(400).json({ error: 'Message is empty' });
    const cfg = commsConfig();
    if (!cfg[channel]) return res.status(501).json({ error: `${channel === 'sms' ? 'SMS' : 'Email'} sending is not configured on the server` });
    if (channel === 'sms' && !c.smsConsent) return res.status(400).json({ error: 'No SMS consent on file for this client (TCPA). Record consent first.' });
    const to = channel === 'sms' ? c.phone : c.email;
    if (!to) return res.status(400).json({ error: `Client has no ${channel === 'sms' ? 'phone number' : 'email'}` });
    try {
      const providerId = channel === 'sms' ? await sendSms({ to, text: body }) : await sendEmail({ to, subject: subject || 'Update on your credit file', text: body });
      const ws = workspace();
      ws.messages = ws.messages || [];
      ws.messages.unshift({ id: uid(), clientId, channel, to, subject: subject || '', body, at: new Date().toISOString(), by: req.user.email, status: 'sent', providerId });
      commitWorkspace(req.user.email, 'message.send', `${channel} to ${clientId}`);
      res.json({ ok: true, version: D().workspaceVersion });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ---------- AI report scanning & round planning ----------
  const aiError = (res, e) => {
    const status = e.status === 404 ? 404 : e.status === 429 ? 429 : e.status >= 400 && e.status < 500 ? 400 : 502;
    res.status(status).json({ error: status === 429 ? 'The AI service is busy. Try again in a minute.' : e.message });
  };
  app.post('/api/clients/:id/files/:docId/scan', need('owner', 'staff'), async (req, res) => {
    if (!assistantConfigured()) return res.status(501).json({ error: 'AI is off. The owner can add an Anthropic API key in Settings → AI settings.' });
    if (!aiLimit(req.user.id)) return res.status(429).json({ error: 'Hourly AI limit reached. Try again later.' });
    const doc = (workspace().documents || []).find(d => d.id === req.params.docId && d.clientId === req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    try {
      const out = await scanReport({ buffer: readFile(doc.id), mime: doc.mime });
      db.audit({ actor: req.user.email, action: 'ai.scan', detail: doc.name });
      db.persist();
      res.json(out);
    } catch (e) { aiError(res, e); }
  });
  app.post('/api/clients/:id/scan-text', need('owner', 'staff'), async (req, res) => {
    if (!assistantConfigured()) return res.status(501).json({ error: 'AI is off. The owner can add an Anthropic API key in Settings → AI settings.' });
    if (!aiLimit(req.user.id)) return res.status(429).json({ error: 'Hourly AI limit reached. Try again later.' });
    const text = String((req.body || {}).text || '');
    if (text.trim().length < 200) return res.status(400).json({ error: 'Paste the full report text (select all on the report page, copy, then paste).' });
    if (!workspace().clients.some(c => c.id === req.params.id)) return res.status(404).json({ error: 'Client not found' });
    try {
      const isHtml = /<(table|div|td|html)\b/i.test(text);
      const out = await scanReport({ buffer: Buffer.from(text.slice(0, 600000), 'utf8'), mime: isHtml ? 'text/html' : 'text/plain' });
      db.audit({ actor: req.user.email, action: 'ai.scan', detail: 'pasted text' });
      db.persist();
      res.json(out);
    } catch (e) { aiError(res, e); }
  });
  app.post('/api/clients/:id/ai-plan', need('owner', 'staff'), async (req, res) => {
    if (!assistantConfigured()) return res.status(501).json({ error: 'AI is off. The owner can add an Anthropic API key in Settings → AI settings.' });
    if (!aiLimit(req.user.id)) return res.status(429).json({ error: 'Hourly AI limit reached. Try again later.' });
    try {
      const out = await planRound({ ws: workspace(), clientId: req.params.id });
      db.audit({ actor: req.user.email, action: 'ai.plan', detail: req.params.id });
      db.persist();
      res.json(out);
    } catch (e) { aiError(res, e); }
  });

  // ---------- documents ----------
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (req, f, cb) => cb(null, /^(application\/pdf|image\/(png|jpeg|webp)|text\/(html|csv|plain)|application\/json)$/.test(f.mimetype)) });
  function storeFile(file, meta) {
    const id = uid();
    let buf = file.buffer;
    if (fileKey) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', fileKey, iv);
      buf = Buffer.concat([iv, c.update(buf), c.final(), c.getAuthTag()]);
    }
    fs.writeFileSync(path.join(filesDir, id), buf, { mode: 0o600 });
    const doc = Object.assign({ id, name: String(file.originalname).slice(0, 160), mime: file.mimetype, size: file.size, uploadedAt: new Date().toISOString() }, meta);
    const ws = workspace();
    ws.documents = ws.documents || [];
    ws.documents.unshift(doc);
    return doc;
  }
  function readFile(id) {
    let buf = fs.readFileSync(path.join(filesDir, id));
    if (fileKey) {
      const d = crypto.createDecipheriv('aes-256-gcm', fileKey, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(buf.length - 16));
      buf = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
    }
    return buf;
  }
  const DOC_TYPES = ['report', 'id', 'address', 'bureau-response', 'agreement', 'other'];
  app.post('/api/clients/:id/files', need('owner', 'staff'), upload.single('file'), (req, res) => {
    const c = workspace().clients.find(x => x.id === req.params.id);
    if (!c || !req.file) return res.status(400).json({ error: 'Choose a PDF, image, HTML, CSV or JSON file under 15 MB' });
    const doc = storeFile(req.file, { clientId: c.id, type: DOC_TYPES.includes(req.body.type) ? req.body.type : 'other', uploadedBy: req.user.email });
    activity(`Uploaded ${doc.type === 'report' ? 'credit report' : 'document'} “${doc.name}”`, c.id);
    commitWorkspace(req.user.email, 'file.upload', doc.name);
    res.json({ doc, version: D().workspaceVersion });
  });
  app.post('/api/portal/files', need('client'), upload.single('file'), (req, res) => {
    const c = portalClient(req);
    if (!c || !req.file) return res.status(400).json({ error: 'Choose a PDF or image under 15 MB' });
    const doc = storeFile(req.file, { clientId: c.id, type: ['id', 'address', 'bureau-response', 'report'].includes(req.body.type) ? req.body.type : 'other', uploadedBy: 'client' });
    activity(`${c.name} uploaded “${doc.name}” in the portal`, c.id);
    commitWorkspace(req.user.email, 'portal.upload', doc.name);
    res.json({ ok: true });
    if (doc.type === 'report') autoScan(c, doc);
  });
  // Reports a client uploads are read by AI in the background and wait on the client page for one-click import.
  async function autoScan(c, doc) {
    const ws = workspace();
    ws.pendingImports = ws.pendingImports || [];
    if (!assistantConfigured()) {
      ws.tasks.push({ id: uid(), clientId: c.id, title: `Import the credit report ${c.name} uploaded (${doc.name})`, due: today(), done: false, createdAt: new Date().toISOString() });
      commitWorkspace('system', 'report.uploaded', doc.name);
      return;
    }
    try {
      const out = await scanReport({ buffer: readFile(doc.id), mime: doc.mime });
      ws.pendingImports.unshift({ id: uid(), clientId: c.id, docId: doc.id, docName: doc.name, scannedAt: new Date().toISOString(), result: out });
      activity(`AI read the report ${c.name} uploaded — ready to import`, c.id);
      ws.tasks.push({ id: uid(), clientId: c.id, title: `Review & import the report ${c.name} uploaded (AI already read it)`, due: today(), done: false, createdAt: new Date().toISOString() });
      commitWorkspace('system', 'ai.autoscan', doc.name);
    } catch (e) {
      ws.tasks.push({ id: uid(), clientId: c.id, title: `AI could not read ${doc.name} for ${c.name} — import it manually (${String(e.message).slice(0, 80)})`, due: today(), done: false, createdAt: new Date().toISOString() });
      commitWorkspace('system', 'ai.autoscan.failed', doc.name);
    }
  }
  app.get('/api/files/:id', need('owner', 'staff', 'client'), (req, res) => {
    const doc = (workspace().documents || []).find(d => d.id === req.params.id);
    if (!doc || (req.user.role === 'client' && doc.clientId !== req.user.clientId)) return res.status(404).json({ error: 'Not found' });
    db.audit({ actor: req.user.email, action: 'file.download', detail: doc.name });
    res.set({ 'Content-Type': doc.mime, 'Content-Disposition': `attachment; filename="${doc.name.replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'no-store' });
    res.send(readFile(doc.id));
  });

  // ---------- owner settings: print & mail (Lob) and payments (Authorize.net) ----------
  const secrets = () => (D().secrets = D().secrets || {});
  const mailInfo = () => { const k = secrets().lobKey || ''; return { configured: !!k, mode: k.startsWith('live_') ? 'live' : k ? 'test' : null, last4: k.slice(-4), savedAt: secrets().lobKeySavedAt || null }; };
  app.get('/api/settings/mail', need('owner', 'staff'), (req, res) => res.json(mailInfo()));
  app.put('/api/settings/mail', need('owner'), async (req, res) => {
    const key = String((req.body || {}).lobKey || '').trim();
    if (!/^(test|live)_[A-Za-z0-9]{10,}$/.test(key)) return res.status(400).json({ error: 'That doesn’t look like a Lob API key. It starts with test_ or live_.' });
    const check = await checkLobKey(key);
    if (check === 'invalid') return res.status(400).json({ error: 'Lob rejected this key. Copy it again from dashboard.lob.com → Settings → API Keys.' });
    Object.assign(secrets(), { lobKey: key, lobKeySavedAt: new Date().toISOString() });
    db.audit({ actor: req.user.email, action: 'settings.mail', detail: `saved …${key.slice(-4)} (${check})` });
    db.persist();
    res.json(Object.assign(mailInfo(), { verified: check === 'ok' }));
  });
  app.delete('/api/settings/mail', need('owner'), (req, res) => { delete secrets().lobKey; db.audit({ actor: req.user.email, action: 'settings.mail', detail: 'removed' }); db.persist(); res.json(mailInfo()); });

  const anet = () => secrets().anet || null;
  const payInfo = () => { const a = anet(); return { configured: !!a, sandbox: !!(a && a.sandbox), loginLast4: a ? a.loginId.slice(-4) : '', savedAt: a ? a.savedAt : null }; };
  app.get('/api/settings/payments', need('owner', 'staff'), (req, res) => res.json(payInfo()));
  app.put('/api/settings/payments', need('owner'), async (req, res) => {
    const b = req.body || {};
    const cfg = { loginId: String(b.loginId || '').trim(), transactionKey: String(b.transactionKey || '').trim(), sandbox: !!b.sandbox };
    if (!cfg.loginId || !cfg.transactionKey) return res.status(400).json({ error: 'Enter the API Login ID and Transaction Key from Authorize.net → Account → API Credentials & Keys.' });
    const check = await checkCredentials(cfg);
    if (check === 'invalid') return res.status(400).json({ error: `Authorize.net rejected these credentials${cfg.sandbox ? ' (sandbox)' : ''}.` });
    secrets().anet = Object.assign(cfg, { savedAt: new Date().toISOString() });
    db.audit({ actor: req.user.email, action: 'settings.payments', detail: `saved (${check})${cfg.sandbox ? ' sandbox' : ''}` });
    db.persist();
    res.json(Object.assign(payInfo(), { verified: check === 'ok' }));
  });
  app.delete('/api/settings/payments', need('owner'), (req, res) => { delete secrets().anet; db.audit({ actor: req.user.email, action: 'settings.payments', detail: 'removed' }); db.persist(); res.json(payInfo()); });

  // ---------- mailing dispute letters ----------
  const mailDocs = new Map(); // token -> { html, expires }
  const htmlEsc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function letterHtml(text, images) {
    const pages = [`<div class="p">${htmlEsc(text)}</div>`].concat(images.map(im => `<div class="p img"><img src="${im}"></div>`));
    return `<html><head><meta charset="UTF-8"><style>body{margin:0;font-family:Georgia,serif;font-size:11pt;line-height:1.45}.p{white-space:pre-wrap;padding:0.6in 0.75in;page-break-after:always}.img{text-align:center}.img img{max-width:7in;max-height:9in}</style></head><body>${pages.join('')}</body></html>`;
  }
  app.get('/mail-doc/:token', (req, res) => {
    const d = mailDocs.get(req.params.token);
    if (!d || d.expires < Date.now()) return res.status(404).send('Expired');
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(d.html);
  });
  function recipientAddressFor(d) { const b = Law.BUREAUS[d.recipient]; return b ? { name: b.name, address: b.address } : { name: d.recipient, address: d.recipientAddress || '' }; }

  app.post('/api/disputes/:id/mail', need('owner', 'staff'), async (req, res) => {
    const key = secrets().lobKey;
    if (!key) return res.status(501).json({ error: 'Online mailing is off. The owner can add a Lob API key in Settings → Print & mail.' });
    const ws = workspace();
    const d = ws.disputes.find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'Dispute not found' });
    if (d.sentAt) return res.status(409).json({ error: 'Already mailed' });
    const c = ws.clients.find(x => x.id === d.clientId);
    const letter = ws.letters.find(l => l.id === d.letterId);
    if (!c || !letter || !letter.text) return res.status(400).json({ error: 'Generate the letter first' });
    if (letter.status !== 'approved') return res.status(400).json({ error: 'Approve the letter (client confirmed every statement) before mailing' });
    if (!Store.croaStatus(c).cleared) return res.status(400).json({ error: 'Blocked until onboarding and the cancellation period are complete' });
    const rc = recipientAddressFor(d);
    const to = parseAddress(rc.name, rc.address);
    if (!to) return res.status(400).json({ error: `Recipient address must end with “City, ST 12345”. Edit the recipient address for ${d.recipient}.` });
    const from = parseAddress(c.name, [c.address, `${c.city || ''}, ${c.state || ''} ${c.zip || ''}`].join('\n'));
    if (!from) return res.status(400).json({ error: 'The client’s mailing address is incomplete (street, city, state, ZIP)' });
    const { service, includeId } = req.body || {};
    const extraService = ['certified', 'certified_return_receipt'].includes(service) ? service : null;
    const images = [];
    if (includeId) {
      ['id', 'address'].forEach(t => {
        const doc = (ws.documents || []).filter(x => x.clientId === c.id && x.type === t && /^image\/(png|jpeg|webp)$/.test(x.mime)).sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0];
        if (doc) images.push(`data:${doc.mime};base64,${readFile(doc.id).toString('base64')}`);
      });
      if (images.length < 2) return res.status(400).json({ error: 'Upload the client’s photo ID and proof of address as images (PNG/JPG) to include them, or untick “include ID”.' });
    }
    const html = letterHtml(letter.text, images);
    let file = html;
    if (html.length > 9500) {
      const host = req.get('host') || '';
      if (/^(localhost|127\.|0\.0\.0\.0)/.test(host)) return res.status(400).json({ error: 'This letter is too long to send inline, and the server is not reachable from the internet for Lob to fetch it.' });
      const token = crypto.randomBytes(24).toString('base64url');
      mailDocs.set(token, { html, expires: Date.now() + 60 * 60 * 1000 });
      file = `https://${host}/mail-doc/${token}`;
    }
    try {
      const out = await sendLetter({ key, to, from, file, extraService, description: `${c.name} → ${d.recipient} (round ${d.round})`, metadata: { dispute: d.id.slice(0, 40) } });
      const sentAt = today();
      const receivedAt = out.expected_delivery_date || Law.addDays(sentAt, Number(ws.settings.mailTransitDays) || 5);
      Object.assign(d, { sentAt, receivedAt, status: 'sent', tracking: out.tracking_number || d.tracking || '', mail: { provider: 'lob', id: out.id, service: extraService || 'first_class', expectedDelivery: out.expected_delivery_date || null, url: out.url || null, test: key.startsWith('test_'), events: [] } });
      d.dueAt = Law.responseDue(d.type, d.receivedAt);
      letter.status = 'sent'; letter.sentAt = sentAt;
      if (d.dueAt) ws.tasks.push({ id: uid(), clientId: d.clientId, title: `Check ${d.recipient} response (round ${d.round})`, due: d.dueAt, done: false, createdAt: new Date().toISOString() });
      activity(`Mailed round ${d.round} to ${d.recipient} via Lob${extraService ? ' (' + extraService.replace(/_/g, ' ') + ')' : ''}${key.startsWith('test_') ? ' — TEST MODE, not actually mailed' : ''}`, d.clientId);
      commitWorkspace(req.user.email, 'mail.send', `${d.id} ${out.id}`);
      res.json({ ok: true, version: D().workspaceVersion, test: key.startsWith('test_'), tracking: d.tracking, expectedDelivery: d.mail.expectedDelivery });
    } catch (e) { res.status(e.status === 401 ? 400 : 502).json({ error: 'Lob: ' + e.message }); }
  });

  app.post('/api/disputes/:id/mail/refresh', need('owner', 'staff'), async (req, res) => {
    const key = secrets().lobKey;
    const d = workspace().disputes.find(x => x.id === req.params.id);
    if (!key || !d || !d.mail || !d.mail.id) return res.status(404).json({ error: 'No online mailing for this dispute' });
    try {
      const out = await getLetter(key, d.mail.id);
      const events = (out.tracking_events || []).map(e => ({ name: e.name || e.type, at: String(e.time || e.date_created || '').slice(0, 10), location: e.location || '' }));
      d.mail.events = events;
      if (out.tracking_number && !d.tracking) d.tracking = out.tracking_number;
      const delivered = events.find(e => /deliver/i.test(e.name) && !/out for|attempt/i.test(e.name));
      if (delivered && delivered.at && !d.outcome) { d.receivedAt = delivered.at; d.dueAt = Law.responseDue(d.type, d.receivedAt); d.mail.deliveredAt = delivered.at; }
      commitWorkspace(req.user.email, 'mail.refresh', d.id);
      res.json({ ok: true, version: D().workspaceVersion, events, deliveredAt: d.mail.deliveredAt || null });
    } catch (e) { res.status(502).json({ error: 'Lob: ' + e.message }); }
  });

  // ---------- online invoice payments ----------
  const findInvoiceByToken = t => (workspace().invoices || []).find(i => i.payToken && i.payToken === t);
  const payPage = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlEsc(title)}</title><link rel="stylesheet" href="/css/app.css"></head><body style="background:var(--bg)"><main style="max-width:520px;margin:8vh auto;padding:0 16px"><section class="card"><div class="card-b stack">${body}</div></section></main></body></html>`;
  async function confirmPayment(inv) {
    const a = anet();
    if (!a || inv.status === 'paid') return inv.status === 'paid';
    const hit = await findPayment(a, inv);
    if (!hit) return false;
    Object.assign(inv, { status: 'paid', paidAt: today(), transId: hit.transId, paidVia: 'Authorize.net' });
    activity(`Online payment received: $${Number(inv.amount).toFixed(2)} — ${inv.description}`, inv.clientId);
    commitWorkspace('payment', 'invoice.paid', inv.id);
    return true;
  }
  app.get('/pay/:token', async (req, res) => {
    const inv = findInvoiceByToken(req.params.token);
    const co = company();
    if (!inv || inv.status === 'void') return res.status(404).send(payPage('Invoice not found', '<h1>Invoice not found</h1><p class="muted">This payment link is not valid. Please contact us.</p>'));
    if (inv.status === 'paid') return res.send(payPage('Paid', `<h1>Thank you</h1><p>This invoice was paid${inv.paidAt ? ' on ' + htmlEsc(inv.paidAt) : ''}.</p>`));
    const billing = (workspace().settings || {}).billing || {};
    if (billing.provider === 'link' && /^https:\/\//.test(billing.payLink || '')) return res.redirect(302, billing.payLink);
    const a = anet();
    if (!a) return res.send(payPage('Invoice', `<h1>Invoice — $${Number(inv.amount).toFixed(2)}</h1><p>${htmlEsc(inv.description)}</p><p class="muted">Online payment isn’t set up yet. Please contact ${htmlEsc(co.name || 'us')}${co.phone ? ' at ' + htmlEsc(co.phone) : ''}.</p>`));
    const c = workspace().clients.find(x => x.id === inv.clientId) || {};
    const origin = `${req.protocol}://${req.get('host')}`;
    try {
      const token = await hostedPaymentToken(a, { invoice: inv, client: c, returnUrl: `${origin}/pay/${req.params.token}/done`, cancelUrl: `${origin}/pay/${req.params.token}`, companyName: co.name });
      res.send(payPage('Pay invoice', `<h1>Invoice — $${Number(inv.amount).toFixed(2)}</h1><p>${htmlEsc(inv.description)}</p><p class="small muted">Service completed ${htmlEsc(inv.serviceCompletedAt || '')}. You will pay on Authorize.net’s secure page; card numbers never reach our systems.</p>
        <form method="post" action="${a.sandbox ? PAY_PAGE.sandbox : PAY_PAGE.live}"><input type="hidden" name="token" value="${htmlEsc(token)}"><button class="btn primary" style="width:100%">Continue to secure payment</button></form>`));
    } catch (e) { res.status(502).send(payPage('Payment unavailable', `<h1>Payment is temporarily unavailable</h1><p class="muted">${htmlEsc(e.message)}</p>`)); }
  });
  app.get('/pay/:token/done', async (req, res) => {
    const inv = findInvoiceByToken(req.params.token);
    if (!inv) return res.status(404).send(payPage('Invoice not found', '<h1>Invoice not found</h1>'));
    let ok = inv.status === 'paid';
    try { ok = ok || await confirmPayment(inv); } catch (e) { /* show pending */ }
    res.send(payPage(ok ? 'Thank you' : 'Payment pending', ok ? '<h1>Thank you!</h1><p>Your payment was received.</p>' : '<h1>Thanks — we’re confirming your payment</h1><p class="muted">If you completed the payment, it will show as paid shortly. You don’t need to pay again.</p>'));
  });
  app.post('/api/invoices/:id/check', need('owner', 'staff'), async (req, res) => {
    const inv = (workspace().invoices || []).find(i => i.id === req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (!anet()) return res.status(501).json({ error: 'Authorize.net is not connected' });
    try { const paid = await confirmPayment(inv); res.json({ paid, version: D().workspaceVersion }); } catch (e) { res.status(502).json({ error: 'Authorize.net: ' + e.message }); }
  });

  // ---------- invoices: email with PDF attached ----------
  app.post('/api/invoices/:id/email', need('owner', 'staff'), async (req, res) => {
    const ws = workspace();
    const inv = (ws.invoices || []).find(i => i.id === req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const c = ws.clients.find(x => x.id === inv.clientId);
    const to = String((req.body || {}).to || (c && c.email) || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) return res.status(400).json({ error: 'The client has no email address. Add one on their profile.' });
    if (!commsConfig().email) return res.status(501).json({ error: 'Email sending is not set up on the server (Resend). Download the PDF and attach it to your own email instead.' });
    const origin = `${req.protocol}://${req.get('host')}`;
    const billing = (ws.settings || {}).billing || {};
    const payLink = billing.provider === 'link' && billing.payLink ? billing.payLink : billing.provider === 'authorizenet' && inv.payToken ? `${origin}/pay/${inv.payToken}` : '';
    const co = company();
    const note = String((req.body || {}).message || '').trim();
    const body = `Hi ${(c && (c.firstName || c.name)) || ''},\n\n${note ? note + '\n\n' : ''}Your invoice ${Invoices.number(inv)} for ${Invoices.money(inv.amount)} is attached.${payLink && inv.status !== 'paid' ? `\n\nPay securely online: ${payLink}` : ''}\n\n${Invoices.text(ws, inv, { payLink })}\n\nThank you,\n${co.name || ''}${co.phone ? '\n' + co.phone : ''}`;
    try {
      const pdf = Buffer.from(Invoices.pdf(ws, inv, { payLink }), 'latin1').toString('base64');
      const providerId = await sendEmail({ to, subject: `Invoice ${Invoices.number(inv)} from ${co.name || 'us'} — ${Invoices.money(inv.amount)}`, text: body, attachments: [{ filename: Invoices.filename(ws, inv), content: pdf }] });
      inv.number = Invoices.number(inv);
      inv.emailedAt = new Date().toISOString(); inv.emailedTo = to;
      ws.messages = ws.messages || [];
      ws.messages.unshift({ id: uid(), clientId: inv.clientId, channel: 'email', to, subject: `Invoice ${inv.number}`, body, at: new Date().toISOString(), by: req.user.email, status: 'sent', providerId });
      commitWorkspace(req.user.email, 'invoice.email', inv.id);
      res.json({ ok: true, version: D().workspaceVersion });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ---------- referral partner portal ----------
  app.get('/api/partner/me', need('partner'), (req, res) => {
    const ws = workspace();
    const r = (ws.referrals || []).find(x => x.id === req.user.referralId);
    if (!r) return res.status(404).json({ error: 'Your partner account is not linked. Contact us.' });
    const com = Sales.commissions(ws, r, today());
    const clients = com.clients.map(c => {
      const shared = !!c.shareWithReferrer;
      const ds = ws.disputes.filter(d => d.clientId === c.id);
      const removed = ds.reduce((a, d) => a + d.items.filter(it => ['deleted', 'corrected'].includes(it.result || d.outcome)).length, 0);
      return { name: `${c.firstName || String(c.name).split(' ')[0]} ${String(c.lastName || '').slice(0, 1)}.`.trim(), stage: Sales.stageOf(c), status: c.status, joinedAt: String(c.createdAt || '').slice(0, 10), shared,
        progress: shared ? { lettersMailed: ds.filter(d => d.sentAt).length, removed, inProgress: ds.filter(d => d.sentAt && !d.outcome).length } : null };
    });
    res.json({ partner: { name: r.name, company: r.company || '' }, company: { name: company().name, phone: company().phone, email: company().email },
      link: `${req.protocol}://${req.get('host')}/apply?ref=${r.id}`, clients,
      commission: { type: r.commissionType || 'none', amount: r.commissionAmount || '', terms: r.commission || '', earned: com.earned, paid: com.paid, owed: com.owed, payouts: r.payouts || [] } });
  });

  // ---------- static ----------
  // Pages are served with a build stamp on every script and stylesheet so browsers never mix an old
  // file with a new one after an update.
  const BUILD = (process.env.RAILWAY_DEPLOYMENT_ID || String(Date.now())).replace(/[^\w-]/g, '').slice(0, 40);
  const pageCache = {};
  const page = (f) => (req, res) => {
    if (!pageCache[f]) pageCache[f] = fs.readFileSync(path.join(ledgerDir, f), 'utf8').replace(/(src|href)="((?:js|css)\/[\w.-]+\.(?:js|css))"/g, `$1="$2?v=${BUILD}"`);
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(pageCache[f]);
  };
  app.get(['/', '/app'], page('index.html'));
  app.get('/portal', page('portal.html'));
  app.get('/apply', page('apply.html'));
  app.get('/partner', page('partner.html'));
  const fresh = { setHeaders: res => res.set('Cache-Control', 'no-cache') };
  app.use('/css', express.static(path.join(ledgerDir, 'css'), fresh));
  app.use('/js', express.static(path.join(ledgerDir, 'js'), fresh));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  return { app, db };
}
