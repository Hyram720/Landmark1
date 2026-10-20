// Stripe Checkout for invoice payments (one-time, per invoice). Off unless PAYMENTS_ENABLED=true
// AND a Stripe secret key is set, so deploying this code changes nothing until the owner opts in.
//
// Why one-time payments and not subscriptions: the Credit Repair Organizations Act (15 U.S.C.
// § 1679b(b)) bars charging before the service is fully performed, so Ledger bills invoices for
// work already done (see js/billing.js). Each Checkout Session pays exactly one issued invoice,
// for the amount on that invoice. Nothing here creates products, prices or recurring charges.
//
// NOTE: Stripe lists credit repair as a prohibited business (stripe.com/legal/restricted-businesses);
// get Stripe's written approval before enabling. See ledger/README.md → Stripe payments.
//
// Card data goes to Stripe's hosted Checkout page and never touches this server. The webhook is
// the source of truth for "paid"; the success page also confirms by reading the session back.
import Stripe from 'stripe';
import express from 'express';

const KEY_RE = /^(sk|rk)_(live|test)_[A-Za-z0-9_]{4,}$/;
const MAX_EVENTS = 500;

export function stripeConfig(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  const whsec = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  const keyOk = KEY_RE.test(key);
  return {
    enabled: env.PAYMENTS_ENABLED === 'true',
    keyConfigured: keyOk,
    mode: keyOk ? (key.includes('_live_') ? 'live' : 'test') : null,
    webhookConfigured: /^whsec_\S{6,}$/.test(whsec),
    currency: /^[a-z]{3}$/.test(String(env.STRIPE_CURRENCY || '')) ? env.STRIPE_CURRENCY : 'usd',
    baseUrl: String(env.APP_BASE_URL || '').trim().replace(/\/+$/, ''),
    get ready() { return this.enabled && this.keyConfigured; }
  };
}

/**
 * The webhook must see the raw request body to verify Stripe's signature, so it is mounted before
 * the app's JSON body parsers. Everything else is mounted later with mountStripeCheckout().
 */
