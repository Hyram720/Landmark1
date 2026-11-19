// Messages a held or missing client may receive. Chosen by template id.
// The server writes the text. A caller cannot supply a subject or a body.
// Templates 1 and 4 are the statutory words already stored in ledger/legal.
// Template 2 is the existing contract from croa-docs. Contract section 4 is not edited here.
import { croaDocs, personalizeCroaDocs, stampCancellationDeadline, stampContractSignedAt } from './croa-docs.js';
import { cancellationWindow, formatDeadlineDateEt } from './croa-window.js';

export const HELD_TEMPLATE_IDS = [
  'disclosure-1679c',
  'contract-1679d',
  'signed-copies',
  'cancellation-1679e',
  'cancel-window',
  'cancellation-confirmed',
  'account-admin',
  'postmark-review'
];

const ADMIN = new Set(['invite', 'login', 'reset', 'verify']);
const POSTMARK = new Set(['timely', 'late']);

function statutoryPart(text) {
  return String(text || '').split(/\n---\n/)[0].replace(/\*\*/g, '').trim();
}

export function statutoryDisclosure() {
  return statutoryPart(croaDocs().disclosure);
}

export function statutoryCancellation(company, deadline) {
  const src = statutoryPart(croaDocs().cancellation);
  const name = (company && company.name) || '[LEGAL NAME: Fred to confirm]';
  const address = String((company && company.address) || '[ADDRESS FOR CANCELLATION NOTICES: Fred to provide]').replace(/\n/g, ', ');
  const when = deadline || '[DATE: Weekday, Month D, YYYY]';
  return src
    .replace(/\[LEGAL NAME:[^\]]*\]/g, name)
    .replace(/\[ADDRESS FOR CANCELLATION NOTICES:[^\]]*\]/g, address)
    .replace(/\[DATE:[^\]]*\]/g, when);
}

function deadlineLabel(client) {
  const o = (client && client.onboarding) || {};
  const signed = o.contractSignedAtTs || o.contractSignedAt;
  if (signed) {
    const win = cancellationWindow(signed, new Date());
    return formatDeadlineDateEt(win.deadlineInstant);
  }
  if (o.cancellationWindowEndsAt) return String(o.cancellationWindowEndsAt);
  return 'the date in your Notice of Cancellation';
}

function money(n) {
  return '$' + (Math.round(Number(n) * 100) / 100).toFixed(2);
}

export function renderHeldMessage(id, client, ctx) {
  const c = client || {};
  const context = ctx || {};
  const company = context.company || {};
  if (!HELD_TEMPLATE_IDS.includes(id)) return { error: 'That message is not available while this client is on hold.' };
  if (id === 'disclosure-1679c') {
    return { subject: 'Consumer Credit File Rights Under State and Federal Law', text: statutoryDisclosure() };
  }
  if (id === 'contract-1679d') {
    const docs = personalizeCroaDocs(context.docs || croaDocs(), c);
    return { subject: 'Credit Services Agreement for your signature', text: docs.contract };
  }
  if (id === 'signed-copies') {
    const docs = personalizeCroaDocs(context.docs || croaDocs(), c);
    const sigs = (context.signatures || []).filter(row => row && row.clientId === c.id);
    const o = c.onboarding || {};
    const parts = [];
    if (sigs.some(row => row.doc === 'disclosure') || o.disclosureSignedAt) {
      let text = statutoryDisclosure();
      if (o.disclosureSignedAt) text = stampContractSignedAt(text, o.disclosureSignedAt);
      parts.push(text);
    }
    if (sigs.some(row => row.doc === 'contract') || o.contractSignedAt || o.contractSignedAtTs) {
      let text = docs.contract;
      const signed = o.contractSignedAtTs || o.contractSignedAt;
      if (signed) {
        text = stampContractSignedAt(text, signed);
        text = stampCancellationDeadline(text, signed);
      }
      parts.push(text);
    }
    if (o.esignConsentAt && !o.esignWithdrawnAt) parts.push(docs.esign);
    if (sigs.some(row => row.doc === 'cancellation')) parts.push(statutoryCancellation(company, deadlineLabel(c)));
    const text = parts.length ? parts.join('\n\n----\n\n') : 'No signed documents are on file.';
    return { subject: 'Copies of the documents you signed', text };
  }
  if (id === 'cancellation-1679e') {
    return { subject: 'Notice of Cancellation', text: statutoryCancellation(company, deadlineLabel(c)) };
  }
  if (id === 'cancel-window') {
    const date = deadlineLabel(c);
    return {
      subject: 'Your cancellation period',
      text: 'You may cancel without penalty or obligation until midnight on ' + date + '. We will not begin any work on your file until that period ends.'
    };
  }
  if (id === 'cancellation-confirmed') {
    const o = c.onboarding || {};
    const when = o.cancellationReceivedAt || o.cancelledAt || 'the date we received it';
    let text = 'We received your cancellation. Your contract is cancelled as of ' + when + '.';
    if (o.cancellationTimely === true) text += ' The cancellation was timely.';
    if (o.cancellationTimely === false) text += ' The cancellation was late.';
    const paid = (context.invoices || []).filter(row => row && row.clientId === c.id && row.status === 'paid');
    if (paid.length) {
      const total = paid.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      text += ' We confirm a refund of ' + money(total) + ' for a payment taken under the contract.';
    }
    return { subject: 'Cancellation confirmed', text };
  }
  if (id === 'account-admin') {
    const admin = String(context.admin || '');
    if (!ADMIN.has(admin)) return { error: 'Choose invite, login, reset, or verify.' };
    const link = context.link || '';
    const lines = {
      invite: 'You are invited to set up your portal login. This message does not include anything from your file.',
      login: 'Use this link to sign in. This message does not include anything from your file.',
      reset: 'Use this link to reset your password. This message does not include anything from your file.',
      verify: 'Use this link to confirm your email. This message does not include anything from your file.'
    };
    return { subject: 'Your account', text: lines[admin] + (link ? '\n' + link : '') };
  }
  if (id === 'postmark-review') {
    const outcome = String(context.outcome || '');
    if (!POSTMARK.has(outcome)) return { error: 'Choose timely or late.' };
    const text = outcome === 'timely'
      ? 'The postmark review is complete. The cancellation is timely.'
      : 'The postmark review is complete. The cancellation is late.';
    return { subject: 'Postmark review', text };
  }
  return { error: 'That message is not available while this client is on hold.' };
}
