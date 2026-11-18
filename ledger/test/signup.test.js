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
import { kitCalls, resetKitCalls, setKitFetch, postKitForm, KIT_FORM_ID, KIT_FORM_PATH } from '../server/kit-hook.js';
import { Law } from '../server/shared.js';
import { CLIENT_AUTH_METHOD } from '../server/auth-method.js';
import { applySignupStatus } from '../server/signup-status.js';
import { DEV_PUBLIC_BASE_URL } from '../server/public-url.js';
import { cancellationWindow } from '../server/croa-window.js';

delete process.env.KIT_API_KEY;
delete process.env.LEDGER_MAIL_MODE;

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('final CROA texts are served as written and still block signing on owner brackets', () => {
  const disclosure = read('legal/croa-disclosure-1679c.md');
  const contract = read('legal/croa-contract-1679d.md');
  const cancel = read('legal/croa-cancellation-1679e.md');
  const esign = read('legal/esign-consent-7001c.md');
  assert.ok(disclosure.startsWith('Consumer Credit File Rights Under State and Federal Law'));
  assert.match(disclosure, /reported for 10 years/);
  assert.doesNotMatch(disclosure, /PLACEHOLDER|PENDING COMPLIANCE REVIEW/);
  assert.match(contract, /Credit Services Agreement/);
  assert.match(cancel, /You may cancel this contract, without any penalty or obligation/);
  assert.match(esign, /Consent to Electronic Records/);
  for (const text of [disclosure, contract, cancel, esign]) {
    assert.match(text, /\[[^\]]+\]/);
    assert.doesNotMatch(text, /2230 Route 70/);
    assert.doesNotMatch(text, /Cherry Hill/);
  }
  assert.ok(!fs.existsSync(path.join(root, 'legal/PLACEHOLDER-croa-disclosure.md')));
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
  assert.match(page, /may include offers/);
  assert.doesNotMatch(page, /name="marketingConsent"[^>]*\bchecked\b/);
  assert.match(page, /name="website"/);
  assert.match(page, /href="\/signup\/terms"/);
  assert.doesNotMatch(page, /href="\/terms"/);
  const apply = read('apply.html');
  assert.doesNotMatch(apply, /name="phone"/);
  assert.doesNotMatch(apply, /sms|consultation/i);
  assert.doesNotMatch(apply, /href="\/checkout"|href="\/pricing"|href="\/refund-policy"/);
  const terms = read('legal/PLACEHOLDER-client-terms.md');
  assert.match(terms, /PLACEHOLDER FOR COMPLIANCE REVIEW/);
  assert.match(terms, /PENDING/);
  const list = read('js/ui.js');
  assert.match(list, /pending:/);
  assert.match(list, /contract-signed/);
});

test('applySignupStatus only advances pending and contract-signed', () => {
  const paused = { signupSource: 'self', status: 'paused', onboarding: { disclosureAcknowledgedAt: '2026-10-01T00:00:00.000Z', contractSignedAt: '2026-10-01', cancellationWindowEndsAt: '2026-10-06' } };
  assert.strictEqual(applySignupStatus(paused, '2026-11-18'), false);
  assert.strictEqual(paused.status, 'paused');
  assert.strictEqual(paused.onboarding.cancellationWindowEndsAt, '2026-10-06');
  const already = { signupSource: 'self', status: 'active', onboarding: {} };
  assert.strictEqual(applySignupStatus(already, '2026-11-18'), false);
  assert.strictEqual(already.status, 'active');
  const open = { signupSource: 'self', status: 'pending', onboarding: { disclosureAcknowledgedAt: '2026-11-18T00:00:00.000Z', contractSignedAt: '2026-11-18' } };
  applySignupStatus(open, '2026-11-18');
  assert.strictEqual(open.status, 'contract-signed');
  const ready = { signupSource: 'self', status: 'contract-signed', onboarding: { disclosureAcknowledgedAt: '2026-10-01T00:00:00.000Z', contractSignedAt: '2026-10-01' } };
  applySignupStatus(ready, '2026-11-18');
  assert.strictEqual(ready.status, 'active');
  const waiting = { signupSource: 'self', status: 'contract-signed', onboarding: { contractSignedAt: '2026-10-01' } };
  applySignupStatus(waiting, '2026-11-18');
  assert.strictEqual(waiting.status, 'contract-signed');
});

