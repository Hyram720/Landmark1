// Step-by-step business credit coach. Staff: any business client. Clients: their own file only
// (need('client') + req.user.clientId — the client id is never taken from the request).
// The coach explains the current 90-day-plan step, asks whether it is done, and records the answer:
// staff confirmations mark the step complete; client confirmations are flagged for staff review.
// It also coaches on utilization (balance ÷ limit) with lawful steps and no score promises.
import { Business, KB } from './shared.js';
import { redact } from './redact.js';
import { aiConfig, chatCompletion, safeAnswer, businessDigest, RAILS } from './ledger-assistant.js';
import { rateLimiter } from './auth.js';

const today = () => new Date().toISOString().slice(0, 10);
const COACH_KB = ['biz-building', 'biz-fcra-scope', 'biz-dnb', 'biz-experian', 'biz-equifax', 'biz-pg', 'biz-util-intelliscore', 'biz-paydex-timing', 'util-30', 'util-guarantee'];

/** Deterministic coaching text (used when AI is off, and as grounding when it is on). */
export function coachText(st, audience) {
  const you = audience === 'client';
  const P = [];
  if (!st.started) P.push(you ? 'Your 90-day business credit plan hasn’t been started yet. Your advisor will start it with you.' : 'The 90-day plan isn’t started. Start it from the coach to set due dates [biz-building].');
  else if (!st.current) P.push(`All ${st.total} plan steps are complete. Keep paying vendors early and keep balances low relative to limits.`);
  else {
    P.push(`**Step ${st.done + 1} of ${st.total}: ${st.current.title}** (due ${st.current.due}${st.current.overdue ? ' — overdue' : ''})`);
    const how = (Business.FAST_TRACK.find(s => s.key === st.current.key) || {}).how;
    if (how) P.push(how);
    P.push(you ? 'Have you finished this step? Tap “I’ve done this” and your advisor will review it.' : 'Is this step done? Mark it complete when the client has confirmed it (and you’ve checked any document).');
    if (st.next) P.push(`Up next: ${st.next.title} (due ${st.next.due}).`);
  }
  if (st.overdue && st.overdue.length > 1) P.push(`Overdue: ${st.overdue.map(o => o.title.split(':')[0]).join('; ')}.`);
  const u = st.utilization;
  if (u.business.accounts.length) P.push(`Business utilization: ${u.business.pct}% of ${'$' + u.business.limit.toLocaleString()} in limits.`);
  u.tips.forEach(t => P.push(t));
  if (!u.tips.length && u.business.accounts.length) P.push('Utilization looks low. PAYDEX rewards paying before the due date [biz-paydex-timing]; lower utilization is generally better for Experian [biz-util-intelliscore].');
  P.push(you ? 'This is general information, not a promise of any score or approval.' : 'No score or approval promises [croa-misrep].');
  return P.join('\n\n');
}

