// "Ledger AI" — an expert credit repair assistant for staff, powered by Claude.
// It sees the selected client's file (tradelines, Metro 2 findings, disputes, business credit)
// and stays inside FCRA / CROA / FDCPA limits.
import Anthropic from '@anthropic-ai/sdk';
import { Law, Metro2, Business, Store } from './shared.js';
import { redact, lastFour, redactPayload, assertNoSensitive } from './redact.js';

export const MODEL = 'claude-opus-5-5';

// Kept byte-stable so it is served from the prompt cache.
const SYSTEM = `You are Ledger AI, an expert credit repair and business credit specialist working inside a credit repair company's software. You assist the company's staff, not consumers directly.

Expertise:
- Metro 2 reporting format (CDIA CRRG): account status codes, payment rating, the 24-month payment history profile, DOFD, compliance condition codes (XB etc.), ECOA codes, consumer information indicators, and how these fields must agree with each other.
- FCRA: § 611 reinvestigations (30 days, up to 45), § 623 furnisher duties and direct disputes under Reg V § 1022.43, § 605 obsolescence (7 years from DOFD + 180 days; bankruptcy 10 years), § 609 disclosures, § 611(a)(7) method-of-verification requests, § 611(a)(5)(B) reinsertion notices.
- FDCPA § 809 / Regulation F debt validation.
- CROA: the § 1679c disclosure, written contract, 3-business-day cancellation, no fees before services are fully performed, prohibited misrepresentations. Telemarketing Sales Rule advance-fee rules.
- Business credit: D&B PAYDEX, Experian Intelliscore Plus and FSR, Equifax business scores, FICO SBSS, the fundability foundation (entity, EIN, consistent name/address, phone listing, domain email, bank account, D-U-N-S, NAICS), vendor/net-30 tradelines, and business bureau correction processes (business files are not covered by the FCRA).
- Credit building: secured cards, credit-builder accounts, authorized-user strategy, utilization, rent and utility reporting.

How you work:
- Ground answers in the client file you are given. Name the specific tradeline, bureau, field and value.
- Distinguish clearly between (a) data that is provably inconsistent or obsolete, (b) items the consumer says are inaccurate and needs to document, and (c) accurate negative information. Accurate, current, verifiable information cannot be removed by disputing it; for (c) recommend goodwill requests, pay-for-update negotiations, rebuilding, or waiting for the reporting period to end.
- Never recommend disputing information the consumer has not said is inaccurate, mass or template disputes, "Metro 2 technicality" deletion claims, repeat disputes without new information (frivolous under § 611(a)(3)), CPNs or EINs used in place of an SSN, or any untrue statement to a bureau or creditor. If staff ask for one of these, explain the risk and give the lawful alternative.
- Identity theft disputes are out of scope for this company. Do not draft identity-theft, fraud-block or 'account isn't mine' letters or workflows; decline and refer the client to IdentityTheft.gov.
- Never promise results or score increases.
- When you draft letters or client messages, write them in plain English, specific to the item, in the consumer's voice for disputes, and mark anything the consumer must confirm or supply with [brackets].
- Point out CROA problems you notice in the file (missing disclosure, work or billing inside the cancellation window).
- Be concise and practical: lead with the answer, then steps. Use short headings and bullets when they help. You are not a lawyer; flag questions that need an attorney.`;

