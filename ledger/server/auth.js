// Password hashing (scrypt) and stateless signed session tokens.
import crypto from 'node:crypto';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  if (!expected.length) return false;
  const actual = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Hashed once at startup so a login for an unknown email costs the same time as a real one
// (otherwise response timing reveals which emails have accounts).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));
export function burnPasswordCheck(pw) { verifyPassword(pw, DUMMY_HASH); return false; }

const b64 = (s) => Buffer.from(s).toString('base64url');

export function signToken(payload, secret, ttlSeconds) {
  const body = b64(JSON.stringify(Object.assign({}, payload, { exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  return payload && payload.exp > Date.now() / 1000 ? payload : null;
}

// Idle length of a normal sign-in, the opt-in "keep me signed in" length, and the hard caps
// measured from the original sign-in. Caps stop a stolen cookie from being renewed forever.
// Unset, non-numeric, or out-of-range values fall back to the defaults (minimum 60 seconds,
// maximum 400 days — the longest a browser will keep a cookie).
const MIN_SESSION_SECONDS = 60;
const MAX_SESSION_SECONDS = 400 * 24 * 60 * 60;
function clampSeconds(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const s = Math.floor(n);
  if (s < MIN_SESSION_SECONDS || s > MAX_SESSION_SECONDS) return fallback;
  return s;
}
export function sessionDurations(env = process.env) {
  const standard = clampSeconds(env.LEDGER_SESSION_TTL_SECONDS, 12 * 60 * 60);
  const remember = Math.max(standard, clampSeconds(env.LEDGER_REMEMBER_TTL_SECONDS, 30 * 24 * 60 * 60));
  const standardAbsolute = Math.max(standard, clampSeconds(env.LEDGER_SESSION_ABSOLUTE_SECONDS, Math.max(standard, 7 * 24 * 60 * 60)));
  const rememberAbsolute = Math.max(remember, clampSeconds(env.LEDGER_REMEMBER_ABSOLUTE_SECONDS, remember));
  return { standard, remember, standardAbsolute, rememberAbsolute, renewWithin: Math.min(2 * 60 * 60, Math.floor(standard / 2)) };
}

export function passwordProblem(pw) {
  if (String(pw || '').length < 10) return 'Use at least 10 characters.';
  return null;
}

/**
 * Fixed-window limiter keyed by IP, user or session. Expired windows are swept so the map
 * can't grow without bound when many different keys (e.g. spoofed IPs) hit it.
 */
export function rateLimiter(limit, windowMs) {
  const hits = new Map();
  let lastSweep = Date.now();
  const check = (key) => {
    const now = Date.now();
    if (now - lastSweep > windowMs || hits.size > 50000) {
      for (const [k, h] of hits) if (now - h.start > windowMs) hits.delete(k);
      lastSweep = now;
    }
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) { hits.set(key, { start: now, n: 1 }); return true; }
    h.n += 1;
    return h.n <= limit;
  };
  check.size = () => hits.size;
  return check;
}
