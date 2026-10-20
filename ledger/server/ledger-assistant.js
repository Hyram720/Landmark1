// Ledger Assistant: grounded AI help for staff (client file + rules engine + knowledge base) and a
// public intake/portal helper — plus unlimited AI-polished Metro 2 dispute letters.
//
// OFF by default. It turns on only when BOTH are set on the server:
//   LEDGER_AI_ENABLED=true   and   OPENAI_API_KEY=<key>
// Optional: LEDGER_OPENAI_MODEL (default gpt-5-mini), LEDGER_AI_LETTERS_PER_HOUR (abuse limit, default 300).
// When off, every route still answers: staff get a rules-engine summary and template letters,
// the public helper answers from the canned FAQ.
//
// Privacy: everything sent to the AI goes through redact() (SSNs, DOB, EINs, account/card numbers,
// emails, phones). The audit log records metadata only (who, which client id, mode, token counts) —
// never the question or the answer.
import crypto from 'node:crypto';
import { Law, Metro2, Store, Letters, KB, DisputeReasons } from './shared.js';
import { redact, lastFour } from './redact.js';
import { rateLimiter } from './auth.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
let fetchImpl = (...a) => fetch(...a);
/** Tests replace the network call. */
export function setAiFetch(fn) { fetchImpl = fn; }

export function aiConfig(env = process.env) {
  const enabled = String(env.LEDGER_AI_ENABLED || '').toLowerCase() === 'true' && !!env.OPENAI_API_KEY;
  return { enabled, provider: enabled ? 'openai' : null, model: env.LEDGER_OPENAI_MODEL || 'gpt-5-mini', flag: String(env.LEDGER_AI_ENABLED || '').toLowerCase() === 'true', keyPresent: !!env.OPENAI_API_KEY };
}

async function chat({ system, messages, maxTokens = 1200, env = process.env }) {
  const cfg = aiConfig(env);
  const r = await fetchImpl(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }].concat(messages) }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((data.error && data.error.message) || `AI service error ${r.status}`); e.status = r.status; throw e; }
  const text = (((data.choices || [])[0] || {}).message || {}).content || '';
  return { text: String(text).trim(), usage: data.usage || {}, model: data.model || cfg.model };
}

// ---------- grounding ----------
const RAILS = `Hard rules — never break them:
- Never promise or predict results, deletions, score increases or timelines for approval. Say "may", not "will".
- You are not a lawyer or CPA and do not give legal or tax advice; flag questions that need one.
- Only treat an item as disputable if the data shows a specific inaccuracy, it is obsolete, or the consumer says it is inaccurate and can explain why. Accurate, current, verifiable information cannot be removed by disputing it.
- Never suggest CPNs, new identities, using an EIN in place of an SSN, false identity-theft claims, mass/template disputes, or any untrue statement.
- CROA: no fees before services are fully performed; written contract; 3-business-day cancellation; required rights disclosure.
- Business credit reports are mostly not covered by the FCRA; use each business bureau's own dispute process.
- Buying an aged/shelf company: misrepresenting time in business or another company's history to a lender can be fraud; recommend an attorney and CPA; no "instant fundable" claims.
- Partner products are optional. When you mention one, say it is an affiliate link and we may earn a commission, and that it is never required.
- Cite knowledge-base rule ids in square brackets, e.g. [fcra-611], for every legal statement.`;

function kbDigest(sections) {
  return KB.rules.filter(r => !sections || sections.includes(r.section)).map(r => `[${r.id}] ${r.title}: ${r.rule} (${r.cite})`).join('\n');
}

function deadlinesFor(ws, clientId, today) {
  return (ws.disputes || []).filter(d => d.clientId === clientId && d.sentAt && !d.outcome).map(d => {
    const days = d.dueAt ? Math.round((new Date(d.dueAt) - new Date(today)) / 86400000) : null;
    return { recipient: d.recipient, round: d.round, type: (Law.DISPUTE_TYPES[d.type] || {}).label || d.type, sentAt: d.sentAt, dueAt: d.dueAt, daysLeft: days, overdue: days !== null && days < 0 };
  });
}