export function createStripe({ D, db, workspace, commit, activity, uid, today, Invoices, client: injected, env = process.env }) {
  let client = injected || null;
  const cfg = () => stripeConfig(env);
  const stripe = () => {
    if (!client) client = new Stripe(String(env.STRIPE_SECRET_KEY).trim(), { maxNetworkRetries: 1, timeout: 20000 });
    return client;
  };
  const store = () => {
    const s = (D().stripe = D().stripe || {});
    s.events = s.events || []; s.subscriptions = s.subscriptions || {}; s.failures = s.failures || [];
    return s;
  };
  const cents = inv => Math.round(Number(inv.amount) * 100);
  const findInvoice = id => (workspace().invoices || []).find(i => i.id === id);
  const invoiceIdOf = obj => (obj && ((obj.metadata && obj.metadata.ledgerInvoiceId) || obj.client_reference_id)) || null;
  const task = (clientId, title) => workspace().tasks.push({ id: uid(), clientId: clientId || null, title, due: today(), done: false, createdAt: new Date().toISOString() });

  /** Marks the invoice paid if this session paid it in full. Returns true when the invoice is (now) paid. */
  function applyPaidSession(session, actor) {
    const inv = findInvoice(invoiceIdOf(session));
    if (!inv) { db.audit({ actor, action: 'stripe.session.unmatched', detail: String(session.id || '').slice(0, 80) }); db.persist(); return false; }
    if (inv.status === 'paid') return true;
    if (session.payment_status !== 'paid') return false;
    if (session.amount_total !== cents(inv) || String(session.currency || '').toLowerCase() !== cfg().currency) {
      task(inv.clientId, `Stripe payment for invoice ${Invoices.number(inv)} doesn’t match the invoice amount — check it in the Stripe dashboard before marking paid`);
      commit(actor, 'stripe.amount_mismatch', inv.id);
      return false;
    }
    Object.assign(inv, { status: 'paid', paidAt: today(), paidVia: 'Stripe', stripeSessionId: session.id, transId: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || session.id });
    activity(`Online payment received (Stripe): $${Number(inv.amount).toFixed(2)} — ${inv.description}`, inv.clientId);
    commit(actor, 'invoice.paid', `${inv.id} stripe`);
    return true;
  }

  function handleEvent(event) {
    const s = store();
    if (s.events.includes(event.id)) return 'duplicate';
    s.events.unshift(event.id);
    if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;
    const o = (event.data && event.data.object) || {};
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (!applyPaidSession(o, 'stripe') && o.payment_status !== 'paid') { db.audit({ actor: 'stripe', action: 'stripe.payment_pending', detail: String(o.id || '').slice(0, 80) }); db.persist(); }
        break;
      case 'checkout.session.async_payment_failed': {
        const inv = findInvoice(invoiceIdOf(o));
        s.failures.unshift({ at: new Date().toISOString(), type: event.type, invoiceId: inv ? inv.id : null, session: o.id || null });
        if (inv) { activity(`Stripe bank payment failed for invoice ${Invoices.number(inv)}`, inv.clientId); task(inv.clientId, `Bank payment failed for invoice ${Invoices.number(inv)} — contact the client`); commit('stripe', 'stripe.payment_failed', inv.id); }
        else { db.audit({ actor: 'stripe', action: 'stripe.payment_failed', detail: String(o.id || '').slice(0, 80) }); db.persist(); }
        break;
      }
      case 'invoice.payment_failed': {
        // Ledger never creates Stripe subscriptions or Stripe invoices; this is recorded so staff
        // notice if one was set up by hand in the Stripe dashboard.
        const clientId = (o.metadata && o.metadata.ledgerClientId) || (o.subscription_details && o.subscription_details.metadata && o.subscription_details.metadata.ledgerClientId) || null;
        s.failures.unshift({ at: new Date().toISOString(), type: event.type, stripeInvoice: o.id || null, customer: o.customer || null, amountDue: o.amount_due ?? null, clientId });
        task(clientId, `Stripe reports a failed payment (Stripe invoice ${String(o.id || '').slice(0, 40)}) — review it in the Stripe dashboard`);
        commit('stripe', 'stripe.invoice_payment_failed', String(o.id || '').slice(0, 80));
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        s.subscriptions[o.id] = { status: event.type.endsWith('deleted') ? 'canceled' : o.status, customer: o.customer || null, clientId: (o.metadata && o.metadata.ledgerClientId) || null, cancelAtPeriodEnd: !!o.cancel_at_period_end, updatedAt: new Date().toISOString() };
        db.audit({ actor: 'stripe', action: 'stripe.subscription', detail: `${o.id} ${s.subscriptions[o.id].status}` });
        db.persist();
        break;
      default:
        db.persist(); // remember the event id so retries are no-ops
        return 'ignored';
    }
    if (s.failures.length > 200) s.failures.length = 200;
    return 'ok';
  }

  function mountWebhook(app) {
    // Raw body, verified signature, mounted before any JSON parser.
    app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
      const c = cfg();
      if (!c.webhookConfigured) return res.status(503).json({ error: 'Stripe webhook is not configured (STRIPE_WEBHOOK_SECRET)' });
      let event;
      try {
        event = Stripe.webhooks.constructEvent(Buffer.isBuffer(req.body) ? req.body : Buffer.from(''), String(req.get('stripe-signature') || ''), String(env.STRIPE_WEBHOOK_SECRET).trim());
      } catch (e) {
        return res.status(400).json({ error: 'Invalid Stripe signature' });
      }
      try {
        const result = handleEvent(event);
        res.json({ received: true, result });
      } catch (e) {
        console.error('[stripe] webhook handling failed:', e.message);
        res.status(500).json({ error: 'Webhook handling failed' }); // Stripe retries
      }
    });
  }

  async function createCheckout(inv, c, { base, token }) {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: cfg().currency, unit_amount: cents(inv), product_data: { name: `Invoice ${Invoices.number(inv)}`, description: String(inv.description || 'Credit services').slice(0, 500) } } }],
      customer_email: c && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email || '') ? c.email : undefined,
      client_reference_id: inv.id,
      metadata: { ledgerInvoiceId: inv.id, ledgerClientId: inv.clientId || '' },
      payment_intent_data: { description: `Invoice ${Invoices.number(inv)}`, metadata: { ledgerInvoiceId: inv.id, ledgerClientId: inv.clientId || '' } },
      success_url: `${base}/pay/${token}/stripe/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pay/${token}`
    });
    inv.stripeSessionId = session.id;
    db.persist();
    return session;
  }

  /** Routes that use the normal parsers. ctx: need, payPage, htmlEsc, company, notPayable, findInvoiceByToken. */
  function mountCheckout(app, { need, payPage, htmlEsc, company, notPayable, findInvoiceByToken }) {
    const base = req => cfg().baseUrl || `${req.protocol}://${req.get('host')}`;
    const OFF = 'Online payments are not configured';
    const contact = () => { const co = company(); return `Please contact ${htmlEsc(co.name || 'us')}${co.phone ? ' at ' + htmlEsc(co.phone) : ''}.`; };

    app.get('/api/settings/stripe', need('owner', 'staff'), (req, res) => {
      const c = cfg();
      res.json({ enabled: c.enabled, keyConfigured: c.keyConfigured, mode: c.mode, webhookConfigured: c.webhookConfigured, ready: c.ready, currency: c.currency });
    });

    // Public pay link (the invoice token is the credential, same as /pay/:token) → Stripe Checkout.
    app.post('/pay/:token/stripe', async (req, res) => {
      if (!cfg().ready) return res.status(503).send(payPage('Payments not configured', `<h1>Online payment isn’t available</h1><p class="muted">${OFF}. ${contact()}</p>`));
      const inv = findInvoiceByToken(req.params.token);
      if (!inv || inv.status === 'void') return res.status(404).send(payPage('Invoice not found', '<h1>Invoice not found</h1>'));
      if (inv.status === 'paid') return res.redirect(303, `/pay/${req.params.token}`);
      if (notPayable(inv)) return res.status(409).send(payPage('Not payable yet', `<h1>This invoice can’t be paid online yet</h1><p class="muted">We only accept payment after the service has been completed and your cancellation period has ended. ${contact()}</p>`));
      try {
        const session = await createCheckout(inv, workspace().clients.find(x => x.id === inv.clientId), { base: base(req), token: req.params.token });
        res.redirect(303, session.url);
      } catch (e) {
        console.error('[stripe] checkout create failed:', e.message);
        res.status(502).send(payPage('Payment unavailable', '<h1>Payment is temporarily unavailable</h1><p class="muted">Please try again in a few minutes.</p>'));
      }
    });

    // Signed-in client paying one of their own invoices from the portal.
    app.post('/api/portal/invoices/:id/checkout', need('client'), async (req, res) => {
      if (!cfg().ready) return res.status(503).json({ error: OFF });
      const inv = (workspace().invoices || []).find(i => i.id === req.params.id && i.clientId === req.user.clientId);
      if (!inv || inv.status === 'void' || !inv.payToken) return res.status(404).json({ error: 'Invoice not found' });
      if (inv.status === 'paid') return res.status(409).json({ error: 'This invoice is already paid' });
      if (notPayable(inv)) return res.status(409).json({ error: 'This invoice can’t be paid yet: payment is only due after the service is completed and your cancellation period has ended.' });
      try {
        const session = await createCheckout(inv, workspace().clients.find(x => x.id === inv.clientId), { base: base(req), token: inv.payToken });
        res.json({ url: session.url });
      } catch (e) {
        console.error('[stripe] checkout create failed:', e.message);
        res.status(502).json({ error: 'Payment is temporarily unavailable. Try again in a few minutes.' });
      }
    });

    // Where Stripe sends the payer back. Confirms by reading the session; the webhook does the same.
    app.get('/pay/:token/stripe/done', async (req, res) => {
      const inv = findInvoiceByToken(req.params.token);
      if (!inv) return res.status(404).send(payPage('Invoice not found', '<h1>Invoice not found</h1>'));
      let ok = inv.status === 'paid';
      const sid = String(req.query.session_id || '');
      if (!ok && cfg().ready && /^cs_[A-Za-z0-9_]{6,200}$/.test(sid) && sid === inv.stripeSessionId) {
        try { ok = applyPaidSession(await stripe().checkout.sessions.retrieve(sid), 'payment'); } catch (e) { /* show pending */ }
      }
      res.set('Cache-Control', 'no-store').send(payPage(ok ? 'Thank you' : 'Payment pending', ok ? '<h1>Thank you!</h1><p>Your payment was received.</p>' : '<h1>Thanks — we’re confirming your payment</h1><p class="muted">If you completed the payment, it will show as paid shortly. You don’t need to pay again.</p>'));
    });
  }

  return { config: cfg, mountWebhook, mountCheckout, handleEvent };
}
