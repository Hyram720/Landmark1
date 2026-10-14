// Ledger API + static host. Staff use the workspace app, clients use the portal, and prospects use
// the public intake form. Run with `npm run ledger`.
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import { commsConfig, sendEmail, sendSms } from './comms.js';
import { askAssistant, assistantConfigured } from './assistant.js';
import { scanReport, planRound } from './ai.js';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, passwordProblem, rateLimiter } from './auth.js';
import { Law, Partners, Store } from './shared.js';

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
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, clientId: u.clientId || null });
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
    if (process.env.LEDGER_SETUP_CODE && setupCode !== process.env.LEDGER_SETUP_CODE) return res.status(403).json({ error: 'Enter the setup code from your server settings' });
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
    const { role, clientId, name, email } = req.body || {};
    if (role === 'staff' && req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can invite staff' });
    if (!['staff', 'client'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    let c;
    if (role === 'client') {
      c = workspace().clients.find(x => x.id === clientId);
      if (!c) return res.status(404).json({ error: 'Client not found' });
    }
    const token = crypto.randomBytes(24).toString('base64url');
    D().invites.push({ hash: sha(token), role, clientId: clientId || null, name: name || (c && c.name) || '', email: (email || (c && c.email) || '').toLowerCase(), expiresAt: Date.now() + INVITE_TTL_MS, usedAt: null });
    db.audit({ actor: req.user.email, action: 'invite.create', detail: `${role} ${email || (c && c.name) || ''}` });
    db.persist();
    const page = role === 'client' ? 'portal' : 'app';
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
    const u = { id: uid(), name: inv.name, email: addr, role: inv.role, clientId: inv.clientId, password: hashPassword(password), sessionEpoch: 1, createdAt: new Date().toISOString() };
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
  app.get('/api/config', need('owner', 'staff'), (req, res) => res.json(Object.assign(commsConfig(), { assistant: assistantConfigured() })));
  const aiLimit = rateLimiter(60, 60 * 60 * 1000);
  app.post('/api/assistant', need('owner', 'staff'), async (req, res) => {
    if (!assistantConfigured()) return res.status(501).json({ error: 'Ledger AI needs ANTHROPIC_API_KEY set on the server' });
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
    if (!assistantConfigured()) return res.status(501).json({ error: 'AI scanning needs ANTHROPIC_API_KEY set on the server' });
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
  app.post('/api/clients/:id/ai-plan', need('owner', 'staff'), async (req, res) => {
    if (!assistantConfigured()) return res.status(501).json({ error: 'AI planning needs ANTHROPIC_API_KEY set on the server' });
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
  });
  app.get('/api/files/:id', need('owner', 'staff', 'client'), (req, res) => {
    const doc = (workspace().documents || []).find(d => d.id === req.params.id);
    if (!doc || (req.user.role === 'client' && doc.clientId !== req.user.clientId)) return res.status(404).json({ error: 'Not found' });
    db.audit({ actor: req.user.email, action: 'file.download', detail: doc.name });
    res.set({ 'Content-Type': doc.mime, 'Content-Disposition': `attachment; filename="${doc.name.replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'no-store' });
    res.send(readFile(doc.id));
  });

  // ---------- static ----------
  const page = (f) => (req, res) => res.sendFile(path.join(ledgerDir, f));
  app.get(['/', '/app'], page('index.html'));
  app.get('/portal', page('portal.html'));
  app.get('/apply', page('apply.html'));
  app.use('/css', express.static(path.join(ledgerDir, 'css')));
  app.use('/js', express.static(path.join(ledgerDir, 'js')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  return { app, db };
}
