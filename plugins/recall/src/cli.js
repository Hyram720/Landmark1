#!/usr/bin/env node
// Command-line access to the memory database.
import { Store } from './db.js';
import { buildContext } from './context.js';
import { formatObservations, formatSearchResults, formatSessions, formatSummary } from './format.js';
import { dataDir, projectName } from './util.js';

const HELP = `recall: memory for Claude Code

Usage:
  recall search <words…> [--project P|--all]   search past sessions
  recall show <id…>                            show observations by #id
  recall timeline <id>                         activity around an observation
  recall sessions [--project P|--all]          recent sessions
  recall summary <session-id>                  one session's summary
  recall context [dir]                         preview what a new session receives
  recall projects                              projects with memory
  recall stats                                 database counts and location
  recall summarize <session-id>                (re)run the AI summary now
  recall forget --session ID | --project P | --everything
  recall web [port]                            dashboard at http://127.0.0.1:37778
  recall token                                 print a new random secret for the shared server
`;

function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all' || a === '--everything') flags[a.slice(2)] = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else rest.push(a);
  }
  return { flags, rest };
}

const [command, ...args] = process.argv.slice(2);
const { flags, rest } = parse(args);
const project = flags.all ? null : flags.project || projectName(process.cwd());

if (command === 'token') {
  const { randomBytes } = await import('node:crypto');
  process.stdout.write(`${randomBytes(24).toString('base64url')}\n`);
  process.exit(0);
}

if (!command || command === 'help' || command === '--help') {
  process.stdout.write(HELP);
  process.exit(0);
}

const store = new Store();
let out = '';
try {
  switch (command) {
    case 'search':
      out = formatSearchResults(store.search(rest.join(' '), { project, limit: Number(flags.limit) || 30 }));
      break;
    case 'show':
      out = formatObservations(store.observationsById(rest));
      break;
    case 'timeline':
      out = formatObservations(store.timeline(Number(rest[0]), 8, 8));
      break;
    case 'sessions':
      out = formatSessions(store.sessions(project, Number(flags.limit) || 15));
      break;
    case 'summary': {
      const match = store.sessions(null, 5000).find(s => s.id === rest[0] || s.id.startsWith(rest[0] ?? '\0'));
      const s = match && store.summaryFor(match.id);
      out = s ? formatSummary(s) : 'No summary for that session.';
      break;
    }
    case 'context':
      out = buildContext(store, projectName(rest[0] || process.cwd())) || 'Nothing remembered for this project yet.';
      break;
    case 'projects':
      out = store.projects().map(p => `${p.project}\t${p.sessions} sessions`).join('\n') || 'No projects yet.';
      break;
    case 'stats':
      out = `${Object.entries(store.stats()).map(([k, v]) => `${k}: ${v}`).join('\n')}\ndata: ${dataDir()}`;
      break;
    case 'summarize': {
      const { aiSummary } = await import('./summarize.js');
      out = (await aiSummary(store, rest[0]))
        ? 'AI summary stored.'
        : `No AI summary stored; see ${dataDir()}/recall.log`;
      break;
    }
    case 'forget': {
      if (!flags.session && !flags.project && !flags.everything) throw new Error('say what to forget: --session ID, --project P or --everything');
      const n = store.forget({ session: flags.session, project: flags.project, all: !!flags.everything });
      out = `Removed ${n} rows.`;
      break;
    }
    case 'web': {
      store.close();
      const { serve } = await import('./viewer.js');
      serve(Number(rest[0]) || 37778);
      break;
    }
    default:
      out = `Unknown command: ${command}\n\n${HELP}`;
      process.exitCode = 1;
  }
} catch (err) {
  out = `Error: ${err.message}`;
  process.exitCode = 1;
} finally {
  if (command !== 'web') store.close();
}
if (out) process.stdout.write(`${out}\n`);