function clientContext(ws, clientId, opts = {}) {
  const c = ws.clients.find(x => x.id === clientId);
  if (!c) return null;
  const cs = Store.croaStatus(c);
  // Privacy: no name, contact details, street address, DOB or SSN; account numbers last 4 only; free text redacted.
  const lines = [`CLIENT FILE — client ${opts.withIds ? c.id : ''} (${c.kind || 'personal'} client, status ${c.status})`];
  lines.push(`Location: ${[c.city, c.state].filter(Boolean).join(', ') || 'unknown'}. Notes: ${c.notes ? redact(c.notes) : 'none'}`);
  if (cs.required) lines.push(`CROA: disclosure ${c.onboarding?.disclosureSignedAt || 'NOT recorded'}, contract ${c.onboarding?.contractSignedAt || 'NOT signed'}, cancellation deadline ${cs.deadline || 'n/a'}, cleared for services: ${cs.cleared ? 'yes' : 'NO'}${cs.cancelled ? ', CANCELLED' : ''}`);
  const byBureau = {};
  ws.reports.filter(r => r.clientId === c.id).sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach(r => { if (!byBureau[r.bureau]) byBureau[r.bureau] = r; });
  const latest = Object.values(byBureau);
  latest.forEach(r => {
    lines.push(`\n${r.bureau} report dated ${r.date} (source: ${r.source || 'n/a'})${r.scores?.[r.bureau] ? `, score ${r.scores[r.bureau]}` : ''}:`);
    r.accounts.forEach(a => lines.push(`- ${opts.withIds ? `[id=${a.id}] ` : ''}${redact(a.creditor)} ${lastFour(a.accountNumber)} | type ${a.type || '?'} | status ${a.status} (${Metro2.ACCOUNT_STATUS[a.status] || 'unknown'}) | bal ${a.balance} | past due ${a.pastDue} | limit ${a.limit} | high ${a.highCredit} | opened ${a.opened || '?'} | closed ${a.closed || '-'} | DOFD ${a.dofd || '-'} | last pay ${a.lastPayment || '-'} | ECOA ${a.ecoa || '?'} | CCC ${a.complianceCode || '-'} | CII ${a.cii || '-'} | history ${a.paymentHistory || '-'}${a.originalCreditor ? ` | original creditor ${redact(a.originalCreditor)}` : ''}${a.issue ? ` | CONSUMER SAYS: ${redact(a.issue)}` : ''}${a.evidence ? ` | evidence: ${redact(a.evidence)}` : ''}${a.consumerDisputed ? ' | disputed' : ''}`));
    const findings = Metro2.auditReport(r);
    if (findings.length) {
      lines.push(`  Automated Metro 2 findings for ${r.bureau}:`);
      findings.forEach(f => lines.push(`  * [${f.severity}] ${redact(f.creditor)}: ${f.title} — ${redact(f.detail)}`));
    }
  });
  const cmp = Metro2.compareBureaus(latest).filter(g => g.differences.length);
  if (cmp.length) {
    lines.push('\nCross-bureau differences:');
    cmp.forEach(g => lines.push(`- ${g.creditor}: ` + g.differences.map(d => `${d.label} ${Object.entries(d.values).map(([b, v]) => `${b}=${v || '—'}`).join(', ')}`).join('; ')));
  }
  const ds = ws.disputes.filter(d => d.clientId === c.id);
  if (ds.length) {
    lines.push('\nDisputes:');
    ds.forEach(d => lines.push(`- Round ${d.round} ${Law.DISPUTE_TYPES[d.type]?.label || d.type} to ${d.recipient}: ${d.outcome || d.status}${d.sentAt ? `, mailed ${d.sentAt}` : ''}${d.dueAt ? `, due ${d.dueAt}` : ''}. Items: ${d.items.map(i => `${redact(i.creditor)}${i.bureau ? ' @' + i.bureau : ''} (${redact(i.discrepancy)})${i.result ? ' → ' + i.result.toUpperCase() : ''}`).join('; ')}`));
  }
  if (c.kind !== 'personal') {
    const b = c.business || {};
    const fz = Business.fundability(c);
    lines.push(`\nBUSINESS: (name withheld) (${b.entityType || 'entity ?'}, formed ${b.formedOn || '?'}, state ${b.stateOfFormation || '?'}, NAICS ${b.naics || '?'}, D-U-N-S ${b.duns ? 'yes' : 'no'})`);
    lines.push(`Fundability foundation ${fz.done}/${fz.total}. Missing: ${Business.FOUNDATION.filter(f => !(c.businessChecklist || {})[f.key]).map(f => f.label).join('; ') || 'none'}`);
    (c.businessScores || []).forEach(s => lines.push(`- Score ${s.model} = ${s.score} on ${s.date}`));
    (c.vendorAccounts || []).forEach(v => lines.push(`- Vendor ${redact(v.vendor)}: ${redact(v.terms || '')}, limit ${v.limit || '?'}, ${v.status}, reports to ${v.reportsTo || '?'}`));
  }
  return redact(lines.join('\n'));
}

// The key comes from ANTHROPIC_API_KEY or, if unset, from the owner's Settings (stored encrypted).
let keyProvider = () => '';
let client = null, clientKey = null;
export function setKeyProvider(fn) { keyProvider = fn; }
export function currentKey(env = process.env) { return env.ANTHROPIC_API_KEY || keyProvider() || ''; }
export function assistantConfigured(env = process.env) { return Boolean(currentKey(env)); }
let anthropicFactory = key => new Anthropic({ apiKey: key });
/** Tests only: replace the SDK client (e.g. with a mock that records requests). */
export function setAnthropicFactory(fn) { anthropicFactory = fn || (key => new Anthropic({ apiKey: key })); client = null; }
/**
 * Every Anthropic request goes through this wrapper: redactPayload() masks identifiers in the
 * messages and system prompt, then assertNoSensitive() refuses to send if an SSN or a Luhn-valid
 * card number is still in the exact request body.
 */
function safeClient(raw) {
  const prep = p => assertNoSensitive(redactPayload(p));
  return {
    beta: { messages: {
      create: p => raw.beta.messages.create(prep(p)),
      stream: p => raw.beta.messages.stream(prep(p))
    } },
    messages: {
      create: p => raw.messages.create(prep(p)),
      stream: p => raw.messages.stream(prep(p))
    }
  };
}
export function getClient() {
  const key = currentKey();
  if (!client || clientKey !== key) { client = safeClient(anthropicFactory(key)); clientKey = key; }
  return client;
}
/** Checks a key with a cheap Models API call. Returns 'ok', 'invalid' or 'unreachable'. */
export async function checkKey(key) {
  try { await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15000 }).models.retrieve(MODEL); return 'ok'; }
  catch (e) { return e.status === 401 || e.status === 403 ? 'invalid' : 'unreachable'; }
}

/**
 * history: [{ role: 'user'|'assistant', content: string }], newest last.
 * Returns { text, model }.
 */
export async function askAssistant({ ws, clientId, history }) {
  const ctx = clientId ? clientContext(ws, clientId) : null;
  const msgs = history.slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 20000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new Error('Ask a question first');
  if (ctx) msgs[0] = { role: 'user', content: `<client_file>\n${ctx}\n</client_file>\n\n${msgs[0].content}` };
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: msgs
  });
  if (response.stop_reason === 'refusal') return { text: 'I can’t help with that request. Try rephrasing it around a specific, lawful step for this client.', model: response.model };
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { text: text || '(No answer returned — try again.)', model: response.model, truncated: response.stop_reason === 'max_tokens' };
}

export { clientContext, SYSTEM };
