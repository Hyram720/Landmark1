/*
 * Automatic, CROA-safe billing. Invoices are created only for work already performed
 * (a letter mailed, an item deleted, or a month in which letters were mailed), and only
 * after the client's 3-business-day cancellation period (15 U.S.C. § 1679b(b)).
 *
 * Each client agreement runs for a fixed term (default 12 months from the date the contract is
 * signed) with a not-to-exceed total (default $1,188, the figure on the pricing page and in the
 * agreement). No invoice may push the client's total for the term over that cap, and work done
 * after the term ends isn't billed until a new written agreement is signed. The server applies the
 * same check (capViolations) before saving the workspace.
 */
(function (root) {
  'use strict';
  const Law = root.Law;
  const Store = new Proxy({}, { get: (t, k) => root.Store[k] });

  const MODELS = [
    ['manual', 'Manual — I create invoices myself'],
    ['per_letter', 'Per letter — bill each dispute letter after it is mailed'],
    ['per_delete', 'Pay per delete — bill only when an item is removed or corrected'],
    ['monthly', 'Monthly after service — one invoice per month in which letters were mailed']
  ];
  const DEFAULTS = { model: 'manual', perLetter: 49, perDelete: 75, monthly: 99, dueDays: 7, provider: 'none', payLink: '', termMonths: 12, termCap: 1188 };
  const UNBILLED_TYPES = ['cfpb_complaint', 'disclosure_609', 'goodwill'];

  const settings = ws => Object.assign({}, DEFAULTS, ws.settings.billing || {});
  const modelFor = (ws, c) => (c.billingModel && c.billingModel !== 'inherit') ? c.billingModel : settings(ws).model;
  const payToken = () => (Store.uid() + Store.uid()).replace(/-/g, '');
  const money = n => '$' + Number(n || 0).toFixed(2);

  // ---------- agreement term + total cap ----------
  /** 'YYYY-MM-DD' plus n calendar months (day clamped to the month's length, e.g. Jan 31 + 1 = Feb 28). */
  function addMonths(date, n) {
    const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
    const t = (m - 1) + n, yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  }
  const termLimits = ws => { const s = settings(ws); return { months: Number(s.termMonths) > 0 ? Number(s.termMonths) : 12, cap: Number(s.termCap) > 0 ? Number(s.termCap) : 1188 }; };
  const invDate = i => String(i.serviceCompletedAt || i.issuedAt || '').slice(0, 10);
  const live = i => i && i.status !== 'void';

  /** The client's current agreement term: starts on the contract date (or, with no contract on file,
   *  the first billed date), ends `termMonths` later (exclusive). */
  function term(ws, c, onDate) {
    const { months, cap } = termLimits(ws);
    const signed = c && c.onboarding && c.onboarding.contractSignedAt;
    let start = signed ? String(signed).slice(0, 10) : null;
    if (!start) {
      const dates = (ws.invoices || []).filter(i => live(i) && i.clientId === c.id).map(invDate).filter(Boolean).sort();
      start = dates[0] || (onDate ? String(onDate).slice(0, 10) : null);
    }
    return start ? { start, end: addMonths(start, months), months, cap } : null;
  }
  /** Total of live invoices dated inside the term (optionally ignoring some invoice ids). */
  function termTotal(ws, c, t, exclude) {
    const skip = new Set(exclude || []);
    return (ws.invoices || []).filter(i => live(i) && i.clientId === c.id && !skip.has(i.id)).filter(i => { const d = invDate(i); return d >= t.start && d < t.end; })
      .reduce((n, i) => n + (Number(i.amount) || 0), 0);
  }
  /** Can `amount` be billed for work completed on `serviceDate`? { ok, reason, start, end, cap, billed, remaining } */
  function capCheck(ws, c, amount, serviceDate, opts) {
    opts = opts || {};
    const date = String(serviceDate || '').slice(0, 10);
    const t = term(ws, c, date);
    if (!t) return { ok: true };
    const billed = Math.round((termTotal(ws, c, t, opts.exclude) + (Number(opts.pending) || 0)) * 100) / 100;
    const remaining = Math.max(0, Math.round((t.cap - billed) * 100) / 100);
    const out = { start: t.start, end: t.end, cap: t.cap, billed, remaining };
    if (date && date >= t.end) return Object.assign(out, { ok: false, reason: `the ${t.months}-month agreement that started ${t.start} ended ${t.end}; a new written agreement is needed before billing more` });
    if (billed + Number(amount || 0) > t.cap + 0.005) return Object.assign(out, { ok: false, reason: `${money(amount)} would bring this agreement's total to ${money(billed + Number(amount || 0))}, over the ${money(t.cap)} cap for the ${t.months}-month term (${money(remaining)} left)` });
    return Object.assign(out, { ok: true });
  }
  /** Invoices in `next` that are new (or newly non-void, larger, or re-dated) compared with `prev`
   *  and break the term or cap. Unchanged invoices are accepted as they are, so older data is never
   *  rejected retroactively. Returns [{ invoice, client, reason }]. */
  function capViolations(prev, next) {
    const old = new Map(((prev && prev.invoices) || []).map(i => [i.id, i]));
    const changed = i => { const was = old.get(i.id); return live(i) && (!was || !live(was) || Number(i.amount) > Number(was.amount) + 0.005 || invDate(i) !== invDate(was)); };
    const all = next.invoices || [];
    const ws = Object.assign({}, next, { invoices: all.filter(i => live(i) && !changed(i)) });
    const out = [];
    all.filter(changed).forEach(i => {
      const c = (next.clients || []).find(x => x.id === i.clientId);
      if (!c) return;
      const r = capCheck(ws, c, Number(i.amount), invDate(i));
      if (r.ok) ws.invoices.push(i); else out.push({ invoice: i, client: c, reason: r.reason });
    });
    return out;
  }

  /** Invoices that should exist now but don't. Returns invoice objects ready to push. */
  function due(ws, today, blocked) {
    const s = settings(ws), out = [];
    blocked = blocked || [];
    ws.clients.forEach(c => {
      const model = modelFor(ws, c);
      if (model === 'manual' || ['cancelled', 'paused'].includes(c.status)) return;
      const cs = Store.croaStatus(c, today);
      if (!cs.cleared) return;
      const after = d => d && d <= today && (!cs.deadline || d > cs.deadline);
      const has = pred => ws.invoices.some(i => i.clientId === c.id && i.status !== 'void' && pred(i));
      let added = 0;
      const push = o => {
        const r = capCheck(ws, c, o.amount, o.serviceCompletedAt, { pending: added });
        if (!r.ok) { blocked.push({ clientId: c.id, client: c.name, description: o.description, amount: o.amount, reason: r.reason }); return; }
        added += Number(o.amount) || 0;
        out.push(o);
      };
      const inv = (o) => Object.assign({ id: Store.uid(), clientId: c.id, status: 'issued', issuedAt: today, dueAt: Law.addDays(today, s.dueDays), paidAt: null, auto: true, payToken: payToken() }, o);
      const mailed = ws.disputes.filter(d => d.clientId === c.id && d.sentAt && !UNBILLED_TYPES.includes(d.type) && after(d.sentAt));
      if (model === 'per_letter') {
        mailed.filter(d => !has(i => i.disputeId === d.id)).forEach(d => push(inv({
          description: `Dispute letter prepared and mailed — ${d.recipient} (${(Law.DISPUTE_TYPES[d.type] || {}).label || d.type}, round ${d.round})`, amount: Number(s.perLetter), serviceCompletedAt: d.sentAt, disputeId: d.id })));
      }
      if (model === 'per_delete') {
        ws.disputes.filter(d => d.clientId === c.id).forEach(d => d.items.forEach((it, i) => {
          const res = it.result || (['deleted', 'corrected'].includes(d.outcome) ? d.outcome : null);
          const at = it.resultAt || d.respondedAt;
          if (!['deleted', 'corrected'].includes(res) || !after(at)) return;
          const itemKey = `${d.id}:${i}`;
          if (has(x => x.itemKey === itemKey)) return;
          push(inv({ description: `Result achieved — ${it.creditor} ${res === 'deleted' ? 'removed from' : 'corrected on'} ${it.bureau || d.recipient}`, amount: Number(s.perDelete), serviceCompletedAt: at, disputeId: d.id, itemKey }));
        }));
      }
      if (model === 'monthly') {
        const last = ws.invoices.filter(i => i.clientId === c.id && i.status !== 'void' && i.period).sort((a, b) => String(b.period).localeCompare(String(a.period)))[0];
        const since = last ? last.period : (cs.deadline || '0000-00-00');
        if (last && Law.daysBetween(last.period, today) < 30) return;
        const work = mailed.filter(d => d.sentAt > since);
        if (!work.length) return;
        const lastWork = work.map(d => d.sentAt).sort().pop();
        push(inv({ description: `Monthly credit dispute service — ${work.length} letter${work.length > 1 ? 's' : ''} prepared and mailed (${work.map(d => d.recipient).join(', ')})`, amount: Number(s.monthly), serviceCompletedAt: lastWork, period: today }));
      }
    });
    return out;
  }

  const api = { MODELS, DEFAULTS, settings, modelFor, due, payToken, addMonths, term, termTotal, capCheck, capViolations };
  root.Billing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
