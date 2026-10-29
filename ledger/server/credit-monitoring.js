// Optional credit-monitoring referrals. Clients are not charged by Credit Ledger.
// Each link is /go/credit/:provider, which records a signed-in client's click and redirects.
// Destinations are the approved affiliate links and can be replaced through
// LEDGER_CREDIT_MFSN_URL and LEDGER_CREDIT_SMARTCREDIT_URL.
const PROVIDERS = [
  { id: 'myfreescorenow', name: 'MyFreeScoreNow', env: 'LEDGER_CREDIT_MFSN_URL', fallback: 'https://app.myfreescorenow.com/enroll/B04C9729', detail: '3-bureau credit monitoring. $39.90 per month after a 7-day trial.' },
  { id: 'smartcredit', name: 'SmartCredit', env: 'LEDGER_CREDIT_SMARTCREDIT_URL', fallback: 'https://www.smartcredit.com/?PID=72556', detail: '3-bureau credit monitoring. Pricing is shown at sign-up.' }
];

export const CREDIT_DISCLOSURE = 'These are independent third-party services. We may earn a commission if you sign up. You do not have to use them to work with us. Prices are set by the provider and may change.';

function safeHttps(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    // Affiliate links must be https and must not carry embedded credentials.
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return '';
    return s;
  } catch {
    return '';
  }
}

function destination(provider, env = process.env) {
  return safeHttps(env[provider.env]) || provider.fallback;
}

export function creditPortalSection() {
  return {
    disclosure: CREDIT_DISCLOSURE,
    options: PROVIDERS.map(p => ({ id: p.id, name: p.name, detail: p.detail, url: '/go/credit/' + p.id }))
  };
}

export function mountCreditMonitoring(app, { D, db, currentUser, need }) {
  const emptyCounts = () => Object.fromEntries(PROVIDERS.map(p => [p.id, 0]));

  app.get('/go/credit/:provider', (req, res) => {
    const provider = PROVIDERS.find(p => p.id === req.params.provider);
    if (!provider) return res.status(404).type('text/plain').send('Unknown credit monitoring service');
    const u = currentUser(req);
    // Only a signed-in client is recorded. Anyone else is still sent on, so a shared
    // link works, but anonymous hits do not create client records.
    if (u && u.role === 'client' && u.clientId) {
      const book = (D().creditMonitoring = D().creditMonitoring || { clicks: [], counts: emptyCounts() });
      book.clicks = book.clicks || [];
      book.counts = Object.assign(emptyCounts(), book.counts);
      book.counts[provider.id] = (book.counts[provider.id] || 0) + 1;
      book.clicks.unshift({ clientId: u.clientId, provider: provider.id, at: new Date().toISOString() });
      if (book.clicks.length > 5000) book.clicks.length = 5000;
      db.audit({ actor: u.email, action: 'credit.click', detail: provider.id });
      db.persistSoon();
    }
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).redirect(302, destination(provider));
  });

  app.get('/api/credit-monitoring', need('owner', 'staff'), (req, res) => {
    const counts = (D().creditMonitoring && D().creditMonitoring.counts) || {};
    res.set('Cache-Control', 'no-store').json({
      disclosure: CREDIT_DISCLOSURE,
      providers: PROVIDERS.map(p => ({ id: p.id, name: p.name, clicks: counts[p.id] || 0 }))
    });
  });
}