/** Redacted, structured view of one client for the model (no names, contact data or full numbers). */
export function clientDigest(ws, clientId, today = new Date().toISOString().slice(0, 10)) {
  const c = (ws.clients || []).find(x => x.id === clientId);
  if (!c) return null;
  const cs = Store.croaStatus(c);
  const lines = [`Client ${c.id.slice(0, 8)} — ${c.kind || 'personal'} client, status ${c.status}, state ${c.state || '?'}.`];
  if (cs.required) lines.push(`CROA: disclosure ${c.onboarding?.disclosureSignedAt ? 'signed' : 'NOT signed'}, contract ${c.onboarding?.contractSignedAt ? 'signed' : 'NOT signed'}, cancellation deadline ${cs.deadline || 'n/a'}, cleared for services: ${cs.cleared ? 'yes' : 'NO'}${cs.cancelled ? ', CANCELLED' : ''}.`);
  const latest = {};
  (ws.reports || []).filter(r => r.clientId === c.id).sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach(r => { if (!latest[r.bureau]) latest[r.bureau] = r; });
  Object.values(latest).forEach(r => {
    lines.push(`\n${r.bureau} report ${r.date}:`);
    (r.accounts || []).forEach(a => lines.push(`- [${a.id}] ${redact(a.creditor)} ${lastFour(a.accountNumber)} | status ${a.status} | bal ${a.balance} | past due ${a.pastDue} | opened ${a.opened || '?'} | DOFD ${a.dofd || '-'} | CCC ${a.complianceCode || '-'} | history ${a.paymentHistory || '-'}${a.originalCreditor ? ' | OC ' + redact(a.originalCreditor) : ''}`));
  });
  const sugg = DisputeReasons.suggestionsFor(ws, c.id, { today });
  if (sugg.length) { lines.push('\nRules-engine findings that are dispute-ready:'); sugg.forEach(s => lines.push(`* [${s.code}] ${s.bureau} ${redact(s.creditor)}: ${redact(s.discrepancy)} → ask: ${s.requested} (kb: ${s.kb.join(', ')})`)); }
  const dl = deadlinesFor(ws, c.id, today);
  if (dl.length) { lines.push('\nOpen disputes and response deadlines (FCRA 30 days, 45 if extended):'); dl.forEach(d => lines.push(`- ${d.recipient} round ${d.round} (${d.type}): mailed ${d.sentAt}, response due ${d.dueAt || '?'}${d.daysLeft !== null ? ` (${d.overdue ? Math.abs(d.daysLeft) + ' days OVERDUE' : d.daysLeft + ' days left'})` : ''}`)); }
  if (c.kind !== 'personal' && c.business) lines.push(`\nBusiness: ${c.business.entityType || 'entity ?'}, formed ${c.business.formedOn || '?'}.`);
  return { text: lines.join('\n'), suggestions: sugg, deadlines: dl };
}

const STAFF_SYSTEM = `You are Ledger Assistant, an expert credit-repair analyst inside a credit repair company's software, helping STAFF (not consumers). You cover three areas: personal credit (FCRA, FDCPA/Reg F, FCBA, ECOA/Reg B, CROA, Metro 2), business credit, and buying an existing corporation.
Work only from the client file and knowledge base you are given. Explain the rules-engine findings plainly, propose next steps with dates, and draft or improve letters when asked (staff will edit and approve; mark anything the consumer must confirm with [CONFIRM]).
${RAILS}`;

const PUBLIC_SYSTEM = `You are the website helper for a credit services company. You help visitors fill in the consultation form and help signed-in clients understand their portal. You may explain: what the form fields mean, which documents to upload (photo ID, proof of address, bureau letters, credit reports), how disputes and the 30/45-day bureau timelines work in general, and consumer rights (free reports at AnnualCreditReport.com, the right to dispute for free, CROA: no fees before services are performed, written contract, 3 business days to cancel).
You cannot see anyone's credit file and must not ask for SSNs, dates of birth, account numbers or passwords — tell people not to type them. For anything specific to their file, pricing, or advice, say a team member will follow up and suggest they use the form or call. Keep answers under 120 words.
${RAILS}`;

