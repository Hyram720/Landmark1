// MCP tool definitions and the JSON-RPC handler shared by the stdio and HTTP servers.
import { formatFeed, formatObservations, formatSearchResults, formatSessions, formatSummary, formatTasks } from './format.js';
import { formatTime, redact, truncate } from './util.js';

const PROTOCOL_VERSION = '2025-06-18';
const STATUSES = ['open', 'in_progress', 'waiting_on_user', 'blocked', 'review', 'done'];

const agentParam = {
  type: 'string',
  description: 'Who you are, in lowercase: "claude", "chatgpt", "grok", or another short name. Every write is signed with it so the others know who did what.',
};
const projectParam = {
  type: 'string',
  description: 'Project name (see list_projects). Defaults to the most recently active project; use "*" to look across all projects.',
};

export const TOOLS = [
  {
    name: 'project_brief',
    description: 'Start here. Catch up on a project in one call: the shared goal, open tasks and who leads each, recent session summaries, and the latest activity from every assistant.',
    inputSchema: { type: 'object', properties: { project: projectParam } },
  },
  {
    name: 'whats_new',
    description: 'Everything recorded after a given #id, oldest first, from every assistant. Pass the highest #id you saw last time to get only new items.',
    inputSchema: {
      type: 'object',
      properties: {
        since_id: { type: 'integer', minimum: 0, default: 0 },
        project: projectParam,
        agent: { type: 'string', description: 'Only items by this assistant.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: 'post_update',
    description: 'Tell the other assistants something: progress, a question, a proposal, a decision, or a handoff. Use kind "handoff" with "to" when you want another assistant to pick something up.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: agentParam,
        text: { type: 'string', description: 'The update. Be concrete: what changed, where, and what is next.' },
        kind: { type: 'string', enum: ['update', 'question', 'proposal', 'decision', 'handoff'], default: 'update' },
        to: { type: 'string', description: 'Optional: the assistant this is addressed to.' },
        task_id: { type: 'integer', description: 'Optional: the task this is about.' },
        project: projectParam,
      },
      required: ['agent', 'text'],
    },
  },
  {
    name: 'set_goal',
    description: 'Set or replace the shared goal everyone is working toward on this project.',
    inputSchema: {
      type: 'object',
      properties: { agent: agentParam, goal: { type: 'string' }, project: projectParam },
      required: ['agent', 'goal'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Tasks on the shared board with status and lead.',
    inputSchema: {
      type: 'object',
      properties: { project: projectParam, include_done: { type: 'boolean', default: false } },
    },
  },
  {
    name: 'create_task',
    description: 'Add a task to the shared board. Set lead to an assistant name to assign it right away, or leave it empty so someone can claim it.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: agentParam,
        title: { type: 'string' },
        details: { type: 'string' },
        lead: { type: 'string', description: 'Optional: who leads it.' },
        project: projectParam,
      },
      required: ['agent', 'title'],
    },
  },
  {
    name: 'claim_task',
    description: 'Take the lead on a task. Taking over a task someone else leads needs a reason, which is shown to everyone.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: agentParam,
        task_id: { type: 'integer' },
        reason: { type: 'string', description: 'Why you should lead it (required when it already has a different lead).' },
      },
      required: ['agent', 'task_id'],
    },
  },
  {
    name: 'update_task',
    description: 'Change a task\'s status, hand its lead to another assistant, and/or add a progress note. Leave a checkpoint note whenever you stop (what is done, the exact next step, and any file, link or decision needed) so another assistant can pick up exactly where you left off. Use status "waiting_on_user" when the user must do or decide something, and say what in the note.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: agentParam,
        task_id: { type: 'integer' },
        status: { type: 'string', enum: STATUSES },
        lead: { type: 'string', description: 'New lead; use "none" to release it.' },
        note: { type: 'string' },
      },
      required: ['agent', 'task_id'],
    },
  },
  {
    name: 'search',
    description: 'Full-text search over everything: session activity, updates, tasks notes, summaries and prompts. Returns a compact list with #ids; use fetch or get_observations for details.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for (all must match; prefixes allowed).' },
        project: projectParam,
        kind: { type: 'string', description: 'Only this kind, e.g. change, command, update, decision, handoff, task, note.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch',
    description: 'Full content of one item: an observation ("42" or "#42"), a task ("task-3"), or a session ("session-<id>").',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
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
    description: 'Most recent Claude Code sessions with their summaries.',
    inputSchema: {
      type: 'object',
      properties: { project: projectParam, limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
    },
  },
  {
    name: 'remember',
    description: 'Save a lasting note (a decision, convention, or fact) for everyone.',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' }, agent: agentParam, project: projectParam },
      required: ['note'],
    },
  },
  {
    name: 'list_projects',
    description: 'Projects in the shared memory and when each was last active.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// Hints MCP clients use to tell reading tools from writing tools (ChatGPT Pro only enables read-only ones).
const READ_ONLY = new Set(['project_brief', 'whats_new', 'list_tasks', 'search', 'fetch', 'get_observations', 'timeline', 'recent_sessions', 'list_projects']);
for (const tool of TOOLS) {
  tool.annotations = READ_ONLY.has(tool.name)
    ? { readOnlyHint: true, openWorldHint: false }
    : { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
}

const cleanAgent = a => String(a ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 40) || 'unknown';
const required = (v, name) => {
  const s = redact(String(v ?? '')).trim();
  if (!s) throw new Error(`${name} is required`);
  return s;
};

function note(store, { agent, project, kind, title, detail = '' }) {
  const day = new Date().toISOString().slice(0, 10);
  const sessionId = `${agent}-${day}`;
  store.touchSession(sessionId, project, null);
  return store.addObservation({ session_id: sessionId, project, agent, tool: agent, kind, title: truncate(title, 300), detail, files: [] });
}

export function callTool(store, name, args = {}, ctx = {}) {
  const fallback = ctx.defaultProject ?? store.lastActiveProject() ?? 'default';
  const readProject = p => (p === '*' ? null : p || fallback);
  const writeProject = p => (p && p !== '*' ? p : fallback);

  switch (name) {
    case 'project_brief': {
      const project = readProject(args.project);
      if (!project) return formatProjects(store);
      const goal = store.goal(project);
      const feed = store.feed({ project, limit: 25 });
      const tasks = store.tasks(project);
      const notes = latestTaskNotes(store, project);
      const withNote = t => {
        const n = notes.get(t.id);
        return `${formatTasks([t])}${n ? `\n    last note (${n.agent}, ${formatTime(n.created_at)}): ${truncate(n.detail || n.title, 400).replace(/\n/g, '\n    ')}` : ''}`;
      };
      const section = (title, rows, empty) => ['', `## ${title}`, rows.length ? rows.map(withNote).join('\n') : empty];
      const done = store.tasks(project, { includeDone: true }).filter(t => t.status === 'done').slice(0, 5);
      return [
        `# ${project}`,
        `Goal: ${goal?.goal ? `${goal.goal} (set by ${goal.updated_by}, ${formatTime(goal.updated_at)})` : 'not set yet. Use set_goal.'}`,
        ...section('Waiting on the user', tasks.filter(t => t.status === 'waiting_on_user'), 'Nothing.'),
        ...section('In progress (with where each one left off)', tasks.filter(t => ['in_progress', 'review', 'blocked'].includes(t.status)), 'Nothing.'),
        ...section('Not started', tasks.filter(t => t.status === 'open'), 'Nothing.'),
        ...section('Recently done', done, 'Nothing yet.'),
        '', '## Recent Claude Code sessions', store.recentSummaries(project, 3).map(formatSummary).join('\n\n') || 'None yet.',
        '', '## Latest activity', formatFeed(feed),
        '', 'To pick up another assistant\'s task: fetch task-<id> for its full history, claim_task with a reason, then continue from its last note.',
        feed.length ? `Call whats_new with since_id ${feed.at(-1).id} next time to see only newer items.` : '',
      ].join('\n');
    }
    case 'whats_new':
      return formatFeed(store.feed({ project: readProject(args.project), sinceId: args.since_id ?? 0, agent: args.agent ? cleanAgent(args.agent) : null, limit: args.limit ?? 50 }));
    case 'post_update': {
      const agent = cleanAgent(args.agent);
      const kind = ['update', 'question', 'proposal', 'decision', 'handoff'].includes(args.kind) ? args.kind : 'update';
      const text = required(args.text, 'text');
      const to = args.to ? cleanAgent(args.to) : null;
      const project = writeProject(args.project);
      const prefix = [to ? `→ ${to}` : '', args.task_id ? `task #${args.task_id}` : ''].filter(Boolean).join(' · ');
      const id = note(store, { agent, project, kind, title: `${prefix ? `${prefix}: ` : ''}${text.split('\n')[0]}`, detail: text });
      return `Posted #${id} to ${project}.`;
    }
    case 'set_goal': {
      const agent = cleanAgent(args.agent);
      const project = writeProject(args.project);
      const goal = required(args.goal, 'goal');
      store.setGoal(project, goal, agent);
      note(store, { agent, project, kind: 'decision', title: `Set the goal: ${goal.split('\n')[0]}`, detail: goal });
      return `Goal for ${project} saved.`;
    }
    case 'list_tasks':
      return formatTasks(store.tasks(readProject(args.project), { includeDone: !!args.include_done }));
    case 'create_task': {
      const agent = cleanAgent(args.agent);
      const project = writeProject(args.project);
      const title = required(args.title, 'title');
      const lead = args.lead ? cleanAgent(args.lead) : null;
      const id = store.createTask({ project, title, details: redact(args.details ?? ''), lead, created_by: agent });
      note(store, { agent, project, kind: 'task', title: `Created task #${id}: ${title}${lead ? ` (lead: ${lead})` : ''}`, detail: redact(args.details ?? '') });
      return `Created task #${id} in ${project}${lead ? `, led by ${lead}` : ''}.`;
    }
    case 'claim_task': {
      const agent = cleanAgent(args.agent);
      const task = store.task(args.task_id);
      if (!task) throw new Error(`No task #${args.task_id}`);
      if (task.lead === agent) return `You already lead task #${task.id}.`;
      if (task.lead && !String(args.reason ?? '').trim()) {
        return `Task #${task.id} is led by ${task.lead}. To take over, call claim_task again with a reason, or post_update to ${task.lead} to agree first.`;
      }
      store.updateTask(task.id, { lead: agent, status: task.status === 'open' ? 'in_progress' : task.status });
      const reason = redact(args.reason ?? '');
      note(store, { agent, project: task.project, kind: 'task', title: `${task.lead ? `Took over task #${task.id} from ${task.lead}` : `Took the lead on task #${task.id}`}: ${task.title}`, detail: reason });
      return `You now lead task #${task.id}: ${task.title}.`;
    }
    case 'update_task': {
      const agent = cleanAgent(args.agent);
      const task = store.task(args.task_id);
      if (!task) throw new Error(`No task #${args.task_id}`);
      if (args.status && !STATUSES.includes(args.status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
      const lead = args.lead === undefined ? undefined : args.lead === 'none' ? null : cleanAgent(args.lead);
      const updated = store.updateTask(task.id, { status: args.status, lead });
      const changes = [
        args.status && args.status !== task.status ? `${task.status} → ${args.status}` : '',
        lead !== undefined && lead !== task.lead ? `lead ${task.lead ?? 'none'} → ${lead ?? 'none'}` : '',
      ].filter(Boolean).join(', ');
      const text = redact(args.note ?? '');
      note(store, { agent, project: task.project, kind: 'task', title: `Task #${task.id}${changes ? ` (${changes})` : ''}: ${text ? text.split('\n')[0] : task.title}`, detail: text });
      return `Task #${updated.id} is ${updated.status}, lead: ${updated.lead ?? 'none'}.`;
    }
    case 'search':
      return formatSearchResults(store.search(args.query, { project: readProject(args.project), kind: args.kind ?? null, limit: args.limit ?? 20 }));
    case 'fetch': {
      const id = String(args.id ?? '').trim();
      if (/^task-\d+$/.test(id)) {
        const t = store.task(Number(id.slice(5)));
        if (!t) return 'Not found.';
        const history = store.search(`task ${t.id}`, { project: t.project, limit: 100 })
          .filter(r => r.type === 'observation' && new RegExp(`#${t.id}\\b`).test(r.title));
        return `${formatTasks([t])}\n${t.details ? `\n${t.details}\n` : ''}\nHistory:\n${formatSearchResults(history.sort((a, b) => a.id - b.id))}`;
      }
      if (id.startsWith('session-')) {
        const s = store.summaryFor(id.slice(8));
        return s ? formatSummary(s) : 'Not found.';
      }
      return formatObservations(store.observationsById([id.replace('#', '')]));
    }
    case 'get_observations':
      return formatObservations(store.observationsById(args.ids ?? []));
    case 'timeline':
      return formatObservations(store.timeline(args.id, args.before ?? 5, args.after ?? 5));
    case 'recent_sessions':
      return formatSessions(store.sessions(readProject(args.project), args.limit ?? 10));
    case 'session_summary': {
      const match = store.sessions(null, 1000).find(s => s.id === args.session_id || s.id.startsWith(args.session_id ?? '\0'));
      const summary = match && store.summaryFor(match.id);
      return summary ? formatSummary(summary) : 'No summary for that session.';
    }
    case 'remember': {
      const agent = cleanAgent(args.agent ?? 'claude');
      const text = required(args.note, 'note');
      const id = note(store, { agent, project: writeProject(args.project), kind: 'note', title: text.split('\n')[0], detail: text });
      return `Saved as #${id}.`;
    }
    case 'list_projects':
      return formatProjects(store);
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

// Most recent note per task id, read from the activity that mentions "#<id>".
function latestTaskNotes(store, project) {
  const notes = new Map();
  for (const o of store.feed({ project, limit: 1000 }).reverse()) {
    if (!['task', 'update', 'handoff', 'question', 'proposal', 'decision'].includes(o.kind)) continue;
    for (const m of o.title.matchAll(/#(\d+)\b/g)) {
      const id = Number(m[1]);
      if (!notes.has(id)) notes.set(id, o);
    }
  }
  return notes;
}

function formatProjects(store) {
  const rows = store.projects();
  return rows.length ? rows.map(p => `${p.project} · ${p.sessions} sessions · last active ${formatTime(p.last_active)}`).join('\n') : 'No projects yet.';
}

export function handle(store, msg, ctx = {}) {
  const { id, method, params } = msg ?? {};
  const reply = result => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'recall', version: '2.0.0' },
        instructions: 'Shared memory and task board for several AI assistants (Claude, ChatGPT, Grok) working on the same projects. Start with project_brief, sign every write with your agent name, claim tasks before working on them, and post_update when you finish something or hand it off.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        return reply({ content: [{ type: 'text', text: callTool(store, params?.name, params?.arguments ?? {}, ctx) }] });
      } catch (err) {
        if (err.code === -32602) return { jsonrpc: '2.0', id, error: { code: -32602, message: err.message } };
        return reply({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
    default:
      if (id === undefined) return null; // notification
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}
