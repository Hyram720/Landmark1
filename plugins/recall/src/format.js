// Text renderings shared by the MCP server and the CLI.
import { formatTime, truncate } from './util.js';

export function formatSearchResults(results) {
  if (!results.length) return 'No matches.';
  return results.map(r => {
    const when = formatTime(r.created_at);
    if (r.type === 'observation') return `#${r.id} ${when} [${r.kind}] ${truncate(r.title, 160)} (${r.project})`;
    if (r.type === 'session') return `session ${r.session_id.slice(0, 8)} ${when} summary: ${truncate(r.title, 160)} (${r.project})`;
    return `prompt ${when} session ${r.session_id.slice(0, 8)}: ${truncate(r.title, 160)} (${r.project})`;
  }).join('\n');
}

export function formatObservations(rows) {
  if (!rows.length) return 'No observations.';
  return rows.map(o => [
    `#${o.id} ${formatTime(o.created_at)} [${o.kind}] ${o.title}`,
    `  project: ${o.project} · session: ${o.session_id.slice(0, 8)} · tool: ${o.tool}`,
    o.files ? `  files: ${o.files.split('\n').join(', ')}` : '',
    o.detail ? o.detail.split('\n').map(l => `  | ${l}`).join('\n') : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

export function formatSessions(rows) {
  if (!rows.length) return 'No sessions.';
  return rows.map(s => [
    `session ${s.id} · ${s.project} · ${formatTime(s.started_at)} → ${formatTime(s.updated_at)} · ${s.prompt_count} prompts, ${s.observation_count} observations${s.source === 'ai' ? ' · AI summary' : ''}`,
    s.request ? `  asked: ${truncate(s.request, 300)}` : '',
    s.completed ? `  done: ${truncate(s.completed, 400).replace(/\n+/g, ' ')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

export function formatSummary(s) {
  return [
    `session ${s.session_id} · ${s.project} · ${formatTime(s.updated_at)} (${s.source})`,
    `Asked: ${s.request}`,
    `Done: ${s.completed}`,
    s.learned ? `Learned: ${s.learned}` : '',
    s.next_steps ? `Next: ${s.next_steps}` : '',
    s.files ? `Files: ${s.files.split('\n').join(', ')}` : '',
  ].filter(Boolean).join('\n');
}
