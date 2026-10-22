// Session summaries: a free heuristic one on every Stop, and an optional
// AI-compressed one (Claude API) when the session ends.
import fs from 'node:fs';
import { log, redact, truncate } from './util.js';

export function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (entry.type !== 'assistant') continue;
      const content = entry.message?.content;
      const textOut = typeof content === 'string'
        ? content
        : (content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (textOut.trim()) return textOut.trim();
    }
  } catch (err) {
    log('transcript read failed', err);
  }
  return '';
}

function changedFiles(observations) {
  return [...new Set(observations.filter(o => o.kind === 'change').flatMap(o => o.files.split('\n')).filter(Boolean))];
}

export function heuristicSummary(store, sessionId, transcriptPath) {
  const session = store.session(sessionId);
  if (!session) return null;
  const prompts = store.promptsFor(sessionId);
  const observations = store.observationsFor(sessionId);
  if (!prompts.length && !observations.length) return null;

  const first = prompts[0]?.text ?? '';
  const more = prompts.length > 1 ? ` (+${prompts.length - 1} follow-up${prompts.length > 2 ? 's' : ''}: ${truncate(prompts.at(-1).text, 160)})` : '';
  const commands = observations.filter(o => o.kind === 'command');
  const failures = commands.filter(o => o.detail.includes('(had errors)')).map(o => o.title);
  const lastPlan = observations.filter(o => o.kind === 'plan').at(-1);
  const pending = lastPlan ? lastPlan.detail.split('\n').filter(l => !l.startsWith('[completed]')) : [];

  return {
    session_id: sessionId,
    project: session.project,
    request: truncate(first, 400) + more,
    completed: redact(truncate(lastAssistantText(transcriptPath), 800)),
    learned: failures.length ? `Commands that hit errors: ${failures.slice(-5).join('; ')}` : '',
    next_steps: pending.join('\n'),
    files: changedFiles(observations),
    source: 'heuristic',
  };
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    request: { type: 'string', description: 'What the user asked for, one or two sentences.' },
    completed: { type: 'string', description: 'What was actually done and the outcome.' },
    learned: { type: 'string', description: 'Durable facts, decisions, gotchas, and conventions worth knowing next time. Empty if none.' },
    next_steps: { type: 'string', description: 'Open work or follow-ups. Empty if none.' },
  },
  required: ['request', 'completed', 'learned', 'next_steps'],
  additionalProperties: false,
};

function transcriptDigest(store, sessionId, transcriptPath) {
  const prompts = store.promptsFor(sessionId).map(p => `USER: ${truncate(p.text, 1500)}`);
  const obs = store.observationsFor(sessionId)
    .filter(o => o.kind !== 'read')
    .map(o => `#${o.id} [${o.kind}] ${o.title}${o.detail ? `\n    ${truncate(o.detail, 400).replace(/\n/g, '\n    ')}` : ''}`);
  const final = lastAssistantText(transcriptPath);
  return [
    '## User prompts', ...prompts,
    '', '## Tool activity (chronological)', ...obs.slice(-300),
    '', '## Final assistant message', truncate(final, 4000),
  ].join('\n');
}

// Returns true when an AI summary was stored.
export async function aiSummary(store, sessionId, transcriptPath) {
  if (process.env.RECALL_AI === 'off') return false;
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    log('AI summary skipped: @anthropic-ai/sdk is not installed (run npm install in the plugin folder)');
    return false;
  }
  const session = store.session(sessionId);
  if (!session) return false;
  const base = heuristicSummary(store, sessionId, transcriptPath);
  if (!base) return false;

  const client = new Anthropic();
  const model = process.env.RECALL_MODEL || 'claude-opus-5-5';
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SUMMARY_SCHEMA },
      },
      system: 'You write the memory notes a coding assistant reads at the start of its next session on the same project. Be concrete: name files, commands, decisions and outcomes. Leave out pleasantries and anything the code itself makes obvious.',
      messages: [{ role: 'user', content: `Summarize this coding session on project "${session.project}".\n\n${redact(transcriptDigest(store, sessionId, transcriptPath))}` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) log('AI summary skipped: no valid Anthropic credentials');
    else if (err instanceof Anthropic.RateLimitError) log('AI summary skipped: rate limited');
    else if (err instanceof Anthropic.APIError) log(`AI summary failed: API error ${err.status}`, err.message);
    else log('AI summary failed', err);
    return false;
  }
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    log(`AI summary not stored: stop_reason=${response.stop_reason}`);
    return false;
  }
  const block = response.content.find(b => b.type === 'text');
  let parsed;
  try {
    parsed = JSON.parse(block?.text ?? '');
  } catch {
    log('AI summary not stored: response was not valid JSON');
    return false;
  }
  return store.saveSummary({
    ...base,
    request: redact(parsed.request),
    completed: redact(parsed.completed),
    learned: redact(parsed.learned),
    next_steps: redact(parsed.next_steps),
    source: 'ai',
  });
}
