/*
 * Automation rules: "when this happens, after N days, send this message or create this task".
 * Triggers are detected from the workspace itself, so events from the portal, intake form and
 * staff all count. Each rule fires once per event (keys are logged), and never for events that
 * happened before the rule was turned on.
 */
(function (root) {
  'use strict';
  const Law = root.Law;
  const Store = new Proxy({}, { get: (t, k) => root.Store[k] });

  const TRIGGERS = {
    lead_new: 'A new lead is added',
    lead_stale: 'A lead has not become a client',
    contract_signed: 'The client signs the agreement',
    no_report: 'No credit report yet after signing',
    report_refresh: 'Time for a fresh credit report (monthly re-pull)',
    letter_mailed: 'Dispute letters are mailed',
    item_removed: 'An item is removed or corrected',
    response_overdue: 'A response deadline passes with no answer',
    invoice_issued: 'An invoice is issued',
    invoice_overdue: 'An invoice is past due',
    progress_monthly: 'Monthly progress update',
    sequence_due: 'Sequence letters are drafted and need approval'
  };

  const DEFAULT_RULES = [
    { id: 'welcome-lead', trigger: 'lead_new', delayDays: 0, channel: 'email', subject: 'Thanks for reaching out to {{company}}', body: 'Hi {{first}}, thanks for contacting {{company}}. The next step is a free consultation where we review your credit reports together and explain your options — including the things you can do on your own for free. {{booking_line}}Questions? Reply here or call {{phone}}.', enabled: true },
    { id: 'call-lead', trigger: 'lead_new', delayDays: 0, channel: 'task', subject: 'Call new lead {{name}}', body: '', enabled: true },
    { id: 'lead-followup', trigger: 'lead_stale', delayDays: 3, channel: 'email', subject: 'Following up on your credit review', body: 'Hi {{first}}, just following up. If you would still like a free review of your credit reports, {{booking_or_reply}}. — {{company}}', enabled: true },
    { id: 'signed-next', trigger: 'contract_signed', delayDays: 0, channel: 'email', subject: 'Welcome — here is what happens next', body: 'Welcome, {{first}}! Your 3-business-day cancellation period is running now; we start work after it ends. Please upload a recent credit report, a photo ID and proof of address in your portal: {{portal}}', enabled: true },
    { id: 'no-report', trigger: 'no_report', delayDays: 3, channel: 'sms', subject: '', body: 'Hi {{first}}, it’s {{company}}. We still need your current credit report to get started. Upload it in your portal: {{portal}} Reply STOP to opt out.', enabled: true },
    { id: 'monthly-repull', trigger: 'report_refresh', delayDays: 35, channel: 'email', subject: 'Time to refresh your credit report', body: 'Hi {{first}}, it has been about a month since your last credit report. Please download a fresh 3-bureau report from your monitoring service and upload it in your portal ({{portal}}) so we can see what was removed and plan the next round.', enabled: true },
    { id: 'mailed', trigger: 'letter_mailed', delayDays: 0, channel: 'email', subject: 'Your dispute letters were mailed', body: 'Hi {{first}}, we mailed {{count}} letter(s) for you today ({{recipients}}). Recipients generally have 30 days from receipt to respond. We’ll let you know as soon as we hear back. Track progress anytime: {{portal}}', enabled: true },
    { id: 'removed', trigger: 'item_removed', delayDays: 0, channel: 'email', subject: 'Good news on your credit file', body: 'Great news, {{first}}! {{creditor}} was {{result}} by {{bureau}}. See all results in your portal: {{portal}} If you are happy with our work, a short review would mean a lot to us.', enabled: true },
    { id: 'overdue', trigger: 'response_overdue', delayDays: 5, channel: 'task', subject: 'No response from {{recipient}} for {{name}} — record “No response” and check the violation tracker', body: '', enabled: true },
    { id: 'invoice', trigger: 'invoice_issued', delayDays: 0, channel: 'email', subject: 'Invoice from {{company}}: {{amount}}', body: 'Hi {{first}}, this invoice is for work already completed: {{description}}. Amount: {{amount}}, due {{due}}. {{pay_line}}Thank you!', enabled: true },
    { id: 'invoice-late', trigger: 'invoice_overdue', delayDays: 3, channel: 'email', subject: 'Reminder: invoice of {{amount}} is past due', body: 'Hi {{first}}, a friendly reminder that your invoice for {{description}} ({{amount}}) was due {{due}}. {{pay_line}}If you have questions, reply here.', enabled: true },
    { id: 'progress', trigger: 'progress_monthly', delayDays: 0, channel: 'email', subject: 'Your monthly credit progress update', body: 'Hi {{first}}, here is your monthly update. Items removed or corrected so far: {{removed_count}}. Disputes in progress: {{open_count}}. See the details and your score history in your portal: {{portal}}', enabled: true },
    { id: 'sequence-approve', trigger: 'sequence_due', delayDays: 0, channel: 'task', subject: 'Review and approve sequence letters for {{name}}', body: '', enabled: true }
  ];

  const bucket = (from, today, days) => Math.floor(Law.daysBetween(from, today) / days);
  const d10 = v => String(v || '').slice(0, 10);

  /** Events per trigger: [{ key, clientId, at, vars, still? }]. */
  function events(ws, trigger, today) {
    const out = [];
    const clients = ws.clients;
    const reportsFor = cid => ws.reports.filter(r => r.clientId === cid).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (trigger === 'lead_new') clients.filter(c => c.status === 'lead').forEach(c => out.push({ key: c.id, clientId: c.id, at: d10(c.createdAt) }));
    if (trigger === 'lead_stale') clients.filter(c => c.status === 'lead').forEach(c => out.push({ key: c.id, clientId: c.id, at: d10(c.createdAt), still: () => c.status === 'lead' }));
    if (trigger === 'contract_signed') clients.filter(c => (c.onboarding || {}).contractSignedAt).forEach(c => out.push({ key: c.id, clientId: c.id, at: c.onboarding.contractSignedAt }));
    if (trigger === 'no_report') clients.filter(c => (c.onboarding || {}).contractSignedAt && c.kind !== 'business' && !['cancelled', 'completed'].includes(c.status)).forEach(c => out.push({ key: c.id, clientId: c.id, at: c.onboarding.contractSignedAt, still: () => !reportsFor(c.id).length }));
    if (trigger === 'report_refresh') clients.filter(c => c.status === 'active').forEach(c => { const r = reportsFor(c.id)[0]; if (r) out.push({ key: c.id + ':' + r.id, clientId: c.id, at: d10(r.date), still: () => reportsFor(c.id)[0] === r }); });
    if (trigger === 'letter_mailed') {
      const groups = {};
      ws.disputes.filter(d => d.sentAt && d.type !== 'cfpb_complaint').forEach(d => { const k = d.clientId + ':' + d.sentAt; (groups[k] = groups[k] || { key: k, clientId: d.clientId, at: d.sentAt, list: [] }).list.push(d); });
      Object.values(groups).forEach(g => out.push({ key: g.key, clientId: g.clientId, at: g.at, vars: { count: g.list.length, recipients: g.list.map(d => d.recipient).join(', ') } }));
    }
    if (trigger === 'item_removed') ws.disputes.forEach(d => d.items.forEach((it, i) => {
      const res = it.result || (['deleted', 'corrected'].includes(d.outcome) ? d.outcome : null);
      if (['deleted', 'corrected'].includes(res)) out.push({ key: `${d.id}:${i}`, clientId: d.clientId, at: d10(it.resultAt || d.respondedAt), vars: { creditor: it.creditor, bureau: it.bureau || d.recipient, result: res === 'deleted' ? 'removed' : 'corrected' } });
    }));
    if (trigger === 'response_overdue') ws.disputes.filter(d => d.dueAt && d.sentAt && !d.outcome).forEach(d => out.push({ key: d.id, clientId: d.clientId, at: d.dueAt, vars: { recipient: d.recipient }, still: () => !d.outcome }));
    if (trigger === 'invoice_issued') ws.invoices.filter(i => i.status === 'issued').forEach(i => out.push({ key: i.id, clientId: i.clientId, at: i.issuedAt, vars: invVars(i) }));
    if (trigger === 'invoice_overdue') ws.invoices.filter(i => i.status === 'issued' && i.dueAt).forEach(i => out.push({ key: i.id, clientId: i.clientId, at: i.dueAt, vars: invVars(i), still: () => i.status === 'issued' }));
    if (trigger === 'progress_monthly') clients.filter(c => c.status === 'active' && (c.onboarding || {}).contractSignedAt).forEach(c => {
      const n = bucket(c.onboarding.contractSignedAt, today, 30);
      if (n < 1) return;
      const ds = ws.disputes.filter(d => d.clientId === c.id);
      const removed = ds.reduce((a, d) => a + d.items.filter((it) => ['deleted', 'corrected'].includes(it.result || d.outcome)).length, 0);
      out.push({ key: c.id + ':' + n, clientId: c.id, at: Law.addDays(c.onboarding.contractSignedAt, n * 30), vars: { removed_count: removed, open_count: ds.filter(d => d.sentAt && !d.outcome).length } });
    });
    if (trigger === 'sequence_due') (ws.disputes || []).filter(d => d.seqId && d.parentId && !d.sentAt && (ws.letters.find(l => l.id === d.letterId) || {}).status === 'draft').forEach(d => out.push({ key: d.clientId + ':' + d10(d.createdAt), clientId: d.clientId, at: d10(d.createdAt) }));
    return out;
  }
  function invVars(i) { return { amount: '$' + Number(i.amount || 0).toFixed(2), description: i.description, due: i.dueAt || '', invoiceId: i.id, payToken: i.payToken || '' }; }

  function fill(tpl, vars) { return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]))); }

  function varsFor(ws, c, ev, ctx) {
    const co = ws.settings.company || {};
    const booking = co.bookingUrl || '';
    const v = Object.assign({ first: c.firstName || String(c.name || '').split(' ')[0], name: c.name, company: co.name || 'our office', phone: co.phone || '', portal: (ctx.origin || '') + '/portal',
      booking, booking_line: booking ? `Pick a time that works for you: ${booking} ` : '', booking_or_reply: booking ? `pick a time here: ${booking}` : 'just reply to this message and we’ll set it up' }, ev.vars || {});
    const billing = Object.assign({ provider: 'none', payLink: '' }, ws.settings.billing || {});
    v.pay_line = billing.provider === 'authorizenet' && v.payToken && ctx.origin ? `Pay securely online: ${ctx.origin}/pay/${v.payToken} ` : billing.provider === 'link' && billing.payLink ? `Pay online: ${billing.payLink} ` : '';
    return v;
  }

  /** Rules merged with defaults (new default rules appear automatically, switched off for old workspaces). */
  function rules(ws) {
    const saved = ws.automations || [];
    const byId = Object.fromEntries(saved.map(r => [r.id, r]));
    return DEFAULT_RULES.map(r => Object.assign({}, r, byId[r.id] || { enabled: false })).concat(saved.filter(r => !DEFAULT_RULES.some(d => d.id === r.id)));
  }

  /** Actions due now. Each: { rule, key, client, channel, subject, body }. */
  function due(ws, today, ctx) {
    ctx = ctx || {};
    const log = ws.automationLog || {};
    const out = [];
    rules(ws).filter(r => r.enabled && r.enabledAt).forEach(r => {
      events(ws, r.trigger, today).forEach(ev => {
        const key = r.id + ':' + ev.key;
        if (log[key]) return;
        if (!ev.at || ev.at < d10(r.enabledAt)) return; // never fire for history
        if (Law.addDays(ev.at, Number(r.delayDays) || 0) > today) return;
        if (ev.still && !ev.still()) return;
        const c = ws.clients.find(x => x.id === ev.clientId);
        if (!c || c.status === 'cancelled' && r.trigger !== 'invoice_issued') return;
        const vars = varsFor(ws, c, ev, ctx);
        out.push({ rule: r, key, client: c, channel: r.channel, subject: fill(r.subject, vars), body: fill(r.body, vars) });
      });
    });
    return out;
  }

  const api = { TRIGGERS, DEFAULT_RULES, rules, events, due, fill };
  root.Automations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
