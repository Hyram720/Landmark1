// Optional rent-reporting referrals in the client portal. Clients are not charged.
// Each link is /go/rent/:provider, which records a signed-in client's click and redirects.
// Destinations default to the providers' public pages and can be replaced with affiliate
// URLs through LEDGER_RENT_BOOM_URL, LEDGER_RENT_CRB_URL and LEDGER_RENT_SELF_URL.
const PROVIDERS = [
  { id: 'boom', name: 'Boom', env: 'LEDGER_RENT_BOOM_URL', fallback: 'https://www.boompay.app/renters', detail: 'Reports rent to all three bureaus. About $5/month.' },
  { id: 'crb', name: 'Credit Rent Boost', env: 'LEDGER_RENT_CRB_URL', fallback: 'https://www.creditrentboost.com/', detail: 'Reports rent to all three bureaus. About $6.95/month.' },
  { id: 'self', name: 'Self', env: 'LEDGER_RENT_SELF_URL', fallback: 'https://www.self.inc/rent-and-bills-reporting', detail: 'Reports rent to all three bureaus. About $6.95/month.' }
];

export const RENT_DISCLOSURE = 'These are independent third-party services. Credit Ledger may be compensated for referring you. Prices are set by the provider and may change.';

function destination(provider, env = process.env) {
  const raw = String(env[provider.env] || '').trim();
  if (!raw) return provider.fallback;
  try {
    const u = new URL(raw);
    // Affiliate links must be https and must not carry embedded credentials.
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return provider.fallback;
    return raw;
  } catch {
    return provider.fallback;
  }
}

export function rentPortalSection() {
  return {
    disclosure: RENT_DISCLOSURE,
    options: PROVIDERS.map(p => ({ id: p.id, name: p.name, detail: p.detail, url: '/go/rent/' + p.id }))
  };
}

export function mountRentReporting(app, { D, db, currentUser, need }) {
  app.get('/go/rent/:provider', (req, res) => {
    const provider = PROVIDERS.find(p => p.id === req.params.provider);
    if (!provider) return res.status(404).type('text/plain').send('Unknown rent reporting service');
    const u = currentUser(req);
    // Only a signed-in client is recorded. Anyone else is still sent on, so a shared
    // link works, but anonymous hits do not create client records.
    if (u && u.role === 'client' && u.clientId) {
      const book = (D().rentReporting = D().rentReporting || { clicks: [], counts: { boom: 0, crb: 0, self: 0 } });
      book.clicks = book.clicks || [];
      book.counts = Object.assign({ boom: 0, crb: 0, self: 0 }, book.counts);
      book.counts[provider.id] = (book.counts[provider.id] || 0) + 1;
      book.clicks.unshift({ clientId: u.clientId, provider: provider.id, at: new Date().toISOString() });
      if (book.clicks.length > 5000) book.clicks.length = 5000;
      db.audit({ actor: u.email, action: 'rent.click', detail: provider.id });
      db.persistSoon();
    }
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).redirect(302, destination(provider));
  });

  app.get('/api/rent-reporting', need('owner', 'staff'), (req, res) => {
    const counts = (D().rentReporting && D().rentReporting.counts) || {};
    res.set('Cache-Control', 'no-store').json({
      disclosure: RENT_DISCLOSURE,
      providers: PROVIDERS.map(p => ({ id: p.id, name: p.name, clicks: counts[p.id] || 0 }))
    });
  });
}
