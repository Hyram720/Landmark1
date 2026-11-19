// Messages a held or missing client may receive. Chosen by template id.
// The server writes the text. A caller cannot supply a subject or a body.
// Templates 1 and 4 are the statutory words already stored in ledger/legal.
// Template 2 is the existing contract from croa-docs. Contract section 4 is not edited here.
import { croaDocs, personalizeCroaDocs, stampCancellationDeadline, stampContractSignedAt } from './croa-docs.js';
import { cancellationWindow, formatDeadlineDateEt } from './croa-window.js';
import { LEGAL_COMPANY_ADDRESS, LEGAL_COMPANY_NAME } from './email-footer.js';

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

export function safeLine(value, max) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s.'’,#/-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const HOMOGLYPHS = {
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0455': 's',
  '\u0410': 'a', '\u0415': 'e', '\u041e': 'o', '\u0420': 'p', '\u0421': 'c', '\u0423': 'y', '\u0425': 'x', '\u0406': 'i',
  '\u03bf': 'o', '\u039f': 'o', '\u03b1': 'a', '\u0391': 'a', '\u03b5': 'e', '\u0395': 'e'
};

function normalizeSnapshot(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u0430\u0435\u043e\u0440\u0441\u0443\u0445\u0456\u0455\u0410\u0415\u041e\u0420\u0421\u0423\u0425\u0406\u03bf\u039f\u03b1\u0391\u03b5\u0395]/g, ch => HOMOGLYPHS[ch] || ch)
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseSpacedLetters(value) {
  return String(value || '').replace(/(?:\b\p{L}\b[\s.]+){2,}\b\p{L}\b/gu, match => match.replace(/[\s.]+/g, ''));
}

export function snapshotProblem(name, address) {
  const text = normalizeSnapshot(`${name || ''} ${address || ''}`);
  const lower = text.toLowerCase();
  const warn = 'This name or address needs the owner to confirm it before a held template can be sent.';
  if (/https?:\/\/|hxxps?:\/\/|www\./i.test(text) || /\bhxxps?\b/.test(lower) || /\bdot\s*com\b/.test(lower) || /[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62})?(?:\.[\p{L}\p{N}]{2,})+/u.test(text)) {
    return warn;
  }
  if (/\bcollections\b/.test(lower) || /\bc0llections\b/.test(lower) || /\bcredit report\b/.test(lower) || /\bcredit-report\b/.test(lower) || /\bcreditreport\b/.test(lower) || /\bpaid off\b/.test(lower) || /\bwiped\b/.test(lower) || /\bnegatives\b/.test(lower) || /\berased\b/.test(lower) || /\btrans\s+union\b/.test(lower)) {
    return warn;
  }
  const flat = collapseSpacedLetters(lower.replace(/([\p{L}])\1+/gu, '$1'));
  if (/\b(experian|equifax|transunion)\b/.test(flat) || /\bdelet/.test(flat) || /\bremov/.test(flat)) return warn;
  const marks = flat.match(/\b(tu|eq|ex)\b/g) || [];
  if (marks.length >= 2) return warn;
  return '';
}

export const STATUTORY_HELD_TEMPLATES = ['disclosure-1679c', 'contract-1679d', 'signed-copies', 'cancellation-1679e'];

export function clientForHeldTemplate(client, templateId) {
  if (!client || client.mailNeedsConfirm !== true || !STATUTORY_HELD_TEMPLATES.includes(templateId)) return client;
  if ((templateId === 'contract-1679d' || templateId === 'signed-copies') && client.mailSnapshotConfirmed === true && client.mailName) {
    return Object.assign({}, client, { name: client.mailName, firstName: '', lastName: '' });
  }
  return Object.assign({}, client, { name: '', firstName: '', lastName: '', mailName: '' });
}

export function templateClient(client) {
  const c = Object.assign({}, client || {});
  const blocked = c.mailNeedsConfirm === true && c.mailSnapshotConfirmed !== true && snapshotProblem(c.mailName, c.mailAddress);
  const mailed = blocked ? '' : safeLine(c.mailAddress, 160);
  const named = blocked ? '' : safeLine(c.mailName, 80);
  c.name = named || 'Client';
  c.firstName = '';
  c.lastName = '';
  c.mailAddress = mailed;
  c.address = mailed;
  c.city = mailed ? '' : safeLine(c.city, 40);
  c.state = mailed ? '' : safeLine(c.state, 20);
  c.zip = mailed ? '' : String(c.zip || '').replace(/[^\d-]/g, '').slice(0, 10);
  if (Array.isArray(c.scheduleA)) {
    c.scheduleA = c.scheduleA.map(row => {
      if (!row || typeof row !== 'object') return row;
      return Object.assign({}, row, {
        item: safeLine(row.item, 80),
        creditor: safeLine(row.creditor || row.furnisher, 80),
        bureau: safeLine(row.bureau, 40)
      });
    });
  }
  return c;
}

