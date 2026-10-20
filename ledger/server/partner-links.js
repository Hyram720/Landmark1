// Tracked partner (affiliate) links: /go/partner/:key → the owner's affiliate URL, with a hashed
// sub-ID per client or staff member where the network supports one. Click records hold metadata
// only (time, partner, role, hashed sub-ID, referring page) — no names, emails or IPs.
// Recommending a partner is never a condition of service (CROA), and every placement shows the
// FTC affiliate disclosure (Partners.AFFILIATE_NOTE).
import crypto from 'node:crypto';
import { Partners } from './shared.js';

const MAX_CLICKS = 20000;

export function mountPartnerLinks(app, { need, workspace, db, D, currentUser }) {
  const subFor = (kind, id) => kind + '-' + crypto.createHmac('sha256', D().secret).update(String(id)).digest('base64url').slice(0, 10);

  app.get('/go/partner/:key', (req, res) => {
    const ws = workspace();
    const o = (ws.offers || []).find(x => x.key === req.params.key);
    if (!o || o.enabled === false) return res.status(404).type('text/plain').send('This partner link is not active.');
    const dest = o.affiliateUrl || '';
    if (!/^https:\/\//.test(dest)) return res.status(404).type('text/plain').send('This partner link has not been set up yet.');
    const u = currentUser(req);
    const role = u ? u.role : 'public';
    const sub = u && u.role === 'client' ? subFor('c', u.clientId) : u ? subFor('s', u.id) : (/^[\w-]{1,24}$/.test(String(req.query.s || '')) ? 'x-' + req.query.s : '');
    let from = '';
    try { from = new URL(req.get('referer') || '').pathname.slice(0, 40); } catch { /* none */ }
    const clicks = (D().partnerClicks = D().partnerClicks || []);
    clicks.unshift({ at: new Date().toISOString(), key: o.key, role, sub, from });
    if (clicks.length > MAX_CLICKS) clicks.length = MAX_CLICKS;
    o.clicks = (o.clicks || 0) + 1;
    db.persistSoon();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).redirect(302, Partners.withSubId(dest, o.subIdParam !== undefined ? o.subIdParam : Partners.SUBID_PARAM[Partners.networkOf(o)], sub));
  });

  app.get('/api/partners/clicks', need('owner', 'staff'), (req, res) => {
    const now = Date.now(), day = 86400000;
    const by = {};
    (D().partnerClicks || []).forEach(c => {
      const b = (by[c.key] = by[c.key] || { key: c.key, total: 0, last7: 0, last30: 0, byRole: {}, lastAt: null });
      const age = now - Date.parse(c.at);
      b.total += 1; if (age < 7 * day) b.last7 += 1; if (age < 30 * day) b.last30 += 1;
      b.byRole[c.role] = (b.byRole[c.role] || 0) + 1;
      if (!b.lastAt || c.at > b.lastAt) b.lastAt = c.at;
    });
    const offers = (workspace().offers || []).map(o => Object.assign({ key: o.key, name: o.name, audience: o.audience, enabled: o.enabled !== false, linkSet: /^https:\/\//.test(o.affiliateUrl || ''), joinUrl: o.joinUrl, network: o.network || Partners.networkOf(o), subIdParam: o.subIdParam || '' }, by[o.key] || { total: 0, last7: 0, last30: 0, byRole: {}, lastAt: null }));
    res.json({ offers, disclosure: Partners.AFFILIATE_NOTE });
  });
}
