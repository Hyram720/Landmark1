// Public self-signup, CROA gating, and Kit newsletter hook.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { setTransport } from '../server/mailer.js';
import { verifyPassword } from '../server/auth.js';
import { SIGNUP_OK } from '../server/signup.js';
import { CAN_SPAM_POSTAL_ADDRESS } from '../server/email-footer.js';
import { kitCalls, resetKitCalls, KIT_FORM_ID, KIT_FORM_PATH } from '../server/kit-hook.js';
import { Law } from '../server/shared.js';
import { CLIENT_AUTH_METHOD } from '../server/auth-method.js';

delete process.env.KIT_API_KEY;
delete process.env.LEDGER_MAIL_MODE;

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('CROA placeholders are marked for review and do not contain the email address', () => {
  const disclosure = read('legal/PLACEHOLDER-croa-disclosure.md');
  const contract = read('legal/PLACEHOLDER-croa-contract.md');
  const cancel = read('legal/PLACEHOLDER-croa-cancellation.md');
  assert.match(disclosure, /PLACEHOLDER FOR COMPLIANCE REVIEW/);
  assert.match(disclosure, /1679c/);
  assert.match(disclosure, /Consumer Credit File Rights Under State and Federal Law/);
  assert.match(contract, /PENDING COMPLIANCE REVIEW/);
  assert.match(contract, /1679d/);
  assert.match(cancel, /PENDING COMPLIANCE REVIEW/);
  assert.match(cancel, /1679e/);
  for (const text of [disclosure, contract, cancel]) {
    assert.doesNotMatch(text, /2230 Route 70/);
    assert.doesNotMatch(text, /Cherry Hill/);
  }
  assert.strictEqual(CLIENT_AUTH_METHOD, 'password');
  for (const file of ['server/signup.js', 'server/signup-status.js', 'server/newsletter.js', 'server/kit-hook.js', 'server/auth-method.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /from ['"][^'"]*payments/);
    assert.doesNotMatch(src, /from ['"][^'"]*billing/);
    assert.doesNotMatch(src, /stripe|hostedPaymentToken|authorize\.net/i);
  }
  const page = read('signup.html');
  assert.match(page, /name="acceptAccountTerms"/);
  assert.match(page, /name="marketingConsent"/);
  assert.doesNotMatch(page, /name="marketingConsent"[^>]*\bchecked\b/);
  assert.match(page, /name="website"/);
  const list = read('js/ui.js');
  assert.match(list, /pending:/);
  assert.match(list, /contract-signed/);
});

function listen(app) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    const jar = {};
    const f = async (method, url, body) => {
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
    };
    return f;
  };
  return { server, base, client };
}

