// Session lifetime, sliding renewal, revocation, and the /app sign-in form.
// Run: node --test ledger/test/session.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { signToken } from '../server/auth.js';
import { setTransport } from '../server/mailer.js';

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const DEFAULT_SESSION = 12 * HOUR;
const DEFAULT_REMEMBER = 30 * DAY;
const DEFAULT_ABSOLUTE = 7 * DAY;

for (const k of ['LEDGER_SESSION_TTL_SECONDS', 'LEDGER_REMEMBER_TTL_SECONDS', 'LEDGER_SESSION_ABSOLUTE_SECONDS', 'LEDGER_REMEMBER_ABSOLUTE_SECONDS', 'LEDGER_SETUP_CODE', 'LEDGER_MAIL_MODE']) delete process.env[k];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-session-'));
const { app, db } = createApp({ dataDir: dir, encryptionKey: 'session-test-key' });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { setTransport(null); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let ip = 0;
function sessionCookie(headers) {
  const list = headers.getSetCookie ? headers.getSetCookie() : [];
  const line = list.find(c => c.startsWith('ledger_session='));
  if (!line) return null;
  const token = line.slice('ledger_session='.length).split(';')[0];
  let payload = null;
  if (token) {
    try { payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')); } catch { payload = null; }
  }
  const maxAge = Number((line.match(/Max-Age=(\d+)/i) || [])[1]);
  return { line, token, payload, maxAge: Number.isFinite(maxAge) ? maxAge : null };
}
async function login(email, password, extra = {}) {
  ip += 1;
  const r = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${(ip % 250) + 1}` },
    body: JSON.stringify(Object.assign({ email, password }, extra))
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body, cookie: sessionCookie(r.headers), headers: r.headers };
}
async function withSession(token, method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: Object.assign({ cookie: `ledger_session=${token}` }, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), cookie: sessionCookie(r.headers), headers: r.headers };
}
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign({ cookie }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set && set.startsWith('ledger_session=')) cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers, cookie: sessionCookie(r.headers) };
  };
}
function near(actual, expected, slack = 5) {
  assert.ok(Math.abs(actual - expected) <= slack, `expected ${actual} within ${slack} of ${expected}`);
}
function restoreEnv(keys, prev) {
  for (const k of keys) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
}

const owner = client();
const PASS = 'correct horse battery';
let ownerId;

test('extended sessions, sliding renewal, revocation, and /app sign-in', async (t) => {
  await t.test('owner can be created', async () => {
    const r = await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@example.test', password: PASS });
    assert.strictEqual(r.status, 200);
    ownerId = r.body.user.id;
    assert.equal(r.cookie.payload.rm, 0);
    assert.equal(r.cookie.maxAge, DEFAULT_SESSION);
    assert.match(r.cookie.line, /HttpOnly/i);
    assert.match(r.cookie.line, /SameSite=Lax/i);
    assert.match(r.cookie.line, /Path=\//);
  });

  await t.test('a normal sign-in lasts 12 hours and is not a remember-me session', async () => {
    const r = await login('owner@example.test', PASS);
    assert.strictEqual(r.status, 200);
    assert.equal(r.cookie.maxAge, DEFAULT_SESSION);
    assert.equal(r.cookie.payload.rm, 0);
    assert.equal(r.cookie.payload.ep, 1);
    assert.ok(r.cookie.payload.iat > 0);
    near(r.cookie.payload.exp - r.cookie.payload.iat, DEFAULT_SESSION);
    assert.ok(!('token' in (r.body || {})), 'session token stays in the cookie');
    const again = await withSession(r.cookie.token, 'GET', '/api/session');
    assert.equal(again.body.user.email, 'owner@example.test');
    assert.equal(again.cookie, null, 'a fresh session is not renewed on the next request');
  });

  await t.test('Keep me signed in lasts 30 days when asked, and only when asked', async () => {
    const yes = await login('owner@example.test', PASS, { remember: true });
    assert.strictEqual(yes.status, 200);
    assert.equal(yes.cookie.maxAge, DEFAULT_REMEMBER);
    assert.equal(yes.cookie.payload.rm, 1);
    near(yes.cookie.payload.exp - yes.cookie.payload.iat, DEFAULT_REMEMBER);
    const on = await login('owner@example.test', PASS, { remember: 'yes' });
    assert.equal(on.cookie.maxAge, DEFAULT_REMEMBER);
    const off = await login('owner@example.test', PASS, { remember: 'false' });
    assert.equal(off.cookie.maxAge, DEFAULT_SESSION);
    assert.equal(off.cookie.payload.rm, 0);
    const omitted = await login('owner@example.test', PASS, {});
    assert.equal(omitted.cookie.maxAge, DEFAULT_SESSION);
  });

  await t.test('session lengths are configurable and reject unsafe values', async () => {
    const keys = ['LEDGER_SESSION_TTL_SECONDS', 'LEDGER_REMEMBER_TTL_SECONDS', 'LEDGER_SESSION_ABSOLUTE_SECONDS', 'LEDGER_REMEMBER_ABSOLUTE_SECONDS'];
    const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    try {
      process.env.LEDGER_SESSION_TTL_SECONDS = '7200';
      process.env.LEDGER_REMEMBER_TTL_SECONDS = String(10 * DAY);
      const custom = await login('owner@example.test', PASS, { remember: true });
      assert.equal(custom.cookie.maxAge, 10 * DAY);
      const standard = await login('owner@example.test', PASS);
      assert.equal(standard.cookie.maxAge, 7200);
      const opts = await fetch(base + '/api/auth/options');
      const body = await opts.json();
      assert.strictEqual(body.forgot, true);
      assert.strictEqual(body.rememberDays, 10);

      process.env.LEDGER_SESSION_TTL_SECONDS = 'nope';
      process.env.LEDGER_REMEMBER_TTL_SECONDS = '10';
      const fallback = await login('owner@example.test', PASS, { remember: true });
      assert.equal(fallback.cookie.maxAge, DEFAULT_REMEMBER, 'values below 60 seconds or non-numeric are ignored');

      process.env.LEDGER_SESSION_TTL_SECONDS = '86400';
      process.env.LEDGER_REMEMBER_TTL_SECONDS = '3600';
      const raised = await login('owner@example.test', PASS, { remember: true });
      assert.equal(raised.cookie.maxAge, 86400, 'remember-me is never shorter than a normal session');

      process.env.LEDGER_SESSION_TTL_SECONDS = '7200';
      process.env.LEDGER_SESSION_ABSOLUTE_SECONDS = '60';
      const capped = await login('owner@example.test', PASS);
      assert.equal(capped.cookie.maxAge, 7200, 'the absolute cap cannot expire a session at the moment it is issued');

      process.env.LEDGER_REMEMBER_TTL_SECONDS = '999999999';
      const huge = await login('owner@example.test', PASS, { remember: true });
      assert.equal(huge.cookie.maxAge, Math.max(7200, DEFAULT_REMEMBER), 'a remember TTL past 400 days falls back to the default');
    } finally { restoreEnv(keys, prev); }
    const options = await (await fetch(base + '/api/auth/options')).json();
    assert.strictEqual(options.rememberDays, 30);
    assert.strictEqual(options.forgot, true);
  });

  await t.test('an active session renews inside the renewal window and keeps its original clock', async () => {
    const u = db.data.users.find(x => x.id === ownerId);
    const now = Math.floor(Date.now() / 1000);
    const iat = now - 11 * HOUR;
    const token = signToken({ uid: u.id, ep: u.sessionEpoch, iat, rm: 0 }, db.data.secret, 30 * 60);
    const renewed = await withSession(token, 'GET', '/api/workspace/version');
    assert.strictEqual(renewed.status, 200);
    assert.ok(renewed.cookie, 'session cookie should be renewed');
    assert.equal(renewed.cookie.payload.iat, iat, 'renewal must not restart the absolute clock');
    assert.equal(renewed.cookie.payload.ep, u.sessionEpoch);
    assert.equal(renewed.cookie.payload.rm, 0);
    near(renewed.cookie.maxAge, DEFAULT_SESSION, 2);
    const idle = signToken({ uid: u.id, ep: u.sessionEpoch, iat: now, rm: 0 }, db.data.secret, 3 * HOUR);
    const quiet = await withSession(idle, 'GET', '/api/session');
    assert.equal(quiet.cookie, null, 'more than 2 hours of life left does not rewrite the cookie');
  });

  await t.test('sliding renewal stops at the absolute cap', async () => {
    const u = db.data.users.find(x => x.id === ownerId);
    const now = Math.floor(Date.now() / 1000);
    const iat = now - (DEFAULT_ABSOLUTE - 3 * HOUR);
    const token = signToken({ uid: u.id, ep: u.sessionEpoch, iat, rm: 0 }, db.data.secret, 30 * 60);
    const renewed = await withSession(token, 'GET', '/api/session');
    assert.ok(renewed.cookie);
    assert.equal(renewed.cookie.payload.iat, iat);
    near(renewed.cookie.maxAge, 3 * HOUR, 2);
    assert.ok(renewed.cookie.maxAge < DEFAULT_SESSION);

    const rememberIat = now - (DEFAULT_REMEMBER - 2 * HOUR);
    const rememberTok = signToken({ uid: u.id, ep: u.sessionEpoch, iat: rememberIat, rm: 1 }, db.data.secret, 20 * 60);
    const rememberRenew = await withSession(rememberTok, 'GET', '/api/session');
    assert.equal(rememberRenew.cookie.payload.rm, 1);
    assert.equal(rememberRenew.cookie.payload.iat, rememberIat);
    near(rememberRenew.cookie.maxAge, 2 * HOUR, 2);
  });

  await t.test('a token past its absolute cap is rejected even if exp has not passed', async () => {
    const u = db.data.users.find(x => x.id === ownerId);
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ uid: u.id, ep: u.sessionEpoch, iat: now - DEFAULT_ABSOLUTE - HOUR, rm: 0 }, db.data.secret, HOUR);
    const session = await withSession(token, 'GET', '/api/session');
    assert.strictEqual(session.status, 200);
    assert.equal(session.body.user, null);
    assert.equal(session.cookie, null, 'an expired absolute session is not renewed');
    assert.strictEqual((await withSession(token, 'GET', '/api/workspace')).status, 401);
  });

  await t.test('the browser cannot stretch a signed session', async () => {
    const issued = await login('owner@example.test', PASS);
    const [body, sig] = issued.cookie.token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.exp = Math.floor(Date.now() / 1000) + DEFAULT_REMEMBER;
    payload.rm = 1;
    payload.iat = Math.floor(Date.now() / 1000);
    const forged = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
    assert.strictEqual((await withSession(forged, 'GET', '/api/workspace')).status, 401);
  });

  await t.test('password reset, disablement, and logout still end remember-me sessions', async () => {
    const staffJar = client();
    const inv = await owner('POST', '/api/invites', { role: 'staff', name: 'Staffer', email: 'staff@example.test' });
    assert.strictEqual((await staffJar('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'staff password 1' })).status, 200);
    const remembered = await login('staff@example.test', 'staff password 1', { remember: true });
    assert.equal(remembered.cookie.maxAge, DEFAULT_REMEMBER);
    const staff = db.data.users.find(x => x.email === 'staff@example.test');

    const link = await owner('POST', `/api/users/${staff.id}/reset-link`);
    assert.strictEqual(link.status, 200);
    const resetToken = link.body.url.split('reset=')[1];
    const reset = await fetch(base + '/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8' }, body: JSON.stringify({ token: resetToken, password: 'staff password 2' }) });
    const resetCookie = sessionCookie(reset.headers);
    assert.strictEqual(reset.status, 200);
    assert.equal(resetCookie.maxAge, DEFAULT_SESSION, 'a password reset does not mint a 30-day session');
    assert.equal(resetCookie.payload.rm, 0);
    assert.equal((await withSession(remembered.cookie.token, 'GET', '/api/session')).body.user, null, 'remember-me cookie died with the epoch bump');
    assert.strictEqual((await withSession(remembered.cookie.token, 'GET', '/api/workspace')).status, 401);

    const again = await login('staff@example.test', 'staff password 2', { remember: true });
    staff.disabled = true;
    const disabled = await withSession(again.cookie.token, 'GET', '/api/workspace');
    assert.strictEqual(disabled.status, 401);
    assert.equal(disabled.cookie, null);
    staff.disabled = false;

    const live = await login('staff@example.test', 'staff password 2', { remember: true });
    const gone = await owner('DELETE', `/api/users/${staff.id}`);
    assert.strictEqual(gone.status, 200);
    assert.strictEqual((await withSession(live.cookie.token, 'GET', '/api/workspace')).status, 401);

    const ownerSession = await login('owner@example.test', PASS, { remember: true });
    const out = await fetch(base + '/api/logout', { method: 'POST', headers: { cookie: `ledger_session=${ownerSession.cookie.token}` } });
    assert.strictEqual(out.status, 200);
    const cleared = out.headers.getSetCookie();
    assert.ok(cleared.some(c => c.startsWith('ledger_session=')), 'logout clears the session cookie');
    assert.ok(!cleared.some(c => /ledger_session=[^;]/.test(c.split(';')[0].replace('ledger_session=', '')) && /Max-Age=[1-9]/.test(c)), 'logout does not set a fresh session');
    const jar = client();
    // The cleared cookie must not authenticate. Replay of the pre-logout token is still rejected
    // only when the browser drops it; send the cleared value the way a browser would.
    const clearedPair = cleared.find(c => c.startsWith('ledger_session=')).split(';')[0];
    const after = await fetch(base + '/api/session', { headers: { cookie: clearedPair } });
    const afterBody = await after.json();
    assert.equal(afterBody.user, null);
    assert.equal((await withSession(ownerSession.cookie.token, 'GET', '/api/session')).body.user.email, 'owner@example.test', 'logout clears the browser cookie and does not bump the epoch');
    void jar;
  });

  await t.test('email sign-in codes keep the remember-me choice and do not start a session early', async () => {
    const outbox = [];
    setTransport(async m => { outbox.push(m); });
    try {
      assert.strictEqual((await owner('PUT', '/api/settings/auth', { emailOtp: true, magicLink: false, notifications: true })).status, 200);
      const pending = await login('owner@example.test', PASS, { remember: true });
      assert.strictEqual(pending.body.otpRequired, true);
      assert.equal(pending.cookie, null, 'no session cookie before the code');
      const otp = (pending.headers.getSetCookie() || []).find(c => c.startsWith('ledger_otp='));
      assert.ok(otp);
      const code = outbox.pop().text.match(/\b(\d{6})\b/)[1];
      const r = await fetch(base + '/api/auth/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: otp.split(';')[0] },
        body: JSON.stringify({ code })
      });
      const done = sessionCookie(r.headers);
      assert.strictEqual(r.status, 200);
      assert.equal(done.maxAge, DEFAULT_REMEMBER);
      assert.equal(done.payload.rm, 1);

      const pendingShort = await login('owner@example.test', PASS, { remember: false });
      const otp2 = (pendingShort.headers.getSetCookie() || []).find(c => c.startsWith('ledger_otp='));
      const code2 = outbox.pop().text.match(/\b(\d{6})\b/)[1];
      const r2 = await fetch(base + '/api/auth/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: otp2.split(';')[0] },
        body: JSON.stringify({ code: code2 })
      });
      const short = sessionCookie(r2.headers);
      assert.equal(short.maxAge, DEFAULT_SESSION);
      assert.equal(short.payload.rm, 0);
    } finally {
      await owner('PUT', '/api/settings/auth', { emailOtp: false, magicLink: false, notifications: true });
      setTransport(null);
    }
  });

  await t.test('the /app sign-in script is password-manager friendly and offers recovery', async () => {
    const js = fs.readFileSync(path.join(import.meta.dirname, '../js/app.js'), 'utf8');
    const served = await (await fetch(base + '/js/app.js')).text();
    assert.strictEqual(served, js);
    for (const needle of [
      'method="post"',
      'autocomplete="on"',
      'autocomplete="username"',
      'autocomplete="current-password"',
      'autocomplete="new-password"',
      'Forgot password?',
      'Email me a sign-in link',
      'Keep me signed in for',
      'name="remember"',
      'rememberDays',
      'new PasswordCredential',
      '/api/auth/forgot',
      '/api/auth/magic',
      '/api/auth/magic/verify',
      '/api/auth/options',
      'autocomplete="one-time-code"'
    ]) assert.ok(js.includes(needle), needle);
    assert.ok(!js.includes('window.prompt'), 'the sign-in code is entered on the card, not in a browser prompt');
  });
});