export function mountCoach(app, { need, workspace, db, commit, activity }) {
  const limit = rateLimiter(120, 60 * 60 * 1000);
  const find = id => (workspace().clients || []).find(c => c.id === id && c.kind !== 'personal');
  const view = (c, audience) => {
    const st = Business.coachState(c, workspace(), today());
    // Clients see their own plan, vendors and utilization only — nothing staff-internal.
    const out = { state: audience === 'client' ? Object.assign({}, st, { pending: undefined }) : st, text: coachText(st, audience), kbVersion: KB.version };
    return out;
  };
  const ask = async (c, audience, question, res, actor) => {
    const base = view(c, audience);
    const cfg = aiConfig();
    if (!cfg.enabled) { db.audit({ actor, action: 'coach.chat', detail: `${c.id} offline` }); db.persistSoon(); return res.json(Object.assign(base, { mode: 'offline' })); }
    try {
      const sys = `You are a step-by-step business credit coach ${audience === 'client' ? 'talking to the business owner about their own file' : 'helping staff coach a business client'}. Walk the 90-day plan one step at a time: explain the current step, ask if it is done, then move on. Coach on utilization (balance ÷ limit) with lawful steps only: pay before the statement date, pay down balances, request limit increases, spread spend. PAYDEX is payment timing only; Experian Intelliscore considers utilization. Use "may", never "will". Keep it under 180 words.\n${RAILS}\n\nKnowledge base:\n${KB.rules.filter(r => COACH_KB.includes(r.id) || r.id === 'croa-misrep').map(r => `[${r.id}] ${r.title}: ${r.rule}`).join('\n')}`;
      const ctx = `<business_file redacted="true">\n${businessDigest(c, workspace(), today())}\n</business_file>\n\nDeterministic coach notes:\n${base.text}\n\nQuestion: ${redact(String(question || 'What should I do next?').slice(0, 1500))}`;
      const out = await chatCompletion({ system: sys, messages: [{ role: 'user', content: ctx }], maxTokens: 2500 });
      const safe = safeAnswer(out.text, base.text);
      db.audit({ actor, action: 'coach.chat', detail: `${c.id} ai in=${out.usage.prompt_tokens || '?'} out=${out.usage.completion_tokens || '?'}${safe.replaced ? ' replaced' : ''}` }); db.persistSoon();
      res.json(Object.assign(base, { mode: 'ai', text: safe.text }));
    } catch (e) {
      db.audit({ actor, action: 'coach.chat', detail: `${c.id} error` }); db.persistSoon();
      res.json(Object.assign(base, { mode: 'offline', notice: 'AI unavailable — showing the plan coach.' }));
    }
  };

  // ---------- staff ----------
  app.get('/api/coach/:id', need('owner', 'staff'), (req, res) => { const c = find(req.params.id); if (!c) return res.status(404).json({ error: 'Business client not found' }); res.json(view(c, 'staff')); });
  app.post('/api/coach/:id/start', need('owner', 'staff'), (req, res) => {
    const c = find(req.params.id); if (!c) return res.status(404).json({ error: 'Business client not found' });
    c.creditPlan = c.creditPlan || {}; if (!c.creditPlan.startedAt) c.creditPlan.startedAt = today();
    activity(`Started the 90-day business credit plan for ${c.name}`, c.id); commit(req.user.email, 'coach.start', c.id);
    res.json(view(c, 'staff'));
  });
  app.post('/api/coach/:id/step', need('owner', 'staff'), (req, res) => {
    const c = find(req.params.id); if (!c) return res.status(404).json({ error: 'Business client not found' });
    const key = String((req.body || {}).key || '');
    const step = Business.FAST_TRACK.find(s => s.key === key); if (!step) return res.status(400).json({ error: 'Unknown step' });
    c.creditPlan = c.creditPlan || { startedAt: today() };
    c.creditPlan.done = c.creditPlan.done || {};
    const done = (req.body || {}).done !== false;
    if (done) c.creditPlan.done[key] = today(); else delete c.creditPlan.done[key];
    const conf = (c.creditPlan.clientConfirmed || {})[key];
    if (conf && !conf.reviewedAt) Object.assign(conf, { reviewedAt: new Date().toISOString(), reviewedBy: req.user.email, accepted: done });
    activity(`${done ? 'Completed' : 'Reopened'} plan step “${step.title.split(':')[0]}” for ${c.name}`, c.id); commit(req.user.email, 'coach.step', `${c.id} ${key} ${done ? 'done' : 'reopened'}`);
    res.json(view(c, 'staff'));
  });
  app.post('/api/coach/:id/chat', need('owner', 'staff'), (req, res) => {
    if (!limit('s:' + req.user.id)) return res.status(429).json({ error: 'Hourly coach limit reached.' });
    const c = find(req.params.id); if (!c) return res.status(404).json({ error: 'Business client not found' });
    return ask(c, 'staff', (req.body || {}).message, res, req.user.email);
  });

  // ---------- client (own file only) ----------
  const own = req => find(req.user.clientId);
  app.get('/api/portal/coach', need('client'), (req, res) => { const c = own(req); if (!c) return res.status(404).json({ error: 'No business credit plan on your file' }); res.json(view(c, 'client')); });
  app.post('/api/portal/coach/step', need('client'), (req, res) => {
    const c = own(req); if (!c) return res.status(404).json({ error: 'No business credit plan on your file' });
    const key = String((req.body || {}).key || '');
    const step = Business.FAST_TRACK.find(s => s.key === key); if (!step) return res.status(400).json({ error: 'Unknown step' });
    c.creditPlan = c.creditPlan || {};
    c.creditPlan.clientConfirmed = c.creditPlan.clientConfirmed || {};
    c.creditPlan.clientConfirmed[key] = { at: new Date().toISOString(), note: String((req.body || {}).note || '').slice(0, 300) };
    activity(`${c.name} says plan step “${step.title.split(':')[0]}” is done — review in the coach`, c.id);
    commit(req.user.email, 'coach.client_confirm', `${c.id} ${key}`);
    res.json(Object.assign(view(c, 'client'), { message: 'Thanks! Your advisor will review this step and mark it complete.' }));
  });
  app.post('/api/portal/coach/chat', need('client'), (req, res) => {
    if (!limit('c:' + req.user.id)) return res.status(429).json({ error: 'You’ve asked a lot of questions — your advisor can help.' });
    const c = own(req); if (!c) return res.status(404).json({ error: 'No business credit plan on your file' });
    return ask(c, 'client', (req.body || {}).message, res, req.user.email);
  });
}
