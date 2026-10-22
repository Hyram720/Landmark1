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
  ended_at INTEGER
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

const plain = rows => rows.map(r => ({ ...r }));

export class Store {
  constructor(file = path.join(dataDir(), 'recall.db')) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
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

  endSession(id, now = Date.now()) {
    this.db.prepare('UPDATE sessions SET ended_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  addPrompt(sessionId, project, text, now = Date.now()) {
    return Number(this.db.prepare('INSERT INTO prompts (session_id, project, text, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, project, text, now).lastInsertRowid);
  }

  addObservation(o, now = Date.now()) {
    return Number(this.db.prepare(`
      INSERT INTO observations (session_id, project, tool, kind, title, detail, files, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(o.session_id, o.project, o.tool, o.kind, o.title, o.detail ?? '', (o.files ?? []).join('\n'), now).lastInsertRowid);
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
      SELECT o.id, o.session_id, o.project, o.kind, o.title, o.created_at, bm25(observations_fts) AS rank
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
    };
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
      this.db.exec('COMMIT');
      return removed;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
