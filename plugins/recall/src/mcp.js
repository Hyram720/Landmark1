#!/usr/bin/env node
// Minimal MCP server (JSON-RPC 2.0 over newline-delimited stdio) exposing memory search.
import { realpathSync } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Store } from './db.js';
import { formatObservations, formatSearchResults, formatSessions, formatSummary } from './format.js';
import { log, projectName, redact } from './util.js';

const PROTOCOL_VERSION = '2025-06-18';
const defaultProject = projectName(process.cwd());
const projectParam = {
  type: 'string',
  description: `Project to look in. Defaults to the current project ("${defaultProject}"); use "*" for every project.`,
};

const TOOLS = [
  {
    name: 'search',
    description: 'Full-text search over past sessions: tool activity, session summaries and user prompts. Returns a compact index with #ids; fetch details with get_observations or timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for (all must match; prefixes allowed).' },
        project: projectParam,
        kind: { type: 'string', enum: ['change', 'command', 'read', 'search', 'research', 'delegate', 'plan', 'note', 'tool'], description: 'Only observations of this kind.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_observations',
    description: 'Full details for observations by #id.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 50 } },
      required: ['ids'],
    },
  },
  {
    name: 'timeline',
    description: 'What happened just before and after an observation, in time order.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Anchor observation #id.' },
        before: { type: 'integer', minimum: 0, maximum: 50, default: 5 },
        after: { type: 'integer', minimum: 0, maximum: 50, default: 5 },
      },
      required: ['id'],
    },
  },
  {
    name: 'recent_sessions',
    description: 'Most recent sessions with their summaries.',
    inputSchema: {
      type: 'object',
      properties: { project: projectParam, limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
    },
  },
  {
    name: 'session_summary',
    description: 'The stored summary of one session (accepts a full id or its first 8 characters).',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
  },
  {
    name: 'remember',
    description: 'Save a note for future sessions (a decision, convention, or fact worth keeping).',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' }, project: projectParam },
      required: ['note'],
    },
  },
];

const pickProject = p => (p === '*' ? null : p || defaultProject);

function callTool(store, name, args = {}) {
  switch (name) {
    case 'search':
      return formatSearchResults(store.search(args.query, { project: pickProject(args.project), kind: args.kind ?? null, limit: args.limit ?? 20 }));
    case 'get_observations':
      return formatObservations(store.observationsById(args.ids ?? []));
    case 'timeline':
      return formatObservations(store.timeline(args.id, args.before ?? 5, args.after ?? 5));
    case 'recent_sessions':
      return formatSessions(store.sessions(pickProject(args.project), args.limit ?? 10));
    case 'session_summary': {
      const match = store.sessions(null, 1000).find(s => s.id === args.session_id || s.id.startsWith(args.session_id ?? '\0'));
      const summary = match && store.summaryFor(match.id);
      return summary ? formatSummary(summary) : 'No summary for that session.';
    }
    case 'remember': {
      const project = pickProject(args.project) ?? defaultProject;
      const note = redact(args.note ?? '').trim();
      if (!note) throw new Error('note is empty');
      const sessionId = `manual-${new Date().toISOString().slice(0, 10)}`;
      store.touchSession(sessionId, project, process.cwd());
      const id = store.addObservation({ session_id: sessionId, project, tool: 'remember', kind: 'note', title: note.split('\n')[0].slice(0, 200), detail: note, files: [] });
      return `Saved as #${id}.`;
    }
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

export function handle(store, msg) {
  const { id, method, params } = msg;
  const reply = result => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'recall', version: '1.0.0' },
        instructions: 'Long-term memory of earlier Claude Code sessions. Search first, then fetch details by #id.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        return reply({ content: [{ type: 'text', text: callTool(store, params?.name, params?.arguments) }] });
      } catch (err) {
        if (err.code === -32602) return { jsonrpc: '2.0', id, error: { code: -32602, message: err.message } };
        return reply({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
    default:
      if (id === undefined) return null; // notification
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (isMain) {
  const store = new Store();
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    try {
      const response = handle(store, msg);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (err) {
      log('mcp error', err);
    }
  });
  rl.on('close', () => store.close());
}