// ---------- canned FAQ (used when AI is off, and as grounding when on) ----------
export const FAQ = [
  { q: /cancel|3.?day|three.?day|change my mind/i, a: 'You can cancel your agreement for any reason, without penalty, before midnight of the 3rd business day after you sign. In the portal use “Cancel my agreement”, or contact us. [croa-cancel]' },
  { q: /fee|cost|price|pay|charge|upfront|money/i, a: 'We never charge before a service has been fully performed, and nothing is billed during your 3-day cancellation period. Your written agreement lists every fee before you sign. A team member can go over pricing on your consultation call. [croa-advance-fee]' },
  { q: /guarantee|promise|how many points|delete everything|remove all/i, a: 'No one can promise results. Accurate, current and verifiable information can’t be removed by disputing it. We dispute only information that is inaccurate, incomplete, obsolete or unverifiable. [croa-misrep]' },
  { q: /how long|30 days|45 days|timeline|when will/i, a: 'Credit bureaus generally have 30 days to investigate a dispute after they receive it, or up to 45 days in some cases, then 5 business days to send you the results. [fcra-611]' },
  { q: /document|upload|id\b|proof|what do (you|i) need/i, a: 'Helpful documents: a government photo ID, a recent proof of address (utility bill or bank statement), any letters you received from the credit bureaus or collectors, and a recent credit report. Please don’t send your full Social Security number by chat or email.' },
  { q: /free|myself|do it my ?self|on my own/i, a: 'You have the right to dispute inaccurate information with the credit bureaus yourself, for free, and to get free credit reports at AnnualCreditReport.com. [fcra-609] [fcra-611]' },
  { q: /business credit|ein|duns|d-u-n-s|net.?30/i, a: 'Business credit is reported by business bureaus like Dun & Bradstreet, Experian Business and Equifax Business. These are mostly not covered by the consumer credit law (FCRA), so corrections go through each bureau’s own process. A team member can explain the steps on your call. [biz-fcra-scope] [biz-building]' },
  { q: /shelf|aged (corp|company)|buy a (corp|company|business)/i, a: 'Buying an existing company is a legal and tax transaction. Talk to an attorney and a CPA. A company’s age is not your operating history, and misrepresenting it to a lender can be fraud. We can walk you through the due-diligence steps. [corp-fraud-warning] [corp-structure]' },
  { q: /ssn|social security|password/i, a: 'Please don’t type your Social Security number, date of birth, account numbers or passwords here. We’ll collect what we need securely.' }
];
const HANDOFF = 'I’ll make sure a team member follows up with you. You can also use the consultation form on this page or call us. (This helper gives general information, not legal advice.)';
export function faqAnswer(text) {
  const hit = FAQ.find(f => f.q.test(String(text || '')));
  return hit ? hit.a + ' ' + HANDOFF : 'I can help with the form, which documents to upload, dispute timelines, and your rights (including the 3-day cancellation and no fees before services). ' + HANDOFF;
}

// Output check: block any answer that promises results.
const BANNED = /\b(guarantee[ds]?|we will (remove|delete|erase)|100% (removal|deletion)|instant(ly)? fundable|raise your score by \d+|new credit (identity|file)|cpn)\b/i;
function safeText(text, fallback) {
  const lint = (Law.lintText ? Law.lintText(text) : []) || [];
  if (BANNED.test(text) || lint.some(x => /guarantee|promise/i.test(x.phrase || ''))) return { text: fallback, replaced: true };
  return { text, replaced: false };
}

