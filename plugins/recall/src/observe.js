// Turns a PostToolUse event into a compact, searchable observation.
import { redact, relPath, tail, truncate } from './util.js';

// Recall's own MCP tools are not worth remembering (and would loop).
const IGNORED_TOOLS = /^mcp__.*recall.*__/;

function text(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).join('\n');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string' || Array.isArray(value.content)) return text(value.content);
    if (typeof value.output === 'string') return value.output;
    return JSON.stringify(value);
  }
  return String(value);
}

export function toObservation(event) {
  const tool = event.tool_name || 'unknown';
  if (IGNORED_TOOLS.test(tool)) return null;
  const input = event.tool_input ?? {};
  const response = event.tool_response ?? {};
  const cwd = event.cwd;
  const file = input.file_path || input.notebook_path || input.path || '';
  const rel = file ? relPath(file, cwd) : '';

  let kind = 'tool';
  let title = tool;
  let detail = '';
  let files = rel ? [rel] : [];

  switch (tool) {
    case 'Write':
      kind = 'change';
      title = `Wrote ${rel}`;
      detail = truncate(input.content, 400);
      break;
    case 'Edit':
      kind = 'change';
      title = `Edited ${rel}`;
      detail = `- ${truncate(input.old_string, 200)}\n+ ${truncate(input.new_string, 300)}`;
      break;
    case 'MultiEdit':
      kind = 'change';
      title = `Edited ${rel} (${(input.edits ?? []).length} changes)`;
      detail = (input.edits ?? []).slice(0, 3).map(e => `+ ${truncate(e.new_string, 150)}`).join('\n');
      break;
    case 'NotebookEdit':
      kind = 'change';
      title = `Edited notebook ${rel}`;
      detail = truncate(input.new_source, 300);
      break;
    case 'Read':
      kind = 'read';
      title = `Read ${rel}`;
      break;
    case 'Bash': {
      kind = 'command';
      const cmd = String(input.command ?? '').replace(/\s+/g, ' ').trim();
      title = `Ran: ${truncate(cmd, 140)}`;
      const out = [response.stdout, response.stderr].map(text).filter(Boolean).join('\n');
      const failed = response.interrupted || /\b(error|failed|exception|not found)\b/i.test(text(response.stderr));
      detail = [input.description, failed ? '(had errors)' : '', tail(out, 600)].filter(Boolean).join('\n');
      break;
    }
    case 'Grep':
    case 'Glob':
      kind = 'search';
      title = `Searched ${tool === 'Grep' ? 'code' : 'files'} for ${truncate(input.pattern, 100)}`;
      detail = tail(text(response), 300);
      break;
    case 'WebFetch':
      kind = 'research';
      title = `Fetched ${truncate(input.url, 150)}`;
      detail = truncate(input.prompt, 200);
      break;
    case 'WebSearch':
      kind = 'research';
      title = `Web search: ${truncate(input.query, 150)}`;
      break;
    case 'Task':
    case 'Agent':
      kind = 'delegate';
      title = `Delegated: ${truncate(input.description || input.prompt, 140)}`;
      detail = truncate(text(response), 500);
      break;
    case 'TodoWrite':
      kind = 'plan';
      title = 'Updated task list';
      detail = (input.todos ?? []).map(t => `[${t.status}] ${t.content}`).join('\n');
      break;
    default:
      if (tool.startsWith('mcp__')) {
        const [, server, name] = tool.split('__');
        title = `${server}: ${name}`;
      }
      detail = truncate(JSON.stringify(input), 300);
  }

  return {
    session_id: event.session_id,
    tool,
    kind,
    title: redact(title),
    detail: redact(detail),
    files,
  };
}
