// Owner login for /admin. The key lives only in the ADMIN_KEY env var and never travels in a URL:
// the owner types it into a form once, and gets a signed, HttpOnly session cookie.
// Scripts can send "Authorization: Bearer <key>" instead. With ADMIN_KEY unset, admin stays locked.
import crypto from 'node:crypto';
import express from 'express';
import config from './config.js';

const COOKIE = 'shipcheck_admin';
const SESSION_MS = 12 * 3600_000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Constant-time compare: hash both sides so lengths match and timing doesn't leak the key.
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Cookie value: "<expiresAt>.<hmac>". Signed with ADMIN_KEY, so rotating the key logs everyone out.
const sign = (expires) => crypto.createHmac('sha256', config.adminKey).update(`shipcheck-admin:${expires}`).digest('base64url');
const newSession = () => {
  const expires = Date.now() + SESSION_MS;
  return `${expires}.${sign(expires)}`;
};
function validSession(value) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  return sameSecret(m[2], sign(m[1]));
}

function readCookie(req, name) {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

const cookieOpts = { httpOnly: true, secure: true, sameSite: 'strict', path: '/admin' };

export function isAdmin(req) {
  if (!config.adminKey) return false;
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return sameSecret(auth.slice(7).trim(), config.adminKey);
  return validSession(readCookie(req, COOKIE));
}

// Failed logins: at most 5 per IP and 50 overall per 15 minutes.
const WINDOW_MS = 15 * 60_000;
const failures = new Map();
let globalFailures = [];
function tooManyFailures(ip) {
  const now = Date.now();
  globalFailures = globalFailures.filter((t) => now - t < WINDOW_MS);
  const mine = (failures.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (mine.length) failures.set(ip, mine);
  else failures.delete(ip);
  return mine.length >= 5 || globalFailures.length >= 50;
}
function recordFailure(ip) {
  const now = Date.now();
  failures.set(ip, [...(failures.get(ip) || []), now]);
  globalFailures.push(now);
}

function loginPage(res, status, message = '') {
  res.status(status).type('html').set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(config.brandName)} admin</title>
<style>
  :root { color-scheme: light dark; } body { margin: 0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  .wrap { max-width: 360px; margin: 12vh auto; padding: 16px; } h1 { font-size: 22px; }
  input, button { font: inherit; width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #9ca3af; margin: 6px 0; }
  button { cursor: pointer; } .err { color: #dc2626; }
</style></head><body><div class="wrap">
  <h1>${esc(config.brandName)} admin</h1>
  ${config.adminKey ? '' : '<p class="err">Admin is locked: ADMIN_KEY is not set on the server.</p>'}
  ${message ? `<p class="err">${esc(message)}</p>` : ''}
  <form method="post" action="/admin/login">
    <label for="key">Admin key</label>
    <input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</div></body></html>`);
}

// Gate for admin routes: signed-in owner continues; browsers get the login form; scripts get 401.
export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.method === 'GET' && req.accepts('html') && req.query.format !== 'json') return loginPage(res, 401);
  res.status(401).json({ error: 'unauthorized' });
}

export function mountAdminAuth(app) {
  app.post('/admin/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (tooManyFailures(req.ip)) return loginPage(res, 429, 'Too many wrong attempts. Try again in 15 minutes.');
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    if (!config.adminKey || !key || !sameSecret(key, config.adminKey)) {
      recordFailure(req.ip);
      return loginPage(res, 401, config.adminKey ? 'Wrong key.' : '');
    }
    failures.delete(req.ip);
    res.cookie(COOKIE, newSession(), { ...cookieOpts, maxAge: SESSION_MS });
    res.redirect(303, '/admin');
  });

  app.post('/admin/logout', (req, res) => {
    res.clearCookie(COOKIE, cookieOpts);
    res.redirect(303, '/admin');
  });
}
