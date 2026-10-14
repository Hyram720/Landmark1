/* Sales pipeline: lead stages and a simple lead score (how ready a lead is to enroll). */
(function (root) {
  'use strict';
  const Law = root.Law;

  const STAGES = [
    ['new', 'New lead'], ['contacted', 'Contacted'], ['consult', 'Consultation booked'], ['analysis', 'Analysis sent'],
    ['agreement', 'Agreement sent'], ['won', 'Enrolled'], ['lost', 'Not now']
  ];

  function stageOf(c) {
    if (c.status === 'cancelled') return 'lost';
    if (c.status !== 'lead') return 'won';
    return STAGES.some(s => s[0] === c.leadStage) ? c.leadStage : 'new';
  }

  /** 0–100 score with reasons. */
  function score(ws, c, today) {
    const reasons = [];
    let s = 0;
    const add = (n, why) => { s += n; reasons.push((n > 0 ? '+' : '') + n + ' ' + why); };
    if (c.phone) add(15, 'phone on file');
    if (c.email) add(10, 'email on file');
    if (c.smsConsent) add(5, 'agreed to texts');
    if (ws.reports.some(r => r.clientId === c.id) || (ws.documents || []).some(d => d.clientId === c.id && d.type === 'report')) add(20, 'credit report provided');
    const st = stageOf(c);
    const stageBonus = { contacted: 5, consult: 15, analysis: 20, agreement: 25 }[st];
    if (stageBonus) add(stageBonus, 'stage: ' + STAGES.find(x => x[0] === st)[1].toLowerCase());
    if (c.referralId) add(10, 'referred by a partner');
    if (c.kind && c.kind !== 'personal') add(5, 'business credit interest');
    if (/mortgage|home|house|car|auto|apartment|rent|job|loan/i.test(c.notes || '')) add(10, 'has a near-term goal');
    const age = Law.daysBetween(String(c.createdAt || today).slice(0, 10), today);
    const lastTouch = (ws.activity || []).filter(a => a.clientId === c.id).map(a => String(a.at).slice(0, 10)).sort().pop() || String(c.createdAt || '').slice(0, 10);
    const quiet = lastTouch ? Law.daysBetween(lastTouch, today) : age;
    if (age <= 2) add(10, 'new in the last 2 days');
    if (quiet > 14) add(-20, `no activity for ${quiet} days`);
    s = Math.max(0, Math.min(100, s));
    return { score: s, heat: s >= 60 ? 'hot' : s >= 35 ? 'warm' : 'cold', reasons, quiet };
  }

  /** Referral partner commissions. r.commissionType: 'flat' (per enrolled client) | 'percent' (of paid invoices) | 'none'. */
  function commissions(ws, r, today) {
    const Store = root.Store;
    const clients = ws.clients.filter(c => c.referralId === r.id);
    const lines = [];
    if (r.commissionType === 'flat') clients.forEach(c => {
      const cs = Store.croaStatus(c, today);
      const enrolled = c.kind === 'business' ? ['active', 'completed'].includes(c.status) : cs.cleared && !cs.cancelled;
      if (enrolled) lines.push({ clientId: c.id, what: 'Enrolled client', at: cs.deadline || String(c.createdAt).slice(0, 10), amount: Number(r.commissionAmount) || 0 });
    });
    if (r.commissionType === 'percent') ws.invoices.filter(i => i.status === 'paid' && clients.some(c => c.id === i.clientId)).forEach(i => lines.push({ clientId: i.clientId, what: 'Paid invoice ' + i.description, at: i.paidAt, amount: Math.round(Number(i.amount) * (Number(r.commissionAmount) || 0)) / 100 }));
    const earned = lines.reduce((a, l) => a + l.amount, 0);
    const paid = (r.payouts || []).reduce((a, p) => a + Number(p.amount || 0), 0);
    return { clients, lines, earned, paid, owed: Math.max(0, Math.round((earned - paid) * 100) / 100) };
  }

  const api = { STAGES, stageOf, score, commissions };
  root.Sales = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
