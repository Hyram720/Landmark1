// The "editor": Claude writes the headline, intro and a one-line pitch per pick.
// Facts (titles, services, dates, links) always come from the data, never from the model;
// the model only writes copy keyed by item id. Without a key, or on any failure, a template is used.
import Anthropic from '@anthropic-ai/sdk';
import config from './config.js';

const COPY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'intro', 'pickOfTheWeek', 'blurbs'],
  properties: {
    headline: { type: 'string' },
    intro: { type: 'string' },
    pickOfTheWeek: { type: 'string' },
    blurbs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'line'],
        properties: { id: { type: 'string' }, line: { type: 'string' } },
      },
    },
  },
};

const SYSTEM = `You write a short weekly email that tells people what's worth watching on the streaming services they already pay for: what's new, what's leaving soon, and what's free.

Voice: a friend with great taste in movies and TV. Direct, warm, a little witty, no hype words ("epic", "must-see", "masterpiece"), no emoji, no spoilers.

You receive this week's picks as JSON in three lists: new, leaving, free. Write:
- headline: under 60 characters, names the most interesting pick.
- intro: 2 sentences on what this week looks like.
- pickOfTheWeek: the id of the single item you'd tell a friend to watch first.
- blurbs: one line (under 20 words) for every item id, saying who it's for or why it's worth the time. For "leaving" items, give a reason to watch before it goes.

Use only facts present in the JSON. Never invent cast, plot details, awards, dates or scores beyond what is given.`;

const compact = (picks) => {
  const pick = ({ id, title, showType, year, genres, rating, overview, services }) => ({ id, title, type: showType, year, genres, rating, overview, services: services.map((s) => s.name) });
  return { new: picks.new.map(pick), leaving: picks.leaving.map((i) => ({ ...pick(i), leavingOn: i.services[0]?.date })), free: picks.free.map(pick) };
};

export function templateCopy(picks) {
  const top = picks.new[0] || picks.free[0] || picks.leaving[0];
  const where = top?.services.map((s) => s.name).join(', ');
  return {
    headline: top ? `${top.title} ${top.kind === 'leaving' ? 'is leaving' : top.kind === 'free' ? 'is free on' : 'is new on'} ${where}` : 'What to watch this week',
    intro: `${picks.new.length} new title${picks.new.length === 1 ? '' : 's'} worth your time, ${picks.leaving.length} leaving soon, and ${picks.free.length} good one${picks.free.length === 1 ? '' : 's'} you can watch for free.`,
    pickOfTheWeek: top?.id || null,
    blurbs: {},
    source: 'template',
  };
}

export function validCopy(copy, picks) {
  const ids = new Set([...picks.new, ...picks.leaving, ...picks.free].map((i) => i.id));
  if (!copy?.headline || !copy?.intro) return null;
  return {
    headline: copy.headline.slice(0, 90),
    intro: copy.intro.slice(0, 600),
    pickOfTheWeek: ids.has(copy.pickOfTheWeek) ? copy.pickOfTheWeek : null,
    blurbs: Object.fromEntries((copy.blurbs || []).filter((b) => ids.has(b.id)).map((b) => [b.id, b.line.slice(0, 200)])),
    source: 'claude',
  };
}

export async function writeCopy(picks) {
  if (!config.anthropic.apiKey) return templateCopy(picks);
  try {
    const client = new Anthropic({ apiKey: config.anthropic.apiKey });
    const response = await client.beta.messages.create({
      model: config.anthropic.model,
      max_tokens: 16000,
      // If a safety classifier declines, the API retries on a fallback model inside the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: COPY_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(compact(picks)) }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      throw new Error(`stop_reason ${response.stop_reason}`);
    }
    const text = response.content.find((b) => b.type === 'text')?.text;
    return validCopy(JSON.parse(text), picks) || templateCopy(picks);
  } catch (err) {
    console.error('[writer] falling back to template:', err.message);
    return templateCopy(picks);
  }
}
