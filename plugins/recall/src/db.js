// SQLite storage (Node's built-in node:sqlite) with FTS5 full-text search.
import path from 'node:path';
import { dataDir } from './util.js';

// node:sqlite prints an "experimental" warning on load; it would leak into
// hook output, so drop that one warning and keep all others.
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message ?? warning).includes('SQLite')) return;
  return originalEmitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  cwd TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project, updated_at);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS prompts_session ON prompts(session_id, id);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'claude-code',
  tool TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_project ON observations(project, id);
CREATE INDEX IF NOT EXISTS observations_session ON observations(session_id, id);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  project TEXT NOT NULL,
  request TEXT NOT NULL DEFAULT '',
  completed TEXT NOT NULL DEFAULT '',
  learned TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'heuristic',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS summaries_project ON summaries(project, updated_at);

CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  goal TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  repo TEXT NOT NULL DEFAULT '',
  stack TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  docs TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  lead TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project, status);

-- One row per MCP tool call on the shared server: who called what, and whether it worked.
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  agent TEXT NOT NULL,
  tool TEXT NOT NULL,
  project TEXT,
  ok INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title, detail, files, content='observations', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, detail, files) VALUES (new.id, new.title, new.detail, new.files);
END;
CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, detail, files) VALUES ('delete', old.id, old.title, old.detail, old.files);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
  request, completed, learned, next_steps, files, content='summaries', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS summaries_ai AFTER INSERT ON summaries BEGIN
  INSERT INTO summaries_fts(rowid, request, completed, learned, next_steps, files)
  VALUES (new.id, new.request, new.completed, new.learned, new.next_steps, new.files);
END;
CREATE TRIGGER IF NOT EXISTS summaries_ad AFTER DELETE ON summaries BEGIN
  INSERT INTO summaries_fts(summaries_fts, rowid, request, completed, learned, next_steps, files)
  VALUES ('delete', old.id, old.request, old.completed, old.learned, old.next_steps, old.files);
END;
CREATE TRIGGER IF NOT EXISTS summaries_au AFTER UPDATE ON summaries BEGIN
  INSERT INTO summaries_fts(summaries_fts, rowid, request, completed, learned, next_steps, files)
  VALUES ('delete', old.id, old.request, old.completed, old.learned, old.next_steps, old.files);
  INSERT INTO summaries_fts(rowid, request, completed, learned, next_steps, files)
  VALUES (new.id, new.request, new.completed, new.learned, new.next_steps, new.files);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  text, content='prompts', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
