// AI report scanning and dispute-round planning with Claude structured outputs.
import Anthropic from '@anthropic-ai/sdk';
import { Law, AIPrompts } from './shared.js';

const { REPORT_SCHEMA, SCAN_PROMPT, SCAN_SYSTEM, htmlToText } = AIPrompts;
import { MODEL, clientContext } from './assistant.js';

let client;
const api = () => (client = client || new Anthropic());
const str = { type: 'string' };

async function structured({ content, schema, system, maxTokens }) {
  const stream = api().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens || 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }]
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this request.'), { status: 400 });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('The report is too long to scan in one pass. Split it by bureau and scan each part.'), { status: 400 });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

/** Reads a credit report file (PDF, HTML, text) and returns tradelines per bureau. Nothing is saved. */
export async function scanReport({ buffer, mime }) {
  let content;
  if (mime === 'application/pdf') {
    content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }, { type: 'text', text: SCAN_PROMPT }];
  } else if (/^image\//.test(mime)) {
    content = [{ type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } }, { type: 'text', text: SCAN_PROMPT }];
  } else {
    const raw = buffer.toString('utf8');
    const text = mime === 'text/html' ? htmlToText(raw) : raw;
    content = `<credit_report>\n${text}\n</credit_report>\n\n${SCAN_PROMPT}`;
  }
  return structured({ content, schema: REPORT_SCHEMA, system: SCAN_SYSTEM });
}

const LETTER_TYPES = Object.keys(Law.DISPUTE_TYPES);
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: str,
    letters: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        letterType: { type: 'string', enum: LETTER_TYPES },
        recipient: str,
        recipientType: { type: 'string', enum: ['bureau', 'furnisher', 'collector', 'regulator'] },
        strategyStep: { type: 'integer', enum: [1, 2, 3] },
        items: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: { accountId: str, creditor: str, accountNumber: str, bureau: str, discrepancy: str, requested: str, evidenceNeeded: str, needsClientConfirmation: { type: 'boolean' } },
          required: ['accountId', 'creditor', 'accountNumber', 'bureau', 'discrepancy', 'requested', 'evidenceNeeded', 'needsClientConfirmation']
        } },
        why: str
      },
      required: ['letterType', 'recipient', 'recipientType', 'strategyStep', 'items', 'why']
    } },
    doNotDispute: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { creditor: str, reason: str, alternative: str }, required: ['creditor', 'reason', 'alternative'] } },
    clientMessage: str
  },
  required: ['summary', 'letters', 'doNotDispute', 'clientMessage']
};

const PLAN_PROMPT = `Plan this client's next dispute round using the strategy ladder:
- Letter 1: dispute with the bureau (cra_611), or obsolete_605 for items past the reporting period, block_605b only for documented identity theft, validation_809 to a collector within the validation period.
- Letter 2: after a verified result or no response — mov_611a7 to the bureau and furnisher_623 directly to the furnisher, with new evidence.
- Letter 3: still verified — furnisher_final to the furnisher, and cfpb_complaint (a narrative the client files).
Rules:
- Only include items that are provably inconsistent or obsolete in the data, or that the consumer has said are inaccurate. Set needsClientConfirmation true unless the consumer already stated the issue.
- Put accurate negative items in doNotDispute with a lawful alternative (goodwill, pay-for-delete negotiation with a collector, rebuilding, waiting for the purge date).
- Do not repeat a dispute already verified by the same recipient without moving up the ladder or adding new evidence. Skip items already deleted or corrected, and disputes still awaiting a response.
- Group items into one letter per recipient and letter type. For bureau letters, recipient is exactly Equifax, Experian or TransUnion. For furnisher letters, use the furnisher's name.
- accountId must be the id shown in the client file for that bureau's tradeline ("" if none).
- discrepancy: one or two specific sentences naming the field and value that is wrong and why, in the consumer's voice.
- If the client is not cleared under CROA, still plan, but say in summary that nothing can be sent yet.
- clientMessage: a short, plain update for the client about the plan and what they need to provide. No promises of results.`;

/** Proposes the next round of letters for a client. Nothing is saved. */
export async function planRound({ ws, clientId }) {
  const ctx = clientContext(ws, clientId, { withIds: true });
  if (!ctx) throw Object.assign(new Error('Client not found'), { status: 404 });
  const { SYSTEM } = await import('./assistant.js');
  return structured({ content: `<client_file>\n${ctx}\n</client_file>\n\n${PLAN_PROMPT}`, schema: PLAN_SCHEMA, system: SYSTEM, maxTokens: 32000 });
}

export { htmlToText };
