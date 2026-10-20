// The "editor": Claude writes the headline, intro and a one-line pitch per pick.
// Facts (titles, prices, links, dates) always come from the data, never from the model;
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

const SYSTEM = `You write a short weekly email for gamers who are also into tech and AI. Its job: tell them which free games and deals are actually worth their time this week.

Voice: a friend who games a lot. Direct, a little playful, no hype words ("epic", "insane", "must-have"), no emoji.

You receive this week's picks as JSON. Write:
- headline: under 60 characters, names the most interesting pick.
- intro: 2 sentences on what this week looks like.
- pickOfTheWeek: the id of the single item you'd tell a friend to grab first.
- blurbs: one line (under 20 words) for every item id, saying who it's for or why it's worth it.

Use only facts present in the JSON. Never invent prices, dates, review scores or features. If an item has a "catch", mention it plainly.`;

// Only what the model needs; keeps the request small and the facts anchored.
const compact = (picks) => ({
  free: picks.free.map(({ id, title, store, worth, endsAt, catch: c, about, platformLabel }) => ({ id, title, store, worth, endsAt, catch: c, about, platforms: platformLabel })),
  deals: picks.deals.map(({ id, title, store, price, normalPrice, savings, ratingText, metacritic }) => ({ id, title, store, price, normalPrice, savings, ratingText, metacritic })),
});

export function templateCopy(picks) {
  const top = picks.free[0] || picks.deals[0];
  return {
    headline: top ? `${top.title} is ${top.kind === 'free' ? 'free' : `$${top.price}`} this week` : 'This week in free games and deals',
    intro: `${picks.free.length} free game${picks.free.length === 1 ? '' : 's'} to claim and ${picks.deals.length} well-reviewed deal${picks.deals.length === 1 ? '' : 's'} at half price or better.`,
    pickOfTheWeek: top?.id || null,
    blurbs: {},
    source: 'template',
  };
}

export function validCopy(copy, picks) {
  const ids = new Set([...picks.free, ...picks.deals].map((i) => i.id));
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