`;

// Turn free text into a safe FTS5 query: every word must match (prefix match).
export function ftsQuery(text) {
  const words = String(text ?? '').match(/[\p{L}\p{N}_]+/gu) ?? [];
  return words.map(w => `"${w}"*`).join(' ');
}

// Registry fields any assistant can edit with update_project.
export const PROJECT_FIELDS = ['description', 'repo', 'stack', 'status', 'docs'];

// Thrown when a write names an expected_version that is no longer current.
export class ConflictError extends Error {
  constructor(what, expected, current) {
    super(`Conflict: ${what} is at version ${current}, not ${expected}. Someone else changed it since you read it; read it again, merge your change, and retry with expected_version ${current}.`);
    this.conflict = true;
  }
}

const checkVersion = (what, expected, current) => {
  if (expected !== undefined && expected !== null && Number(expected) !== current) throw new ConflictError(what, expected, current);
};

const plain = rows => rows.map(r => ({ ...r }));

export class Store {
  constructor(file = path.join(dataDir(), 'recall.db')) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.migrate();
    this.db.exec(SCHEMA);
  }

  // Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them.
  migrate() {
    const columns = table => this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    const add = (table, column, ddl) => {
      const cols = columns(table);
      if (cols.length && !cols.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };
    add('sessions', 'last_text', "last_text TEXT NOT NULL DEFAULT ''");
    add('observations', 'agent', "agent TEXT NOT NULL DEFAULT 'claude-code'");
    for (const f of PROJECT_FIELDS) add('projects', f, `${f} TEXT NOT NULL DEFAULT ''`);
    add('projects', 'version', 'version INTEGER NOT NULL DEFAULT 0');
    add('tasks', 'version', 'version INTEGER NOT NULL DEFAULT 1');
  }

  close() {
    this.db.close();
  }

  touchSession(id, project, cwd, now = Date.now()) {
    this.db.prepare(`
      INSERT INTO sessions (id, project, cwd, started_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, ended_at = NULL
    `).run(id, project, cwd ?? null, now, now);
  }

  setLastText(id, text) {
    this.db.prepare('UPDATE sessions SET last_text = ? WHERE id = ?').run(text ?? '', id);
  }

  endSession(id, now = Date.now()) {
    this.db.prepare('UPDATE sessions SET ended_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  addPrompt(sessionId, project, text, now = Date.now()) {
    return Number(this.db.prepare('INSERT INTO prompts (session_id, project, text, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, project, text, now).lastInsertRowid);
  }

  addObservation(o, now = Date.now()) {
    return Number(this.db.prepare(`
      INSERT INTO observations (session_id, project, agent, tool, kind, title, detail, files, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(o.session_id, o.project, o.agent ?? 'claude-code', o.tool, o.kind, o.title, o.detail ?? '', (o.files ?? []).join('\n'), now).lastInsertRowid);
  }

  // A summary written by the AI summarizer is never overwritten by a heuristic one.
  saveSummary(s, now = Date.now()) {
    const existing = this.db.prepare('SELECT source FROM summaries WHERE session_id = ?').get(s.session_id);
    if (existing && existing.source === 'ai' && s.source !== 'ai') return false;
    this.db.prepare(`
      INSERT INTO summaries (session_id, project, request, completed, learned, next_steps, files, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        request = excluded.request, completed = excluded.completed, learned = excluded.learned,
        next_steps = excluded.next_steps, files = excluded.files, source = excluded.source,
        updated_at = excluded.updated_at
    `).run(s.session_id, s.project, s.request ?? '', s.completed ?? '', s.learned ?? '',
      s.next_steps ?? '', (s.files ?? []).join('\n'), s.source ?? 'heuristic', now);
    return true;
  }

  session(id) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return row ? { ...row } : null;
  }

  promptsFor(sessionId) {
    return plain(this.db.prepare('SELECT * FROM prompts WHERE session_id = ? ORDER BY id').all(sessionId));
  }

  observationsFor(sessionId) {
    return plain(this.db.prepare('SELECT * FROM observations WHERE session_id = ? ORDER BY id').all(sessionId));
  }

  summaryFor(sessionId) {
    const row = this.db.prepare('SELECT * FROM summaries WHERE session_id = ?').get(sessionId);
    return row ? { ...row } : null;
  }

  recentSummaries(project, limit = 5, excludeSession = null) {
    return plain(this.db.prepare(`
      SELECT * FROM summaries WHERE (? IS NULL OR project = ?) AND session_id IS NOT ?
      ORDER BY updated_at DESC LIMIT ?
    `).all(project, project, excludeSession, limit));
  }

  recentObservations(project, limit = 30, { excludeKinds = [] } = {}) {
    const kinds = excludeKinds.length ? `AND kind NOT IN (${excludeKinds.map(() => '?').join(',')})` : '';
    return plain(this.db.prepare(`
      SELECT * FROM observations WHERE (? IS NULL OR project = ?) ${kinds}
      ORDER BY id DESC LIMIT ?
    `).all(project, project, ...excludeKinds, limit)).reverse();
  }

  observationsById(ids) {
    const list = [...new Set(ids.map(Number).filter(Number.isFinite))];
    if (!list.length) return [];
    return plain(this.db.prepare(`SELECT * FROM observations WHERE id IN (${list.map(() => '?').join(',')}) ORDER BY id`).all(...list));
  }

  // Observations around an anchor id, in the same project, in time order.
  timeline(anchorId, before = 5, after = 5) {
    const anchor = this.db.prepare('SELECT * FROM observations WHERE id = ?').get(anchorId);
    if (!anchor) return [];
    const earlier = this.db.prepare('SELECT * FROM observations WHERE project = ? AND id < ? ORDER BY id DESC LIMIT ?')
      .all(anchor.project, anchorId, before).reverse();
    const later = this.db.prepare('SELECT * FROM observations WHERE project = ? AND id > ? ORDER BY id LIMIT ?')
      .all(anchor.project, anchorId, after);
    return plain([...earlier, anchor, ...later]);
  }

  search(text, { project = null, kind = null, limit = 20 } = {}) {
    const q = ftsQuery(text);
    if (!q) return [];
    const obs = this.db.prepare(`
      SELECT o.id, o.session_id, o.project, o.agent, o.kind, o.title, o.created_at, bm25(observations_fts) AS rank
      FROM observations_fts JOIN observations o ON o.id = observations_fts.rowid
      WHERE observations_fts MATCH ? AND (? IS NULL OR o.project = ?) AND (? IS NULL OR o.kind = ?)
      ORDER BY rank LIMIT ?
    `).all(q, project, project, kind, kind, limit).map(r => ({ type: 'observation', ...r }));
    if (kind) return obs;
    const sums = this.db.prepare(`
      SELECT s.id, s.session_id, s.project, s.request AS title, s.updated_at AS created_at, bm25(summaries_fts) AS rank
      FROM summaries_fts JOIN summaries s ON s.id = summaries_fts.rowid
      WHERE summaries_fts MATCH ? AND (? IS NULL OR s.project = ?)
      ORDER BY rank LIMIT ?
    `).all(q, project, project, limit).map(r => ({ type: 'session', ...r }));
    const prompts = this.db.prepare(`
      SELECT p.id, p.session_id, p.project, p.text AS title, p.created_at, bm25(prompts_fts) AS rank
      FROM prompts_fts JOIN prompts p ON p.id = prompts_fts.rowid
      WHERE prompts_fts MATCH ? AND (? IS NULL OR p.project = ?)
      ORDER BY rank LIMIT ?
    `).all(q, project, project, limit).map(r => ({ type: 'prompt', ...r }));
    return [...sums, ...obs, ...prompts].sort((a, b) => a.rank - b.rank).slice(0, limit);
  }

  sessions(project = null, limit = 20) {
    return plain(this.db.prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM observations o WHERE o.session_id = s.id) AS observation_count,
             (SELECT COUNT(*) FROM prompts p WHERE p.session_id = s.id) AS prompt_count,
             m.request, m.completed, m.source
      FROM sessions s LEFT JOIN summaries m ON m.session_id = s.id
      WHERE (? IS NULL OR s.project = ?) ORDER BY s.updated_at DESC LIMIT ?
    `).all(project, project, limit));
  }

  projects() {
    return plain(this.db.prepare(`
      SELECT project, COUNT(*) AS sessions, MAX(updated_at) AS last_active FROM sessions
      GROUP BY project ORDER BY last_active DESC
    `).all());
  }

  stats() {
    const count = t => Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
    return {
      sessions: count('sessions'),
      prompts: count('prompts'),
      observations: count('observations'),
      summaries: count('summaries'),
      tasks: count('tasks'),
    };
  }

  // Everything any agent recorded after observation #sinceId, oldest first.
  feed({ project = null, sinceId = 0, agent = null, excludeKinds = ['read', 'search'], limit = 50 } = {}) {
    const kinds = excludeKinds.length ? `AND kind NOT IN (${excludeKinds.map(() => '?').join(',')})` : '';
    return plain(this.db.prepare(`
      SELECT * FROM observations
      WHERE id > ? AND (? IS NULL OR project = ?) AND (? IS NULL OR agent = ?) ${kinds}
      ORDER BY id DESC LIMIT ?
    `).all(sinceId, project, project, agent, agent, ...excludeKinds, limit)).reverse();
  }

  lastActiveProject() {
    return this.db.prepare(`
      SELECT project FROM (
        SELECT project, updated_at AS t FROM sessions
        UNION ALL SELECT name, updated_at FROM projects
        UNION ALL SELECT project, updated_at FROM tasks
      ) ORDER BY t DESC LIMIT 1
    `).get()?.project ?? null;
  }

  goal(project) {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(project);
    return row ? { ...row } : null;
  }

  setGoal(project, goal, agent, now = Date.now()) {
    return this.updateProject(project, { goal }, agent, undefined, now);
  }

  // Changes registry fields; with expectedVersion, refuses if someone else wrote first.
  updateProject(project, fields, agent, expectedVersion, now = Date.now()) {
    const keys = Object.keys(fields).filter(k => k === 'goal' || PROJECT_FIELDS.includes(k));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.goal(project);
      checkVersion(`project ${project}`, expectedVersion, current?.version ?? 0);
      if (!current) this.db.prepare('INSERT INTO projects (name, updated_by, updated_at) VALUES (?, ?, ?)').run(project, agent, now);
      const sets = keys.map(k => `${k} = ?`).join(', ');
      this.db.prepare(`UPDATE projects SET ${sets ? `${sets}, ` : ''}version = version + 1, updated_by = ?, updated_at = ? WHERE name = ?`)
        .run(...keys.map(k => String(fields[k] ?? '')), agent, now, project);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.goal(project);
  }

  createTask({ project, title, details = '', lead = null, created_by }, now = Date.now()) {
    return Number(this.db.prepare(`
      INSERT INTO tasks (project, title, details, status, lead, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(project, title, details, lead ? 'in_progress' : 'open', lead, created_by, now, now).lastInsertRowid);
  }

  task(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? { ...row } : null;
  }

  // With expectedVersion, refuses the write if the task changed since the caller read it.
  updateTask(id, { status, lead, details, expectedVersion }, now = Date.now()) {
    const t = this.task(id);
    if (!t) return null;
    checkVersion(`task #${id}`, expectedVersion, t.version);
    const r = this.db.prepare('UPDATE tasks SET status = ?, lead = ?, details = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run(status ?? t.status, lead === undefined ? t.lead : lead, details ?? t.details, now, id, t.version);
    if (!Number(r.changes)) throw new ConflictError(`task #${id}`, t.version, this.task(id).version);
    return this.task(id);
  }

  addAudit({ agent, tool, project = null, ok, detail = '' }, now = Date.now()) {
    this.db.prepare('INSERT INTO audit (at, agent, tool, project, ok, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(now, agent, tool, project, ok ? 1 : 0, detail);
  }

  auditLog({ agent = null, limit = 50 } = {}) {
    return plain(this.db.prepare('SELECT * FROM audit WHERE (? IS NULL OR agent = ?) ORDER BY id DESC LIMIT ?').all(agent, agent, limit));
  }

  // Observations of the given kinds, newest first: a project's change history.
  history({ project = null, kinds, limit = 50 }) {
    return plain(this.db.prepare(`
      SELECT * FROM observations WHERE (? IS NULL OR project = ?) AND kind IN (${kinds.map(() => '?').join(',')})
      ORDER BY id DESC LIMIT ?
    `).all(project, project, ...kinds, limit));
  }

  tasks(project = null, { includeDone = false } = {}) {
    return plain(this.db.prepare(`
      SELECT * FROM tasks WHERE (? IS NULL OR project = ?) AND (? OR status != 'done')
      ORDER BY CASE status WHEN 'waiting_on_user' THEN 0 WHEN 'blocked' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'review' THEN 3 WHEN 'open' THEN 4 ELSE 5 END, updated_at DESC
    `).all(project, project, includeDone ? 1 : 0));
  }

  forget({ session = null, project = null, all = false } = {}) {
    const where = all ? '1 = 1' : session ? 'session_id = ?' : project ? 'project = ?' : null;
    if (!where) throw new Error('forget needs a session, a project, or all');
    const args = all ? [] : [session ?? project];
    this.db.exec('BEGIN');
    try {
      let removed = 0;
      for (const table of ['observations', 'prompts', 'summaries']) {
        removed += Number(this.db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...args).changes);
      }
      const sessionWhere = all ? '1 = 1' : session ? 'id = ?' : 'project = ?';
      removed += Number(this.db.prepare(`DELETE FROM sessions WHERE ${sessionWhere}`).run(...args).changes);
      if (!session) {
        removed += Number(this.db.prepare(`DELETE FROM tasks WHERE ${all ? '1 = 1' : 'project = ?'}`).run(...args).changes);
        removed += Number(this.db.prepare(`DELETE FROM projects WHERE ${all ? '1 = 1' : 'name = ?'}`).run(...args).changes);
      }
      this.db.exec('COMMIT');
      return removed;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