function offlineStaffAnswer(dig) {
  if (!dig) return 'AI is off (set LEDGER_AI_ENABLED=true and OPENAI_API_KEY on the server to turn it on). Pick a client to see the rules-engine findings and deadlines.';
  const parts = ['AI is off — here is what the rules engine found.'];
  if (dig.suggestions.length) parts.push('\n**Dispute-ready findings**\n' + dig.suggestions.map(s => `- ${s.bureau} · ${s.creditor}: ${s.title}. Ask: ${s.requested} [${s.kb.join('] [')}]`).join('\n'));
  else parts.push('\nNo dispute-ready inaccuracies found in the latest reports. Accurate negatives can’t be disputed away — consider goodwill requests, rebuilding and waiting for the reporting period [score-goodwill] [fcra-605].');
  if (dig.deadlines.length) parts.push('\n**Deadlines**\n' + dig.deadlines.map(d => `- ${d.recipient} round ${d.round}: due ${d.dueAt}${d.overdue ? ' — OVERDUE: send a follow-up / method-of-verification request' : ` (${d.daysLeft} days left)`}`).join('\n'));
  return parts.join('\n');
}

const sessionKey = (req) => {
  const raw = String(req.headers.cookie || '').match(/ledger_helper=([\w-]{10,64})/);
  return raw ? raw[1] : null;
};

