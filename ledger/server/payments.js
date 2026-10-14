// Card and bank (eCheck) payments through Authorize.net Accept Hosted: the client pays on
// Authorize.net's own secure page, so card numbers never touch this server (PCI scope stays small).
const ENDPOINT = { live: 'https://api.authorize.net/xml/v1/request.api', sandbox: 'https://apitest.authorize.net/xml/v1/request.api' };
export const PAY_PAGE = { live: 'https://accept.authorize.net/payment/payment', sandbox: 'https://test.authorize.net/payment/payment' };

async function call(cfg, name, payload) {
  const body = { [name]: Object.assign({ merchantAuthentication: { name: cfg.loginId, transactionKey: cfg.transactionKey } }, payload) };
  const r = await fetch(cfg.sandbox ? ENDPOINT.sandbox : ENDPOINT.live, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = (await r.text()).replace(/^﻿/, ''); // Authorize.net prefixes JSON with a BOM
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Unexpected response from Authorize.net'); }
  if (!data.messages || data.messages.resultCode !== 'Ok') {
    const m = (data.messages && data.messages.message && data.messages.message[0]) || {};
    const e = new Error(m.text || 'Authorize.net request failed');
    e.code = m.code;
    throw e;
  }
  return data;
}

/** 'ok' | 'invalid' | 'unknown' */
export async function checkCredentials(cfg) {
  try { await call(cfg, 'authenticateTestRequest', {}); return 'ok'; } catch (e) { return e.code === 'E00007' || e.code === 'E00124' ? 'invalid' : 'unknown'; }
}

/** Authorize.net invoice numbers are limited to 20 characters. */
export const invoiceNumber = id => String(id).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);

/** Returns a form token for the hosted payment page (valid 15 minutes). */
export async function hostedPaymentToken(cfg, { invoice, client, returnUrl, cancelUrl, companyName }) {
  const data = await call(cfg, 'getHostedPaymentPageRequest', {
    transactionRequest: {
      transactionType: 'authCaptureTransaction',
      amount: Number(invoice.amount).toFixed(2),
      order: { invoiceNumber: invoiceNumber(invoice.id), description: String(invoice.description || 'Credit services').slice(0, 255) },
      customer: client.email ? { email: client.email } : undefined,
      billTo: { firstName: (client.firstName || '').slice(0, 50), lastName: (client.lastName || '').slice(0, 50) }
    },
    hostedPaymentSettings: {
      setting: [
        { settingName: 'hostedPaymentReturnOptions', settingValue: JSON.stringify({ showReceipt: true, url: returnUrl, urlText: 'Back to ' + (companyName || 'our site').slice(0, 40), cancelUrl, cancelUrlText: 'Cancel' }) },
        { settingName: 'hostedPaymentButtonOptions', settingValue: JSON.stringify({ text: 'Pay ' + '$' + Number(invoice.amount).toFixed(2) }) },
        { settingName: 'hostedPaymentOrderOptions', settingValue: JSON.stringify({ show: true, merchantName: (companyName || '').slice(0, 60) }) },
        { settingName: 'hostedPaymentPaymentOptions', settingValue: JSON.stringify({ cardCodeRequired: true, showCreditCard: true, showBankAccount: true }) }
      ]
    }
  });
  return data.token;
}

/** Looks for a successful transaction for this invoice among recent (unsettled and today's) transactions. */
export async function findPayment(cfg, invoice) {
  const num = invoiceNumber(invoice.id);
  const ok = ['capturedPendingSettlement', 'settledSuccessfully', 'authorizedPendingCapture', 'FDSPendingReview'];
  const data = await call(cfg, 'getUnsettledTransactionListRequest', { sorting: { orderBy: 'submitTimeUTC', orderDescending: true }, paging: { limit: 1000, offset: 1 } });
  const list = data.transactions || [];
  const hit = list.find(t => t.invoiceNumber === num && ok.includes(t.transactionStatus) && Math.abs(Number(t.settleAmount) - Number(invoice.amount)) < 0.005);
  return hit ? { transId: hit.transId, status: hit.transactionStatus, amount: Number(hit.settleAmount), at: hit.submitTimeUTC } : null;
}
