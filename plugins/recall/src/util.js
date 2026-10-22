// Shared helpers: paths, logging, privacy filtering, project detection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function dataDir() {
  const dir = process.env.RECALL_DATA_DIR || path.join(os.homedir(), '.recall');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function log(...parts) {
  try {
    const line = `[${new Date().toISOString()}] ${parts.map(p => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
    fs.appendFileSync(path.join(dataDir(), 'recall.log'), line);
  } catch {
    // Logging must never break a hook.
  }
}

export function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Anything wrapped in <private>...</private> is never stored.
export function stripPrivate(text) {
  if (text == null) return '';
  return String(text).replace(/<private>[\s\S]*?(<\/private>|$)/gi, '[private]');
}

const SECRET_PATTERNS = [
  /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*["']?[^\s"']{6,}/gi,
];

export function redact(text) {
  let out = stripPrivate(text);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, name) => (name ? `${name}=[redacted]` : '[redacted]'));
  }
  return out;
}

export function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function tail(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `…${s.slice(-max)}` : s;
}

// A project is the git root of the working directory (or the directory itself).
export function projectRoot(cwd) {
  let dir = path.resolve(cwd || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd || process.cwd());
    dir = parent;
  }
}

export function projectName(cwd) {
  return process.env.RECALL_PROJECT || path.basename(projectRoot(cwd));
}

export function relPath(file, cwd) {
  if (!file) return '';
  const root = projectRoot(cwd);
  const abs = path.resolve(cwd || root, file);
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') ? rel : file;
}

export function formatTime(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