export function mountLedgerAssistant(app, { need, workspace, db, uid }) {
  const staffLimit = rateLimiter(120, 60 * 60 * 1000);
  const letterLimit = rateLimiter(Number(process.env.LEDGER_AI_LETTERS_PER_HOUR || 300), 60 * 60 * 1000);
  const publicSessionLimit = rateLimiter(20, 60 * 60 * 1000);
  const publicIpLimit = rateLimiter(60, 60 * 60 * 1000);
  const meta = (actor, action, detail) => { db.audit({ actor, action, detail }); db.persistSoon(); };

  app.get('/api/assistant/config', (req, res) => { const c = aiConfig(); res.json({ enabled: c.enabled, model: c.enabled ? c.model : null, kbVersion: KB.version }); });
  app.get('/api/kb', need('owner', 'staff'), (req, res) => res.json({ version: KB.version, rules: KB.rules }));

  // Staff chat about one client (or general).
  app.post('/api/assistant/staff', need('owner', 'staff'), async (req, res) => {
    if (!staffLimit(req.user.id)) return res.status(429).json({ error: 'Hourly assistant limit reached. Try again later.' });
    const { clientId, history } = req.body || {};
    const msgs = (Array.isArray(history) ? history : []).slice(-12).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: redact(String(m.content || '').slice(0, 6000)) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Ask a question first' });
    const ws = workspace();
    const dig = clientId ? clientDigest(ws, clientId) : null;
    if (clientId && !dig) return res.status(404).json({ error: 'Client not found' });
    const cfg = aiConfig();
    if (!cfg.enabled) { meta(req.user.email, 'assistant.staff', `${clientId || 'general'} offline`); return res.json({ mode: 'offline', text: offlineStaffAnswer(dig), suggestions: dig ? dig.suggestions : [], deadlines: dig ? dig.deadlines : [] }); }
    try {
      const sys = `${STAFF_SYSTEM}\n\nKNOWLEDGE BASE v${KB.version}:\n${kbDigest()}`;
      if (dig) msgs[0] = { role: 'user', content: `<client_file redacted="true">\n${dig.text}\n</client_file>\n\n${msgs[0].content}` };
      const out = await chat({ system: sys, messages: msgs, maxTokens: 1500 });
      const safe = safeText(out.text, 'I can’t phrase that as a promise of results. Here is what the data supports:\n\n' + offlineStaffAnswer(dig));
      meta(req.user.email, 'assistant.staff', `${clientId || 'general'} ai in=${out.usage.prompt_tokens || '?'} out=${out.usage.completion_tokens || '?'}${safe.replaced ? ' replaced' : ''}`);
      res.json({ mode: 'ai', model: out.model, text: safe.text, suggestions: dig ? dig.suggestions : [], deadlines: dig ? dig.deadlines : [] });
    } catch (e) {
      meta(req.user.email, 'assistant.staff', `${clientId || 'general'} error ${e.status || ''}`);
      res.json({ mode: 'offline', error: 'The AI service is unavailable right now — showing the rules-engine summary instead.', text: offlineStaffAnswer(dig), suggestions: dig ? dig.suggestions : [], deadlines: dig ? dig.deadlines : [] });
    }
  });

  // Rules-engine suggestions for a client (works with AI on or off).
  app.get('/api/clients/:id/dispute-suggestions', need('owner', 'staff'), (req, res) => {
    const ws = workspace();
    if (!(ws.clients || []).some(c => c.id === req.params.id)) return res.status(404).json({ error: 'Client not found' });
    res.json({ suggestions: DisputeReasons.suggestionsFor(ws, req.params.id), kbVersion: KB.version });
  });

  // Unlimited dispute letters: template always, AI polish when enabled. Nothing is saved or mailed
  // here — the browser stores the draft, and Lob mailing still requires an approved letter.
  app.post('/api/letters/draft', need('owner', 'staff'), async (req, res) => {
    const ws = workspace();
    const b = req.body || {};
    const c = (ws.clients || []).find(x => x.id === b.clientId);
    if (!c) return res.status(404).json({ error: 'Client not found' });
    const recipient = String(b.recipient || '').slice(0, 120);
    if (!recipient) return res.status(400).json({ error: 'Choose a recipient (bureau or furnisher)' });
    const wanted = Array.isArray(b.items) ? b.items : [];
    // Guardrail 1: every item must match a finding the rules engine actually produced for this client.
    const sugg = DisputeReasons.suggestionsFor(ws, c.id);
    const items = wanted.map(w => sugg.find(s => s.accountId === w.accountId && s.code === w.code)).filter(Boolean);
    if (!items.length) return res.status(400).json({ error: 'No identified inaccuracy for the selected items. Letters are only drafted for findings the rules engine identified (or the client documented).' });
    if (items.length < wanted.length) return res.status(400).json({ error: `${wanted.length - items.length} selected item(s) have no identified inaccuracy and were refused.` });
    const letterType = Law.DISPUTE_TYPES[b.letterType] ? b.letterType : items[0].letterType;
    // Guardrail 2: near-duplicate repeat disputes are blocked (frivolous-dispute risk).
    const guard = DisputeReasons.checkRepeat({ items, recipient, letterType, priorDisputes: (ws.disputes || []).filter(d => d.clientId === c.id), newEvidence: String(b.newEvidence || '').trim() });
    if (!guard.ok) return res.status(409).json({ error: 'Blocked to avoid a repeat/frivolous dispute', blocked: guard.blocked, warnings: guard.warnings });
    const bureau = Law.BUREAUS && Law.BUREAUS[recipient];
    const built = Letters.build(letterType, {
      client: c, recipient: bureau ? { name: bureau.name, address: bureau.address } : { name: recipient, address: String(b.recipientAddress || '') }, recipientName: recipient,
      items: items.map(i => Object.assign({}, i, { evidence: b.newEvidence ? String(b.newEvidence).slice(0, 500) : i.evidence })), today: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    });
    if (!built.ok) return res.status(400).json({ error: built.errors[0] });
    const cited = [...new Set(items.flatMap(i => i.kb))].map(id => KB.byId(id)).filter(Boolean).map(r => ({ id: r.id, cite: r.cite, url: r.url }));
    const base = { letterType, items, warnings: guard.warnings, citations: cited, lint: built.lint || [], requiresApproval: true };
    const cfg = aiConfig();
    if (!cfg.enabled || b.mode === 'template') { meta(req.user.email, 'letter.draft', `${c.id} ${recipient} template n=${items.length}`); return res.json(Object.assign(base, { mode: 'template', text: built.text })); }
    if (!letterLimit(req.user.id)) return res.json(Object.assign(base, { mode: 'template', text: built.text, notice: 'AI hourly safety limit reached — template letter returned.' }));
    try {
      // The AI sees only the BODY with identifiers redacted; the header (name/address) is re-attached locally.
      const marker = built.text.indexOf('Re:');
      const sign = built.text.lastIndexOf('\n\nSincerely,');
      const head = marker > 0 ? built.text.slice(0, marker) : '';
      const body = built.text.slice(Math.max(marker, 0), sign > marker ? sign : undefined);
      const tail = sign > marker ? built.text.slice(sign) : '';
      const out = await chat({
        system: `You edit consumer dispute letters. Rewrite the letter below in clear, plain, polite first-person English, specific to each item. Keep every fact, account reference (****1234 form), field name, statute citation and [CONFIRM ...] marker exactly. Do not add facts, threats, legal conclusions, or any promise of deletion. Do not add items. Keep it under 450 words. Return only the letter body.\n${RAILS}`,
        messages: [{ role: 'user', content: redact(body) }], maxTokens: 1400
      });
      const fixed = safeText(out.text, body);
      const keepsFacts = items.every(i => !i.accountNumber || fixed.text.includes(i.accountNumber));
      const text = head + (fixed.replaced || !keepsFacts ? body : fixed.text) + tail;
      meta(req.user.email, 'letter.draft', `${c.id} ${recipient} ai n=${items.length} in=${out.usage.prompt_tokens || '?'} out=${out.usage.completion_tokens || '?'}${fixed.replaced || !keepsFacts ? ' fallback' : ''}`);
      res.json(Object.assign(base, { mode: fixed.replaced || !keepsFacts ? 'template' : 'ai', model: out.model, text, lint: Law.lintText ? Law.lintText(text) : [] }));
    } catch (e) {
      meta(req.user.email, 'letter.draft', `${c.id} ${recipient} ai-error ${e.status || ''}`);
      res.json(Object.assign(base, { mode: 'template', text: built.text, notice: 'AI unavailable — template letter returned.' }));
    }
  });

  // Public helper for /apply and /portal. No client data is ever sent; rate-limited per browser
  // session and per IP.
  app.post('/api/assistant/public', async (req, res) => {
    let sid = sessionKey(req);
    if (!sid) { sid = crypto.randomBytes(16).toString('base64url'); res.cookie('ledger_helper', sid, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 24 * 3600 * 1000, path: '/' }); }
    if (!publicSessionLimit(sid) || !publicIpLimit(req.ip)) return res.status(429).json({ error: 'You’ve asked a lot of questions — a team member can help. Please use the form or call us.' });
    const page = (req.body || {}).page === 'portal' ? 'portal' : 'apply';
    const q = String((req.body || {}).message || '').slice(0, 800);
    if (!q.trim()) return res.status(400).json({ error: 'Type a question' });
    const cfg = aiConfig();
    if (!cfg.enabled) { meta('public', 'assistant.public', `${page} faq`); return res.json({ mode: 'faq', text: faqAnswer(q) }); }
    try {
      const out = await chat({ system: `${PUBLIC_SYSTEM}\n\nApproved answers you may draw on:\n${FAQ.map(f => '- ' + f.a).join('\n')}\n\nKnowledge base:\n${kbDigest(['compliance', 'personal'])}`, messages: [{ role: 'user', content: redact(q) }], maxTokens: 400 });
      const safe = safeText(out.text, faqAnswer(q));
      meta('public', 'assistant.public', `${page} ai in=${out.usage.prompt_tokens || '?'} out=${out.usage.completion_tokens || '?'}${safe.replaced ? ' replaced' : ''}`);
      res.json({ mode: 'ai', text: safe.text + (/team member/i.test(safe.text) ? '' : ' A team member can help with anything specific to your file.') });
    } catch (e) {
      meta('public', 'assistant.public', `${page} error`);
      res.json({ mode: 'faq', text: faqAnswer(q) });
    }
  });
}