test('signup, CROA gate, invite still works, newsletter, magic link, rate limit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-signup-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'signup-test-key-not-a-secret' });
  const { server, client } = listen(built.app);
  const owner = client();
  const pat = client();
  const riley = client();
  const anon = client();
  const outbox = [];
  const realFetch = globalThis.fetch;
  setTransport(async m => { outbox.push(m); });
  resetKitCalls();
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(u)) return realFetch(url, opts);
    if (/stripe|authorize\.net|kit\.com|resend|amazonaws|email\.us-/i.test(u)) throw new Error('unexpected network ' + u);
    return realFetch(url, opts);
  };
  const rateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-signup-rate-'));
  const magicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-signup-magic-'));
  let rateServer;
  let magicServer;
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner@signup.test', password: 'owner password 1' })).status, 200);

    const ws0 = await owner('GET', '/api/workspace');
    ws0.body.data.clients.push({ id: 'inv1', name: 'Invited Person', firstName: 'Invited', lastName: 'Person', kind: 'personal', email: 'invited@signup.test', status: 'onboarding', onboarding: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: ws0.body.version, data: ws0.body.data })).status, 200);
    const inv = await owner('POST', '/api/invites', { role: 'client', clientId: 'inv1', email: 'invited@signup.test' });
    const invited = client();
    assert.strictEqual((await invited('POST', '/api/invites/accept', { token: inv.body.url.split('invite=')[1], password: 'invited password 1' })).status, 200);
    assert.strictEqual((await invited('GET', '/api/portal/me')).body.client.name, 'Invited Person');

    const bad = await anon('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'nope', password: 'long password 1', acceptAccountTerms: true });
    assert.strictEqual(bad.status, 400);
    const short = await anon('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'a@signup.test', password: 'short', acceptAccountTerms: true });
    assert.strictEqual(short.status, 400);
    const terms = await anon('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'a@signup.test', password: 'long password 1', acceptAccountTerms: false });
    assert.strictEqual(terms.status, 400);

    const honey = await anon('POST', '/api/signup', { firstName: 'Bot', lastName: 'Bot', email: 'bot@signup.test', password: 'long password 1', acceptAccountTerms: true, website: 'http://spam.test' });
    assert.strictEqual(honey.status, 200);
    assert.deepStrictEqual(honey.body, SIGNUP_OK);

    const created = await pat('POST', '/api/signup', { firstName: 'Pat', lastName: 'Example', email: 'pat@signup.test', password: 'pat password 1', acceptAccountTerms: true, marketingConsent: false });
    assert.strictEqual(created.status, 200);
    assert.deepStrictEqual(created.body, SIGNUP_OK);
    assert.deepStrictEqual(created.body, honey.body);
    const again = await anon('POST', '/api/signup', { firstName: 'Pat', lastName: 'Example', email: 'pat@signup.test', password: 'other password 99', acceptAccountTerms: true });
    assert.strictEqual(again.status, 200);
    assert.deepStrictEqual(again.body, SIGNUP_OK);

    const staff = await owner('GET', '/api/workspace');
    const pats = staff.body.data.clients.filter(c => c.email === 'pat@signup.test');
    assert.strictEqual(pats.length, 1);
    assert.strictEqual(pats[0].status, 'pending');
    assert.strictEqual(pats[0].signupSource, 'self');
    assert.ok(!staff.body.data.clients.some(c => c.email === 'bot@signup.test'));
    assert.strictEqual((staff.body.data.invoices || []).length, 0);
    const user = built.db.data.users.find(u => u.email === 'pat@signup.test');
    assert.ok(user.password.startsWith('scrypt$'));
    assert.strictEqual(verifyPassword('pat password 1', user.password), true);
    assert.strictEqual(verifyPassword('other password 99', user.password), false);
    assert.strictEqual(user.emailVerifiedAt, null);
    assert.strictEqual((await pat('GET', '/api/portal/me')).status, 401);
    assert.strictEqual((await pat('POST', '/api/login', { email: 'pat@signup.test', password: 'pat password 1' })).status, 403);

    const mail = outbox.find(m => m.to === 'pat@signup.test');
    assert.ok(mail, 'verification handed to the mailer');
    assert.match(mail.text, new RegExp(CAN_SPAM_POSTAL_ADDRESS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const token = mail.text.match(/verify=([\w-]+)/)[1];
    assert.ok(!JSON.stringify(built.db.data.authTokens).includes(token), 'verify token is stored hashed');
    assert.strictEqual((await pat('POST', '/api/signup/verify', { token })).status, 200);
    assert.strictEqual((await pat('POST', '/api/signup/verify', { token })).status, 400, 'single use');
    assert.ok(built.db.data.users.find(u => u.email === 'pat@signup.test').emailVerifiedAt);
    assert.strictEqual((await pat('POST', '/api/login', { email: 'pat@signup.test', password: 'pat password 1' })).status, 200);

    const early = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true, esignConsent: true });
    assert.strictEqual(early.status, 400);
    const viewed = await pat('POST', '/api/portal/disclosure-view');
    assert.strictEqual(viewed.status, 200);
    assert.match(viewed.body.disclosureViewedAt, /T/);
    const noEsign = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true, esignConsent: false });
    assert.strictEqual(noEsign.status, 400);
    const signed = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true, esignConsent: true });
    assert.strictEqual(signed.status, 200);
    assert.match(signed.body.signature.at, /T/);
    const me = await pat('GET', '/api/portal/me');
    assert.match(me.body.documents.disclosure, /1679c/);
    assert.match(me.body.documents.contract, /PENDING COMPLIANCE REVIEW/);
    assert.doesNotMatch(me.body.documents.contract, /Cherry Hill/);
    assert.match(me.body.documents.cancellation, /1679e/);
    assert.strictEqual(me.body.client.status, 'contract-signed');
    assert.notStrictEqual(me.body.client.status, 'active');
    assert.strictEqual(me.body.croa.inWindow, true);
    assert.strictEqual(me.body.croa.cancellationWindowEndsAt, me.body.croa.deadline);
    assert.strictEqual(me.body.croa.cancellationWindowEndsAt, Law.croaCancelDeadline(new Date().toISOString().slice(0, 10)));
    const held = await owner('GET', '/api/workspace');
    const pendingRileyPrep = held.body.data;
    assert.strictEqual(held.body.data.clients.find(c => c.email === 'pat@signup.test').status, 'contract-signed');
    pendingRileyPrep.disputes.push({ id: 'd-pat', clientId: pats[0].id, recipient: 'Equifax', type: 'cra_611', round: 1, status: 'draft', items: [] });
    const blocked = await owner('PUT', '/api/workspace', { baseVersion: held.body.version, data: pendingRileyPrep });
    assert.strictEqual(blocked.status, 409, blocked.body.error);

    assert.strictEqual((await pat('POST', '/api/portal/cancel')).status, 200);
    const cancelled = await owner('GET', '/api/workspace');
    const patRow = cancelled.body.data.clients.find(c => c.email === 'pat@signup.test');
    assert.strictEqual(patRow.status, 'cancelled');
    assert.ok(patRow.onboarding.cancelledAt);
    patRow.onboarding.contractSignedAt = '2026-10-01';
    patRow.onboarding.disclosureSignedAt = '2026-10-01';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: cancelled.body.version, data: cancelled.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.clients.find(c => c.email === 'pat@signup.test').status, 'cancelled');

    assert.strictEqual(kitCalls().length, 0, 'unchecked marketing consent does not post');
    const sam = await anon('POST', '/api/signup', { firstName: 'Sam', lastName: 'List', email: 'sam@signup.test', password: 'sam password 1', acceptAccountTerms: true, marketingConsent: true });
    assert.strictEqual(sam.status, 200);
    assert.ok(kitCalls().some(c => c.email === 'sam@signup.test' && c.path === KIT_FORM_PATH && c.formId === KIT_FORM_ID && c.mode === 'stub'));

    const news = await anon('POST', '/api/newsletter/subscribe', { email: 'reader@signup.test', firstName: 'Ree', consent: false });
    assert.strictEqual(news.status, 400);
    const beforeMail = outbox.length;
    const sub = await anon('POST', '/api/newsletter/subscribe', { email: 'reader@signup.test', firstName: 'Ree', consent: true, source: 'footer' });
    assert.strictEqual(sub.status, 200);
    assert.strictEqual(outbox.length, beforeMail, 'Kit double opt-in: our mailer does not send a confirmation');
    assert.ok(kitCalls().some(c => c.op === 'subscribe' && c.formId === KIT_FORM_ID && c.email === 'reader@signup.test'));
    const issued = built.app.locals.newsletterIssued.find(x => x.email === 'reader@signup.test');
    assert.ok(issued);
    const confirm = await anon('POST', '/api/newsletter/confirm', { token: issued.confirm });
    assert.strictEqual(confirm.status, 200);
    assert.strictEqual(confirm.body.via, 'kit');
    assert.strictEqual(outbox.length, beforeMail);
    assert.ok(kitCalls().some(c => c.op === 'confirm' && c.email === 'reader@signup.test'));
    const unsub = await anon('POST', '/api/newsletter/unsubscribe', { token: issued.unsubscribe });
    assert.strictEqual(unsub.status, 200);
    assert.strictEqual(unsub.body.unsubscribed, true);
    const unsubGet = await anon('GET', '/api/newsletter/unsubscribe?token=' + encodeURIComponent(issued.unsubscribe));
    assert.strictEqual(unsubGet.status, 200);
    assert.match(unsubGet.body, /unsubscribed/i);
    assert.strictEqual((await anon('POST', '/api/newsletter/unsubscribe', { token: 'nope' })).status, 400);
    const trap = await anon('POST', '/api/newsletter/subscribe', { email: 'trap@signup.test', consent: true, website: 'spam' });
    assert.strictEqual(trap.status, 200);
    assert.ok(!kitCalls().some(c => c.email === 'trap@signup.test'));

    const made = await riley('POST', '/api/signup', { firstName: 'Riley', lastName: 'Active', email: 'riley@signup.test', password: 'riley password 1', acceptAccountTerms: true });
    assert.strictEqual(made.status, 200);
    const rileyMail = outbox.find(m => m.to === 'riley@signup.test');
    assert.strictEqual((await riley('POST', '/api/signup/verify', { token: rileyMail.text.match(/verify=([\w-]+)/)[1] })).status, 200);
    const pre = await owner('GET', '/api/workspace');
    const rileyId = pre.body.data.clients.find(c => c.email === 'riley@signup.test').id;
    pre.body.data.disputes.push({ id: 'd-riley', clientId: rileyId, recipient: 'Experian', type: 'cra_611', round: 1, status: 'draft', items: [] });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: pre.body.version, data: pre.body.data })).status, 409);
    assert.strictEqual((await riley('POST', '/api/portal/disclosure-view')).status, 200);
    assert.strictEqual((await riley('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Riley Active', agree: true, esignConsent: true })).status, 200);
    const mid = await owner('GET', '/api/workspace');
    const row = mid.body.data.clients.find(c => c.email === 'riley@signup.test');
    assert.strictEqual(row.status, 'contract-signed');
    row.onboarding.disclosureSignedAt = '2026-10-01';
    row.onboarding.contractSignedAt = '2026-10-01';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: mid.body.version, data: mid.body.data })).status, 200);
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.clients.find(c => c.email === 'riley@signup.test').status, 'active');
    after.body.data.disputes.push({ id: 'd-riley-ok', clientId: rileyId, recipient: 'Experian', type: 'cra_611', round: 1, status: 'draft', items: [] });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: after.body.version, data: after.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.invoices.length, 0);

    const rate = createApp({ dataDir: rateDir, encryptionKey: 'signup-rate-key-not-a-secret', signupRateLimit: 3 });
    const rateLive = listen(rate.app);
    rateServer = rateLive.server;
    const hit = rateLive.client();
    let last;
    for (let i = 0; i < 4; i++) last = await hit('POST', '/api/signup', { email: 'x' });
    assert.strictEqual(last.status, 429);
    rate.shutdown();

    const magic = createApp({ dataDir: magicDir, encryptionKey: 'signup-magic-key-not-a-secret', clientAuthMethod: 'magic_link' });
    const magicLive = listen(magic.app);
    magicServer = magicLive.server;
    const magicBox = [];
    setTransport(async m => { magicBox.push(m); });
    const who = magicLive.client();
    assert.strictEqual((await who('GET', '/api/auth/options')).body.clientAuthMethod, 'magic_link');
    assert.strictEqual((await who('POST', '/api/setup', { name: 'Owner', email: 'owner@magic.test', password: 'owner password 1' })).status, 200);
    const joined = await who('POST', '/api/signup', { firstName: 'Link', lastName: 'User', email: 'link@signup.test', acceptAccountTerms: true });
    assert.strictEqual(joined.status, 200);
    const linkMail = magicBox.find(m => m.to === 'link@signup.test');
    assert.match(linkMail.text, /sign in/i);
    assert.match(linkMail.text, /2230 Route 70 West/);
    const session = magicLive.client();
    assert.strictEqual((await session('POST', '/api/signup/verify', { token: linkMail.text.match(/verify=([\w-]+)/)[1] })).status, 200);
    assert.strictEqual((await session('GET', '/api/portal/me')).body.client.name, 'Link User');
    assert.strictEqual((await who('POST', '/api/login', { email: 'link@signup.test', password: 'long password 1' })).status, 401);
    assert.strictEqual((await who('POST', '/api/auth/magic', { email: 'link@signup.test' })).status, 200);
    const magicTok = magicBox.filter(m => m.to === 'link@signup.test').pop().text.match(/magic=([\w-]+)/)[1];
    const viaLink = magicLive.client();
    assert.strictEqual((await viaLink('POST', '/api/auth/magic/verify', { token: magicTok })).status, 200);
    assert.strictEqual((await viaLink('GET', '/api/portal/me')).status, 200);
    magic.shutdown();
  } finally {
    globalThis.fetch = realFetch;
    setTransport(null);
    resetKitCalls();
    server.close();
    if (rateServer) rateServer.close();
    if (magicServer) magicServer.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(rateDir, { recursive: true, force: true });
    fs.rmSync(magicDir, { recursive: true, force: true });
  }
});
