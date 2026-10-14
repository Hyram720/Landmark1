/*
 * Automatic, CROA-safe billing. Invoices are created only for work already performed
 * (a letter mailed, an item deleted, or a month in which letters were mailed), and only
 * after the client's 3-business-day cancellation period (15 U.S.C. § 1679b(b)).
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
  const DEFAULTS = { model: 'manual', perLetter: 49, perDelete: 75, monthly: 99, dueDays: 7, provider: 'none', payLink: '' };
  const UNBILLED_TYPES = ['cfpb_complaint', 'disclosure_609', 'goodwill'];

  const settings = ws => Object.assign({}, DEFAULTS, ws.settings.billing || {});
  const modelFor = (ws, c) => (c.billingModel && c.billingModel !== 'inherit') ? c.billingModel : settings(ws).model;
  const payToken = () => (Store.uid() + Store.uid()).replace(/-/g, '');

  /** Invoices that should exist now but don't. Returns invoice objects ready to push. */
  function due(ws, today) {
    const s = settings(ws), out = [];
    ws.clients.forEach(c => {
      const model = modelFor(ws, c);
      if (model === 'manual' || ['cancelled', 'paused'].includes(c.status)) return;
      const cs = Store.croaStatus(c, today);
      if (!cs.cleared) return;
      const after = d => d && d <= today && (!cs.deadline || d > cs.deadline);
      const has = pred => ws.invoices.some(i => i.clientId === c.id && i.status !== 'void' && pred(i));
      const inv = (o) => Object.assign({ id: Store.uid(), clientId: c.id, status: 'issued', issuedAt: today, dueAt: Law.addDays(today, s.dueDays), paidAt: null, auto: true, payToken: payToken() }, o);
      const mailed = ws.disputes.filter(d => d.clientId === c.id && d.sentAt && !UNBILLED_TYPES.includes(d.type) && after(d.sentAt));
      if (model === 'per_letter') {
        mailed.filter(d => !has(i => i.disputeId === d.id)).forEach(d => out.push(inv({
          description: `Dispute letter prepared and mailed — ${d.recipient} (${(Law.DISPUTE_TYPES[d.type] || {}).label || d.type}, round ${d.round})`, amount: Number(s.perLetter), serviceCompletedAt: d.sentAt, disputeId: d.id })));
      }
      if (model === 'per_delete') {
        ws.disputes.filter(d => d.clientId === c.id).forEach(d => d.items.forEach((it, i) => {
          const res = it.result || (['deleted', 'corrected'].includes(d.outcome) ? d.outcome : null);
          const at = it.resultAt || d.respondedAt;
          if (!['deleted', 'corrected'].includes(res) || !after(at)) return;
          const itemKey = `${d.id}:${i}`;
          if (has(x => x.itemKey === itemKey)) return;
          out.push(inv({ description: `Result achieved — ${it.creditor} ${res === 'deleted' ? 'removed from' : 'corrected on'} ${it.bureau || d.recipient}`, amount: Number(s.perDelete), serviceCompletedAt: at, disputeId: d.id, itemKey }));
        }));
      }
      if (model === 'monthly') {
        const last = ws.invoices.filter(i => i.clientId === c.id && i.status !== 'void' && i.period).sort((a, b) => String(b.period).localeCompare(String(a.period)))[0];
        const since = last ? last.period : (cs.deadline || '0000-00-00');
        if (last && Law.daysBetween(last.period, today) < 30) return;
        const work = mailed.filter(d => d.sentAt > since);
        if (!work.length) return;
        const lastWork = work.map(d => d.sentAt).sort().pop();
        out.push(inv({ description: `Monthly credit dispute service — ${work.length} letter${work.length > 1 ? 's' : ''} prepared and mailed (${work.map(d => d.recipient).join(', ')})`, amount: Number(s.monthly), serviceCompletedAt: lastWork, period: today }));
      }
    });
    return out;
  }

  const api = { MODELS, DEFAULTS, settings, modelFor, due, payToken };
  root.Billing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