function listen(app) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    const jar = {};
    const f = async (method, url, body, headers = {}) => {
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      const r = await fetch(base + url, { method, redirect: 'manual', headers: Object.assign({ cookie }, headers, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
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
  const built = createApp({ dataDir: dir, encryptionKey: 'signup-test-key-not-a-secret', selfSignupEnabled: true, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } });
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

    const bad = await anon('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'nope', password: 'long password 1', acceptAccountTerms: true, state: 'NJ', njResident: true });
    assert.strictEqual(bad.status, 400);
    const short = await anon('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'a@signup.test', password: 'short', acceptAccountTerms: true, state: 'NJ', njResident: true });
    assert.strictEqual(short.status, 400);
    const terms = await anon('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'a@signup.test', password: 'long password 1', acceptAccountTerms: false });
    assert.strictEqual(terms.status, 400);

    const honey = await anon('POST', '/api/signup', { firstName: 'Bot', lastName: 'Bot', email: 'bot@signup.test', password: 'long password 1', acceptAccountTerms: true, state: 'NJ', njResident: true, website: 'http://spam.test' });
    assert.strictEqual(honey.status, 200);
    assert.deepStrictEqual(honey.body, SIGNUP_OK);

    const created = await pat('POST', '/api/signup', { firstName: 'Pat', lastName: 'Example', email: 'pat@signup.test', password: 'pat password 1', acceptAccountTerms: true, state: 'NJ', njResident: true, marketingConsent: false }, { host: 'evil.test' });
    assert.strictEqual(created.status, 200);
    assert.deepStrictEqual(created.body, SIGNUP_OK);
    assert.deepStrictEqual(created.body, honey.body);
    const again = await anon('POST', '/api/signup', { firstName: 'Pat', lastName: 'Example', email: 'pat@signup.test', password: 'other password 99', acceptAccountTerms: true, state: 'NJ', njResident: true });
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
    assert.match(mail.text, new RegExp(DEV_PUBLIC_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/portal#verify='));
    assert.doesNotMatch(mail.text, /evil\.test/);
    const token = mail.text.match(/verify=([\w-]+)/)[1];
    assert.ok(!JSON.stringify(built.db.data.authTokens).includes(token), 'verify token is stored hashed');
    assert.strictEqual((await pat('POST', '/api/signup/verify', { token })).status, 200);
    const patUser = built.db.data.users.find(u => u.email === 'pat@signup.test');
    patUser.emailVerifiedAt = null;
    assert.strictEqual((await pat('GET', '/api/portal/notifications')).status, 403);
    assert.strictEqual((await pat('PUT', '/api/portal/notifications', { email: false })).status, 403);
    assert.strictEqual((await pat('POST', '/api/portal/files')).status, 403);
    assert.strictEqual((await pat('GET', '/api/portal/coach')).status, 403);
    assert.strictEqual((await pat('POST', '/api/portal/coach/chat', { message: 'hi' })).status, 403);
    patUser.emailVerifiedAt = new Date().toISOString();
    assert.strictEqual((await pat('POST', '/api/signup/verify', { token })).status, 400, 'single use');
    assert.strictEqual((await pat('POST', '/api/login', { email: 'pat@signup.test', password: 'pat password 1' })).status, 200);

    const pageOn = await anon('GET', '/signup');
    assert.strictEqual(pageOn.status, 200);
    assert.match(pageOn.body, /href="\/signup\/terms"/);
    const termsPage = await anon('GET', '/signup/terms');
    assert.strictEqual(termsPage.status, 200);
    assert.match(termsPage.body, /PLACEHOLDER FOR COMPLIANCE REVIEW/);

    const early = await pat('POST', '/api/portal/sign', { doc: 'disclosure', typedName: 'Pat Example', agree: true });
    assert.strictEqual(early.status, 503);
    assert.match(early.body.error, /not open yet/i);
    const viewed = await pat('POST', '/api/portal/disclosure-view');
    assert.strictEqual(viewed.status, 200);
    assert.match(viewed.body.disclosureViewedAt, /T/);
    let patOn = (await owner('GET', '/api/workspace')).body.data.clients.find(c => c.email === 'pat@signup.test').onboarding;
    assert.strictEqual(patOn.disclosureSignedAt, undefined);
    assert.strictEqual(patOn.disclosureAcknowledgedAt, undefined);
    const blockedSign = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true });
    assert.strictEqual(blockedSign.status, 503);
    assert.match(blockedSign.body.error, /not open yet/i);
    const me = await pat('GET', '/api/portal/me');
    assert.ok(me.body.documents.disclosure.startsWith('Consumer Credit File Rights Under State and Federal Law'));
    assert.match(me.body.documents.contract, /\[PRICE\]/);
    assert.doesNotMatch(me.body.documents.contract, /Cherry Hill/);
    assert.match(me.body.documents.cancellation, /You may cancel this contract, without any penalty or obligation/);
    assert.strictEqual(me.body.client.status, 'pending');
    assert.strictEqual(me.body.croa.disclosureAcknowledged, false);
    assert.strictEqual(me.body.croa.disclosureSigned, false);
    assert.strictEqual(me.body.croa.enrollmentClosed, true);
    const consent = await pat('POST', '/api/portal/esign/consent', { agree: true, code: 'ABC123' });
    assert.strictEqual(consent.status, 503);

    const held = await owner('GET', '/api/workspace');
    const patClient = held.body.data.clients.find(c => c.email === 'pat@signup.test');
    held.body.data.disputes.push({ id: 'd-pat', clientId: patClient.id, recipient: 'Equifax', type: 'cra_611', round: 1, status: 'draft', items: [] });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: held.body.version, data: held.body.data })).status, 409);
    const openWin = await owner('GET', '/api/workspace');
    const patOpen = openWin.body.data.clients.find(c => c.email === 'pat@signup.test');
    patOpen.onboarding.contractSignedAt = new Date().toISOString().slice(0, 10);
    patOpen.onboarding.contractSignedAtTs = new Date().toISOString();
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: openWin.body.version, data: openWin.body.data })).status, 200);
    const signedRow = (await owner('GET', '/api/workspace')).body.data.clients.find(c => c.email === 'pat@signup.test');
    assert.strictEqual(signedRow.status, 'contract-signed');
    assert.notStrictEqual(signedRow.status, 'active');
    assert.strictEqual(signedRow.onboarding.cancellationWindowEndsAt, cancellationWindow(signedRow.onboarding.contractSignedAtTs).deadlineDateEt);
    assert.strictEqual((await pat('POST', '/api/portal/cancel')).status, 200);
    const cancelled = await owner('GET', '/api/workspace');
    const patRow = cancelled.body.data.clients.find(c => c.email === 'pat@signup.test');
    assert.strictEqual(patRow.status, 'cancelled');
    patRow.onboarding.contractSignedAt = '2026-10-01';
    patRow.status = 'paused';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: cancelled.body.version, data: cancelled.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.clients.find(c => c.email === 'pat@signup.test').status, 'paused');

    assert.strictEqual(kitCalls().length, 0, 'unchecked marketing consent does not post');
    const sam = await anon('POST', '/api/signup', { firstName: 'Sam', lastName: 'List', email: 'sam@signup.test', password: 'sam password 1', acceptAccountTerms: true, state: 'NJ', njResident: true, marketingConsent: true });
    assert.strictEqual(sam.status, 200);
    assert.ok(kitCalls().some(c => c.email === 'sam@signup.test' && c.path === KIT_FORM_PATH && c.formId === KIT_FORM_ID && c.mode === 'stub'));

    const news = await anon('POST', '/api/newsletter/subscribe', { email: 'reader@signup.test', firstName: 'Ree', consent: false });
    assert.strictEqual(news.status, 400);
    const beforeMail = outbox.length;
    const sub = await anon('POST', '/api/newsletter/subscribe', { email: 'reader@signup.test', firstName: 'Ree', consent: true, source: 'footer' });
    assert.strictEqual(sub.status, 200);
    assert.strictEqual(outbox.length, beforeMail, 'Kit double opt-in: our mailer does not send a confirmation');
    assert.ok(kitCalls().some(c => c.op === 'subscribe' && c.formId === KIT_FORM_ID && c.email === 'reader@signup.test'));
    const issued = kitCalls().find(c => c.email === 'reader@signup.test');
    assert.ok(issued);
    const confirm = await anon('POST', '/api/newsletter/confirm', {});
    assert.strictEqual(confirm.status, 501);
    const unsub = await anon('POST', '/api/newsletter/unsubscribe', { email: 'reader@signup.test' });
    assert.strictEqual(unsub.status, 501);
    assert.strictEqual(unsub.body.unsubscribed, undefined);
    const unsubGet = await anon('GET', '/api/newsletter/unsubscribe');
    assert.strictEqual(unsubGet.status, 405);
    const trap = await anon('POST', '/api/newsletter/subscribe', { email: 'trap@signup.test', consent: true, website: 'spam' });
    assert.strictEqual(trap.status, 200);
    assert.ok(!kitCalls().some(c => c.email === 'trap@signup.test'));

    const made = await riley('POST', '/api/signup', { firstName: 'Riley', lastName: 'Active', email: 'riley@signup.test', password: 'riley password 1', acceptAccountTerms: true, state: 'NJ', njResident: true });
    assert.strictEqual(made.status, 200);
    const rileyMail = outbox.find(m => m.to === 'riley@signup.test');
    assert.strictEqual((await riley('POST', '/api/signup/verify', { token: rileyMail.text.match(/verify=([\w-]+)/)[1] })).status, 200);
    const pre = await owner('GET', '/api/workspace');
    const rileyId = pre.body.data.clients.find(c => c.email === 'riley@signup.test').id;
    pre.body.data.disputes.push({ id: 'd-riley', clientId: rileyId, recipient: 'Experian', type: 'cra_611', round: 1, status: 'draft', items: [] });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: pre.body.version, data: pre.body.data })).status, 409);
    assert.strictEqual((await riley('POST', '/api/portal/disclosure-view')).status, 200);
    assert.strictEqual((await riley('POST', '/api/portal/sign', { doc: 'disclosure', typedName: 'Riley Active', agree: true })).status, 503);
    const mid = await owner('GET', '/api/workspace');
    const row = mid.body.data.clients.find(c => c.email === 'riley@signup.test');
    assert.strictEqual(row.status, 'pending');
    assert.strictEqual(row.onboarding.disclosureSignedAt, undefined);
    row.onboarding.contractSignedAt = '2026-10-01';
    row.onboarding.contractSignedAtTs = '2026-10-01T15:00:00.000Z';
    row.status = 'paused';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: mid.body.version, data: mid.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.clients.find(c => c.email === 'riley@signup.test').status, 'paused');
    const promote = await owner('GET', '/api/workspace');
    const promoteRow = promote.body.data.clients.find(c => c.email === 'riley@signup.test');
    promoteRow.onboarding.disclosureAcknowledgedAt = '2026-10-01T15:00:00.000Z';
    promoteRow.status = 'pending';
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: promote.body.version, data: promote.body.data })).status, 200);
    const after = await owner('GET', '/api/workspace');
    assert.strictEqual(after.body.data.clients.find(c => c.email === 'riley@signup.test').status, 'active');
    after.body.data.disputes.push({ id: 'd-riley-ok', clientId: rileyId, recipient: 'Experian', type: 'cra_611', round: 1, status: 'draft', items: [] });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: after.body.version, data: after.body.data })).status, 200);
    assert.strictEqual((await owner('GET', '/api/workspace')).body.data.invoices.length, 0);

    const rate = createApp({ dataDir: rateDir, encryptionKey: 'signup-rate-key-not-a-secret', signupRateLimit: 3, selfSignupEnabled: true, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } });
    const rateLive = listen(rate.app);
    rateServer = rateLive.server;
    const hit = rateLive.client();
    let last;
    for (let i = 0; i < 4; i++) last = await hit('POST', '/api/signup', { email: 'x' });
    assert.strictEqual(last.status, 429);
    rate.shutdown();

    const magic = createApp({ dataDir: magicDir, encryptionKey: 'signup-magic-key-not-a-secret', clientAuthMethod: 'magic_link', selfSignupEnabled: true, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } });
    const magicLive = listen(magic.app);
    magicServer = magicLive.server;
    const magicBox = [];
    setTransport(async m => { magicBox.push(m); });
    const who = magicLive.client();
    assert.strictEqual((await who('GET', '/api/auth/options')).body.clientAuthMethod, 'magic_link');
    assert.strictEqual((await who('POST', '/api/setup', { name: 'Owner', email: 'owner@magic.test', password: 'owner password 1' })).status, 200);
    const joined = await who('POST', '/api/signup', { firstName: 'Link', lastName: 'User', email: 'link@signup.test', acceptAccountTerms: true, state: 'NJ', njResident: true });
    assert.strictEqual(joined.status, 200);
    const linkMail = magicBox.find(m => m.to === 'link@signup.test');
    assert.match(linkMail.text, /sign in/i);
    assert.match(linkMail.text, /2230 Route 70 West/);
    const session = magicLive.client();
    assert.strictEqual((await session('POST', '/api/signup/verify', { token: linkMail.text.match(/verify=([\w-]+)/)[1] })).status, 200);
    assert.strictEqual((await session('GET', '/api/portal/me')).body.client.name, 'Link User');
    assert.strictEqual((await who('POST', '/api/login', { email: 'link@signup.test', password: 'long password 1' })).status, 401);
    assert.strictEqual((await who('POST', '/api/auth/magic', { email: 'owner@magic.test' })).status, 200);
    assert.ok(!magicBox.some(m => m.to === 'owner@magic.test' && /magic=/.test(m.text)), 'magic_link switch does not mail staff or the owner');
    assert.strictEqual((await who('POST', '/api/auth/magic', { email: 'link@signup.test' })).status, 200);
    const magicTok = magicBox.filter(m => m.to === 'link@signup.test').pop().text.match(/magic=([\w-]+)/)[1];
    const viaLink = magicLive.client();
    assert.strictEqual((await viaLink('POST', '/api/auth/magic/verify', { token: magicTok })).status, 200);
    assert.strictEqual((await viaLink('GET', '/api/portal/me')).status, 200);
    let kitHit = 0;
    setKitFetch(async () => { kitHit += 1; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); });
    await postKitForm({ email: 'live@signup.test' }, { KIT_API_KEY: 'kit_test_key', LEDGER_MAIL_MODE: 'off' });
    assert.strictEqual(kitHit, 0, 'mail mode off never calls Kit');
    await postKitForm({ email: 'live@signup.test' }, { KIT_API_KEY: 'kit_test_key', LEDGER_MAIL_MODE: 'console' });
    assert.strictEqual(kitHit, 1);
    setKitFetch(null);
    magic.shutdown();
  } finally {
    globalThis.fetch = realFetch;
    setTransport(null);
    setKitFetch(null);
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

test('self-signup routes stay closed when the flag is off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-signup-off-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'signup-off-key-not-a-secret' });
  const { server, client } = listen(built.app);
  const anon = client();
  try {
    assert.strictEqual((await anon('GET', '/signup')).status, 404);
    assert.strictEqual((await anon('GET', '/signup/terms')).status, 404);
    const closed = await anon('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'a@signup.test', password: 'long password 1', acceptAccountTerms: true, state: 'NJ', njResident: true });
    assert.strictEqual(closed.status, 404);
    assert.match(closed.body.error, /disabled/i);
    assert.match((await anon('GET', '/signup')).body, /disabled/i);
  } finally {
    server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('production PUBLIC_BASE_URL: unset and http disable signup; https is used in the verify link', async () => {
  const { readPublicBaseUrl, resolveSignupAccess } = await import('../server/public-url.js');
  assert.strictEqual(readPublicBaseUrl({ NODE_ENV: 'production' }), '');
  assert.strictEqual(readPublicBaseUrl({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://ledger.example' }), 'http://ledger.example');
  assert.strictEqual(readPublicBaseUrl({ NODE_ENV: 'test' }), DEV_PUBLIC_BASE_URL);
  assert.strictEqual(resolveSignupAccess({ env: { NODE_ENV: 'production' }, signupRequested: true }).enabled, false);
  assert.match(resolveSignupAccess({ env: { NODE_ENV: 'production' }, signupRequested: true }).warning, /not set/);
  assert.strictEqual(resolveSignupAccess({ env: { NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://ledger.example' }, signupRequested: true }).enabled, false);
  assert.match(resolveSignupAccess({ env: { NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://ledger.example' }, signupRequested: true }).warning, /https/);
  assert.strictEqual(resolveSignupAccess({ env: { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://ledger.example' }, signupRequested: true }).enabled, true);
  assert.strictEqual(resolveSignupAccess({ env: { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://ledger.example' }, signupRequested: true }).warning, '');

  async function boot(env, publicBaseUrl) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pub-url-'));
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
    let built;
    try {
      built = createApp({ dataDir: dir, encryptionKey: 'pub-url-key-not-a-secret-00', selfSignupEnabled: true, env, publicBaseUrl });
    } finally {
      console.warn = orig;
    }
    const live = listen(built.app);
    return { dir, warnings, built, ...live };
  }

  const unset = await boot({ NODE_ENV: 'production', LEDGER_SELF_SIGNUP_ENABLED: 'true' });
  const http = await boot({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://ledger.example', LEDGER_SELF_SIGNUP_ENABLED: 'true' });
  const https = await boot({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://ledger.example', LEDGER_SELF_SIGNUP_ENABLED: 'true' });
  const outbox = [];
  setTransport(async m => { outbox.push(m); });
  try {
    for (const app of [unset, http]) {
      const anon = app.client();
      const page = await anon('GET', '/signup');
      const post = await anon('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'a@signup.test', password: 'long password 1', acceptAccountTerms: true, state: 'NJ', njResident: true });
      assert.strictEqual(page.status, 404);
      assert.match(page.body, /disabled/i);
      assert.strictEqual(post.status, 404);
      assert.match(post.body.error, /disabled/i);
    }
    assert.ok(unset.warnings.some(w => /not set/i.test(w)));
    assert.ok(http.warnings.some(w => /https/i.test(w)));
    assert.deepStrictEqual(https.warnings, []);
    const anon = https.client();
    assert.strictEqual((await anon('GET', '/signup')).status, 200);
    const created = await anon('POST', '/api/signup', { firstName: 'Ada', lastName: 'Https', email: 'ada@signup.test', password: 'ada password 1', acceptAccountTerms: true, state: 'NJ', njResident: true }, { host: 'evil.test' });
    assert.strictEqual(created.status, 200);
    const mail = outbox.find(m => m.to === 'ada@signup.test');
    assert.match(mail.text, /https:\/\/ledger\.example\/portal#verify=/);
    assert.doesNotMatch(mail.text, /127\.0\.0\.1|evil\.test/);
  } finally {
    setTransport(null);
    for (const app of [unset, http, https]) {
      app.server.close();
      app.built.shutdown();
      fs.rmSync(app.dir, { recursive: true, force: true });
    }
  }
});

test('cancellation window skips weekends and observed holidays in Eastern time', () => {
  const evening = cancellationWindow('2026-11-19T02:00:00.000Z');
  assert.strictEqual(evening.signingDateEt, '2026-11-18');
  assert.strictEqual(evening.deadlineDateEt, '2026-11-23');
  assert.strictEqual(evening.deadlineInstant.toISOString(), '2026-11-24T04:59:59.999Z');
  const july = cancellationWindow('2026-07-02T16:00:00.000Z');
  assert.strictEqual(july.deadlineDateEt, '2026-07-08');
  const yearEnd = cancellationWindow('2027-12-29T17:00:00.000Z');
  assert.strictEqual(yearEnd.signingDateEt, '2027-12-29');
  assert.notStrictEqual(yearEnd.deadlineDateEt, '2028-01-01');
  assert.strictEqual(yearEnd.deadlineDateEt, '2028-01-04');
  assert.strictEqual(yearEnd.deadlineInstant.toISOString(), '2028-01-05T04:59:59.999Z');
  const justAfter = cancellationWindow('2026-11-18T17:00:00.000Z', new Date('2026-11-24T05:00:00.000Z'));
  assert.strictEqual(justAfter.open, false);
  const onTheInstant = cancellationWindow('2026-11-18T17:00:00.000Z', new Date('2026-11-24T04:59:59.999Z'));
  assert.strictEqual(onTheInstant.open, true);
});

test('contract package PDF bolds the cancellation sentence and repeats the notice', async () => {
  const { buildContractPackagePdf } = await import('../server/enrollment-pdf.js');
  const built = buildContractPackagePdf({
    clientName: 'Pat Example',
    signedLabel: 'November 18, 2026',
    deadlineLabel: 'November 23, 2026 at 11:59 PM ET',
    contract: 'Services are described here.',
    notice: '**Notice of Cancellation**\n\nYou may cancel this contract, without any penalty or obligation, at any time before midnight of the 3rd day which begins after the date the contract is signed by you.\n\nTo cancel this contract, mail or deliver a signed, dated copy of this cancellation notice, or any other written notice before midnight on [DATE: Weekday, Month D, YYYY]\n\n[date]\n\n[purchaser\'s signature]'
  });
  const text = Buffer.from(built.pdf).toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/F2 10 Tf/);
  assert.match(text, /You may cancel this contract without penalty or obligation/);
  assert.ok(!text.includes('[DATE:'));
  assert.ok(text.includes('Pat Example'));
  const notices = text.split('Notice of Cancellation').length - 1;
  assert.ok(notices >= 2);
});