export function templateCompany(company) {
  const src = company || {};
  return {
    name: safeLine(src.name, 120),
    address: safeLine(src.address, 160),
    email: safeLine(src.email, 80),
    phone: safeLine(src.phone, 30)
  };
}

function statutoryPart(text, keepBold) {
  const body = String(text || '').split(/\n---\n/)[0].trim();
  return keepBold ? body : body.replace(/\*\*/g, '');
}

function unfinished(text) {
  const stripped = String(text || '').replace(/\[date\]/gi, '').replace(/\[purchaser's signature\]/gi, '');
  return /\[[^\]]+\]/.test(stripped);
}

function weekdayFromYmd(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return '';
  const [year, month, date] = String(day).split('-').map(Number);
  return formatDeadlineDateEt(new Date(Date.UTC(year, month - 1, date, 17, 0, 0)));
}

export function statutoryDisclosure() {
  return statutoryPart(croaDocs().disclosure);
}

function cancellationSource(deadline) {
  const src = statutoryPart(croaDocs().cancellation, true);
  const name = LEGAL_COMPANY_NAME;
  const address = LEGAL_COMPANY_ADDRESS;
  const when = deadline || '[DATE: Weekday, Month D, YYYY]';
  return src
    .replace(/\[LEGAL NAME:[^\]]*\]/g, name)
    .replace(/\[ADDRESS FOR CANCELLATION NOTICES:[^\]]*\]/g, address)
    .replace(/\[DATE:[^\]]*\]/g, when);
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function statutoryCancellation(deadline) {
  return cancellationSource(deadline).replace(/\*\*/g, '');
}

export function statutoryCancellationHtml(deadline) {
  return escapeHtml(cancellationSource(deadline)).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>\n');
}

function deadlineLabel(client) {
  const o = (client && client.onboarding) || {};
  const signed = o.contractSignedAtTs || o.contractSignedAt;
  if (signed) {
    const win = cancellationWindow(signed, new Date());
    return formatDeadlineDateEt(win.deadlineInstant);
  }
  const end = String(o.cancellationWindowEndsAt || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(end)) return weekdayFromYmd(end);
  return 'the date in your Notice of Cancellation';
}

function money(n) {
  return '$' + (Math.round(Number(n) * 100) / 100).toFixed(2);
}

function safeWhen(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return weekdayFromYmd(raw);
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return formatDeadlineDateEt(new Date(parsed));
  return 'the date we received it';
}

export function renderHeldMessage(id, client, ctx) {
  const c = templateClient(client);
  const context = ctx || {};
  if (!HELD_TEMPLATE_IDS.includes(id)) return { error: 'That message is not available while this client is on hold.' };
  if (id === 'disclosure-1679c') {
    return { subject: 'Consumer Credit File Rights Under State and Federal Law', text: statutoryDisclosure() };
  }
  if (id === 'contract-1679d') {
    const docs = personalizeCroaDocs(context.docs || croaDocs(), c);
    const text = docs.contract;
    if (unfinished(text)) return { error: 'This document still has blank fields, so it cannot be sent.', subject: 'Credit Services Agreement for your signature', text };
    return { subject: 'Credit Services Agreement for your signature', text };
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
    if (sigs.some(row => row.doc === 'cancellation')) parts.push(statutoryCancellation(deadlineLabel(c)));
    const text = parts.length ? parts.join('\n\n----\n\n') : 'No signed documents are on file.';
    if (parts.length && unfinished(text)) return { error: 'This document still has blank fields, so it cannot be sent.', subject: 'Copies of the documents you signed', text };
    return { subject: 'Copies of the documents you signed', text };
  }
  if (id === 'cancellation-1679e') {
    const form = statutoryCancellation(deadlineLabel(c));
    const htmlForm = statutoryCancellationHtml(deadlineLabel(c));
    return { subject: 'Notice of Cancellation', text: form + '\n\n' + form, html: htmlForm + '<br><br>\n' + htmlForm };
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
    const when = safeWhen(o.cancellationReceivedAt || o.cancelledAt);
    let text = 'We received your cancellation. Your contract is cancelled as of ' + when + '.';
    if (o.cancellationTimely === true) text += ' The cancellation was timely.';
    if (o.cancellationTimely === false) text += ' The cancellation was late.';
    const paid = (context.invoices || []).filter(row => row && row.clientId === c.id && row.status === 'paid');
    if (o.cancellationTimely === true && paid.length) {
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
    if (!link) return { error: 'The server could not build the account link.' };
    return { subject: 'Your account', text: lines[admin] + '\n' + link };
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
