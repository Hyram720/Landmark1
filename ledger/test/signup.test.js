// Public self-signup, CROA gating, and Kit newsletter hook.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { setTransport } from '../server/mailer.js';
import { verifyPassword, hashPassword } from '../server/auth.js';
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
    f.jar = jar;
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
    assert.match(early.body.error, /mailing address is needed/i);
    const viewed = await pat('POST', '/api/portal/disclosure-view');
    assert.strictEqual(viewed.status, 200);
    assert.match(viewed.body.disclosureViewedAt, /T/);
    let patOn = (await owner('GET', '/api/workspace')).body.data.clients.find(c => c.email === 'pat@signup.test').onboarding;
    assert.strictEqual(patOn.disclosureSignedAt, undefined);
    assert.strictEqual(patOn.disclosureAcknowledgedAt, undefined);
    const blockedSign = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true });
    assert.strictEqual(blockedSign.status, 503);
    assert.match(blockedSign.body.error, /mailing address is needed/i);
    const me = await pat('GET', '/api/portal/me');
    assert.strictEqual(me.body.documents.disclosure, '');
    assert.strictEqual(me.body.documents.contract, '');
    assert.strictEqual(me.body.documents.cancellation, '');
    assert.match(me.body.documents.esign, /Consent to Electronic Records/);
    assert.doesNotMatch(me.body.documents.esign, /Cherry Hill/);
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
  assert.strictEqual(readPublicBaseUrl({ RAILWAY_ENVIRONMENT: 'production' }), '');
  assert.strictEqual(readPublicBaseUrl({ RAILWAY_ENVIRONMENT_NAME: 'staging' }), '');
  assert.strictEqual(resolveSignupAccess({ env: { RAILWAY_ENVIRONMENT: 'production' }, signupRequested: true }).enabled, false);
  assert.match(resolveSignupAccess({ env: { RAILWAY_ENVIRONMENT: 'production' }, signupRequested: true }).warning, /not set/);
  assert.strictEqual(resolveSignupAccess({ env: { RAILWAY_ENVIRONMENT_NAME: 'production', PUBLIC_BASE_URL: 'http://ledger.example' }, signupRequested: true }).enabled, false);
  assert.match(resolveSignupAccess({ env: { RAILWAY_ENVIRONMENT_NAME: 'production', PUBLIC_BASE_URL: 'http://ledger.example' }, signupRequested: true }).warning, /https/);
  assert.strictEqual(resolveSignupAccess({ env: { RAILWAY_ENVIRONMENT: 'production', PUBLIC_BASE_URL: 'https://ledger.example' }, signupRequested: true }).enabled, true);
  assert.strictEqual(resolveSignupAccess({ env: { NODE_ENV: 'test', RAILWAY_ENVIRONMENT: 'production' }, signupRequested: true }).enabled, false);
  assert.strictEqual(resolveSignupAccess({ env: { NODE_ENV: 'development', RAILWAY_ENVIRONMENT_NAME: 'production', PUBLIC_BASE_URL: 'http://ledger.example' }, signupRequested: true }).enabled, false);
  assert.match(resolveSignupAccess({ env: { NODE_ENV: 'development', RAILWAY_ENVIRONMENT: 'production', PUBLIC_BASE_URL: 'http://ledger.example' }, signupRequested: true }).warning, /https/);
  assert.strictEqual(resolveSignupAccess({ env: { NODE_ENV: 'development', PUBLIC_BASE_URL: 'http://ledger.example' }, signupRequested: true }).enabled, true);

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
  const railway = await boot({ RAILWAY_ENVIRONMENT: 'production', LEDGER_SELF_SIGNUP_ENABLED: 'true' });
  const railwayHttp = await boot({ RAILWAY_ENVIRONMENT_NAME: 'production', PUBLIC_BASE_URL: 'http://ledger.example', LEDGER_SELF_SIGNUP_ENABLED: 'true' });
  const railwayDev = await boot({ NODE_ENV: 'development', RAILWAY_ENVIRONMENT: 'production', PUBLIC_BASE_URL: 'http://ledger.example', LEDGER_SELF_SIGNUP_ENABLED: 'true' });
  const outbox = [];
  setTransport(async m => { outbox.push(m); });
  try {
    for (const app of [unset, http, railway, railwayHttp, railwayDev]) {
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
    assert.ok(railway.warnings.some(w => /not set/i.test(w)));
    assert.ok(railwayHttp.warnings.some(w => /https/i.test(w)));
    assert.ok(railwayDev.warnings.some(w => /https/i.test(w)));
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
    for (const app of [unset, http, https, railway, railwayHttp, railwayDev]) {
      app.server.close();
      app.built.shutdown();
      fs.rmSync(app.dir, { recursive: true, force: true });
    }
  }
});

test('cancellation window skips weekends and observed holidays in Eastern time', async () => {
  const { formatDeadlineDateEt, etEndInstant } = await import('../server/croa-window.js');
  const { stampCancellationDeadline } = await import('../server/croa-docs.js');
  const evening = cancellationWindow('2026-11-19T02:00:00.000Z');
  assert.strictEqual(evening.signingDateEt, '2026-11-18');
  assert.strictEqual(evening.deadlineDateEt, '2026-11-23');
  assert.strictEqual(evening.deadlineInstant.toISOString(), '2026-11-24T04:59:59.999Z');
  assert.strictEqual(formatDeadlineDateEt(evening.deadlineInstant), 'Monday, November 23, 2026');
  const thanksgivingEve = cancellationWindow('2026-11-26T02:00:00.000Z');
  assert.strictEqual(thanksgivingEve.signingDateEt, '2026-11-25');
  assert.strictEqual(thanksgivingEve.deadlineDateEt, '2026-12-01');
  assert.strictEqual(thanksgivingEve.deadlineInstant.toISOString(), etEndInstant('2026-12-01').toISOString());
  assert.strictEqual(formatDeadlineDateEt(thanksgivingEve.deadlineInstant), 'Tuesday, December 1, 2026');
  assert.strictEqual(stampCancellationDeadline('before midnight of [DATE: Weekday, Month D, YYYY]', '2026-11-26T02:00:00.000Z'), 'before midnight of Tuesday, December 1, 2026');
  const christmasEve = cancellationWindow('2026-12-25T02:00:00.000Z');
  assert.strictEqual(christmasEve.signingDateEt, '2026-12-24');
  assert.strictEqual(christmasEve.deadlineDateEt, '2026-12-30');
  assert.strictEqual(christmasEve.deadlineInstant.toISOString(), etEndInstant('2026-12-30').toISOString());
  assert.strictEqual(formatDeadlineDateEt(christmasEve.deadlineInstant), 'Wednesday, December 30, 2026');
  assert.strictEqual(stampCancellationDeadline('before midnight of [DATE: Weekday, Month D, YYYY]', '2026-12-25T02:00:00.000Z'), 'before midnight of Wednesday, December 30, 2026');
  assert.doesNotMatch(formatDeadlineDateEt(thanksgivingEve.deadlineInstant) + formatDeadlineDateEt(christmasEve.deadlineInstant), /11:59|ET|PM/);
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
  const { buildContractPackagePdf, extractPdfText } = await import('../server/enrollment-pdf.js');
  const built = buildContractPackagePdf({
    clientName: 'Pat Example',
    signedLabel: 'November 18, 2026',
    deadlineLabel: 'Monday, November 23, 2026',
    contract: 'Services are described here.',
    notice: '**Notice of Cancellation**\n\nYou may cancel this contract, without any penalty or obligation, at any time before midnight of the 3rd day which begins after the date the contract is signed by you.\n\nTo cancel this contract, mail or deliver a signed, dated copy of this cancellation notice, or any other written notice before midnight of [DATE: Weekday, Month D, YYYY]\n\n[date]\n\n[purchaser\'s signature]'
  });
  const raw = built.pdf.toString('latin1');
  const text = extractPdfText(built.pdf).replace(/\s+/g, ' ');
  assert.match(raw, /^%PDF-1\.4/);
  assert.match(raw, /\/F2 10 Tf/);
  assert.match(text, /You may cancel this contract without penalty or obligation/);
  assert.ok(!text.includes('[DATE:'));
  assert.ok(text.includes('before midnight of Monday, November 23, 2026'));
  assert.ok(!text.includes('11:59'));
  assert.ok(!/\bET\b/.test(text));
  assert.ok(text.includes('[date]'));
  assert.ok(text.includes("[purchaser's signature]"));
  assert.ok(text.split('[date]').length - 1 >= 2);
  assert.ok(text.split("[purchaser's signature]").length - 1 >= 2);
  assert.ok(text.includes('Pat Example'));
  const notices = text.split('Notice of Cancellation').length - 1;
  assert.ok(notices >= 2);
});

test('per-client blanks can be signed, owner blanks still block, and mail failures stay private', async () => {
  const { personalizeCroaDocs, enrollmentBlocksSigning, croaDocs, documentBlocksSigning, enrollmentStatus, mailingAddress } = await import('../server/croa-docs.js');
  const client = { name: 'Pat Example', address: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102', pricePerResult: 40, scheduleA: [{ creditor: 'Sample Bank', last4: '4242', bureau: 'Equifax' }] };
  const onlyClient = {
    disclosure: 'Consumer Credit File Rights Under State and Federal Law\n\nI received this statement before any contract.\n',
    contract: 'Credit Services Agreement\n\nClient: [CLIENT FULL NAME]\nAddress: [CLIENT ADDRESS]\nDate of this agreement: [DATE SIGNED, filled automatically]\nSchedule A\n[ITEM / CREDITOR NAME / ACCOUNT ENDING IN LAST 4 ONLY / BUREAU(S)]\nThe most you can owe under this agreement is $[PRICE] times [NUMBER OF ITEM AND BUREAU ENTRIES IN SCHEDULE A], which is $[MAXIMUM TOTAL].\n',
    cancellation: '**Notice of Cancellation**\n\nbefore midnight of [DATE: Weekday, Month D, YYYY]\n\nI hereby cancel this transaction,\n\n[date]\n\n[purchaser\'s signature]\n',
    esign: 'Consent to Electronic Records\n\nOpen this sample PDF: [LINK TO SAMPLE PDF]. Enter the code: [______]\n\n[ ] I agree to electronic records.\n'
  };
  const filled = personalizeCroaDocs(onlyClient, client);
  assert.strictEqual(enrollmentBlocksSigning(filled), false);
  assert.match(filled.contract, /Pat Example/);
  assert.match(filled.contract, /1 Main St/);
  assert.match(filled.contract, /Sample Bank/);
  assert.match(filled.contract, /which is \$40/);
  assert.doesNotMatch(filled.contract, /\[[^\]]+\]/);
  const bare = personalizeCroaDocs(onlyClient, { name: 'Pat Example', state: 'NJ' });
  assert.match(bare.contract, /None listed yet/);
  assert.match(bare.contract, /\[MAXIMUM TOTAL\]/);
  assert.strictEqual(enrollmentBlocksSigning(bare), true);
  const two = personalizeCroaDocs(croaDocs(), { name: 'Pat Example', address: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102', pricePerResult: 40, scheduleA: [{ creditor: 'Sample Bank', last4: '4242', bureaus: ['Equifax', 'Experian'] }] });
  assert.match(two.contract, /Sample Bank \/ ending 4242 \/ Equifax/);
  assert.match(two.contract, /Sample Bank \/ ending 4242 \/ Experian/);
  assert.match(two.contract, /which is \$80/);
  assert.doesNotMatch(two.contract, /\[MAXIMUM TOTAL\]/);
  assert.strictEqual(enrollmentBlocksSigning(two), true);
  assert.match(filled.cancellation, /\[date\]/);
  assert.match(filled.cancellation, /\[purchaser's signature\]/);
  assert.match(filled.cancellation, /filled when you sign/);
  assert.doesNotMatch(filled.cancellation, /\[DATE:/);
  assert.doesNotMatch(filled.cancellation, /\d{1,2}:\d{2} [AP]M ET/);
  assert.match(filled.esign, /\/api\/portal\/esign\/sample/);
  assert.doesNotMatch(filled.esign, /\[[^\]]+\]/);
  const live = personalizeCroaDocs(croaDocs(), client);
  assert.strictEqual(enrollmentBlocksSigning(live), true);
  assert.match(live.contract, /\[LEGAL NAME/);
  assert.strictEqual(mailingAddress({ address: '1 Main St', city: 'Newark', state: 'NJ', zip: '07001' }), '1 Main St, Newark, NJ 07001');
  assert.strictEqual(mailingAddress({ address: '1 Main St', city: 'Newark', state: 'NJ', zip: '08999' }), '1 Main St, Newark, NJ 08999');
  assert.strictEqual(mailingAddress({ address: '1 Main St', city: 'Newark', state: 'NJ', zip: '06999' }), '');
  assert.strictEqual(mailingAddress({ address: '1 Main St', city: 'Newark', state: 'PA', zip: '19103' }), '');
  assert.strictEqual(enrollmentStatus({ state: 'NJ' }, { contract: 'x' }).message, 'Your mailing address is needed: street, city, ZIP.');
  assert.strictEqual(enrollmentStatus({ address: '1 Broad St', city: 'Philadelphia', state: 'PA', zip: '19103' }, { contract: 'x' }).message, 'Credit Ledger serves New Jersey residents. Enter a New Jersey address. Check the state and ZIP.');
  assert.strictEqual(enrollmentStatus({ address: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102' }, { contract: 'x' }).message, 'Your Credit Ledger specialist still needs to add your items and price');
  assert.strictEqual(enrollmentStatus(client, { contract: '[LEGAL NAME, Fred to decide]' }).message, 'Enrollment is not open yet');
  assert.strictEqual(documentBlocksSigning('Terms. [PRICE PER RESULT: Fred to decide].'), true);
  assert.strictEqual(documentBlocksSigning('PLACEHOLDER still here'), true);
  assert.strictEqual(documentBlocksSigning('PENDING COMPLIANCE REVIEW'), true);
  assert.strictEqual(documentBlocksSigning(filled.cancellation), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-signable-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'signable-key-not-a-secret', selfSignupEnabled: true, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' }, croaDocs: onlyClient });
  const { server, client: makeClient } = listen(built.app);
  const pat = makeClient();
  const logs = [];
  const mailed = [];
  const origErr = console.error;
  console.error = (...args) => { logs.push(args.map(String).join(' ')); };
  setTransport(async m => {
    mailed.push(m);
    if (/^Your /.test(m.subject)) throw Object.assign(new Error('mailbox down for ' + m.to), { code: 'EFAIL' });
  });
  try {
    assert.strictEqual((await pat('POST', '/api/signup', { firstName: 'Pat', lastName: 'Example', email: 'pat-sign@signup.test', password: 'pat password 1', acceptAccountTerms: true, state: 'NJ', njResident: true })).status, 200);
    const user = built.db.data.users.find(u => u.email === 'pat-sign@signup.test');
    user.emailVerifiedAt = new Date().toISOString();
    assert.strictEqual((await pat('POST', '/api/login', { email: 'pat-sign@signup.test', password: 'pat password 1' })).status, 200);
    const hidden = await pat('GET', '/api/portal/me');
    assert.strictEqual(hidden.body.documents.disclosure, '');
    assert.strictEqual(hidden.body.documents.contract, '');
    assert.strictEqual(hidden.body.documents.cancellation, '');
    assert.match(hidden.body.documents.esign, /Consent to Electronic Records/);
    assert.strictEqual((await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true })).status, 503);
    const row = built.db.data.workspace.clients.find(c => c.email === 'pat-sign@signup.test');
    row.address = '1 Main St';
    row.city = 'Newark';
    row.zip = '07102';
    row.pricePerResult = 40;
    row.scheduleA = [{ creditor: 'Sample Bank', last4: '4242', bureaus: ['Equifax', 'Experian'] }];
    const stillHidden = await pat('GET', '/api/portal/me');
    assert.strictEqual(stillHidden.body.documents.contract, '');
    const sample = await pat('GET', '/api/portal/esign/sample');
    const code = sample.body.match(/Your code is ([A-F0-9]{6})/);
    assert.ok(code, 'sample PDF shows a code');
    assert.strictEqual((await pat('POST', '/api/portal/esign/consent', { agree: true, code: code[1] })).status, 200);
    const shown = await pat('GET', '/api/portal/me');
    assert.match(shown.body.documents.contract, /1 Main St/);
    assert.match(shown.body.documents.contract, /Sample Bank \/ ending 4242 \/ Experian/);
    assert.match(shown.body.documents.contract, /which is \$80/);
    assert.doesNotMatch(shown.body.documents.contract, /\[MAXIMUM TOTAL\]|None listed yet/);
    assert.strictEqual((await pat('POST', '/api/portal/disclosure-view')).status, 200);
    const disclosure = await pat('POST', '/api/portal/sign', { doc: 'disclosure', typedName: 'Pat Example', agree: true });
    assert.strictEqual(disclosure.status, 200);
    assert.strictEqual((await pat('POST', '/api/portal/contract-view')).status, 200);
    const contract = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true });
    assert.strictEqual(contract.status, 200);
    const saved = built.db.data.workspace.signatures.filter(s => s.doc === 'disclosure' || s.doc === 'contract');
    assert.strictEqual(saved.length, 2);
    const pdf = await pat('GET', '/api/portal/signed/' + contract.body.signature.pdfId);
    assert.strictEqual(pdf.status, 200);
    assert.ok(pdf.body.includes('Sample Bank'));
    assert.ok(pdf.body.includes('$80') || pdf.body.includes('80'));
    assert.ok(pdf.body.includes('[date]'));
    assert.ok(pdf.body.includes("[purchaser's signature]"));
    assert.ok(pdf.body.split('[date]').length - 1 >= 2);
    assert.match(pdf.body, /\d{1,2}:\d{2} [AP]M ET/);
    assert.doesNotMatch(pdf.body, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.match(contract.body.signature.at, /^\d{4}-\d{2}-\d{2}T/);
    const contractMail = mailed.find(m => m.subject === 'Your signed Credit Ledger agreement');
    const disclosureMail = mailed.find(m => m.subject === 'Your Consumer Credit File Rights statement');
    assert.ok(contractMail.attachments[0].content.includes('%PDF'));
    assert.match(contractMail.text, /\battached\b/);
    assert.strictEqual(disclosureMail.attachments.length, 0);
    assert.doesNotMatch(disclosureMail.text, /attached/i);
    const logged = logs.join('\n');
    assert.match(logged, /\[mail\] disclosure copy failed \(EFAIL\)/);
    assert.match(logged, /\[mail\] contract copy failed \(EFAIL\)/);
    assert.doesNotMatch(logged, /pat-sign@signup\.test|Pat Example|mailbox down/);
  } finally {
    console.error = origErr;
    setTransport(null);
    server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('full contract PDF keeps one bold cancellation sentence, section signs, and two notices', async () => {
  const { buildContractPackagePdf, readPdfPages, CANCEL_SENTENCE } = await import('../server/enrollment-pdf.js');
  const { personalizeCroaDocs } = await import('../server/croa-docs.js');
  const { execFileSync } = await import('node:child_process');
  const contract = read('legal/croa-contract-1679d.md');
  const notice = read('legal/croa-cancellation-1679e.md');
  const client = {
    name: 'Pat Example', address: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102', pricePerResult: 40,
    scheduleA: [{ creditor: 'Sample Bank', last4: '4242', bureaus: ['Equifax', 'Experian'] }]
  };
  const docs = personalizeCroaDocs({ disclosure: '', contract, cancellation: notice, esign: '' }, client);
  const built = buildContractPackagePdf({ contract: docs.contract, notice: docs.cancellation, clientName: client.name, signedLabel: 'November 18, 2026', deadlineLabel: 'November 23, 2026' });
  const pages = readPdfPages(built.pdf);
  assert.ok(pages.length >= 3);
  pages.forEach(lines => {
    for (let i = 1; i < lines.length; i++) assert.ok(lines[i].y < lines[i - 1].y, 'lines overlap on a page');
  });
  const flat = pages.flat().map(line => line.text).join(' ').replace(/\s+/g, ' ');
  const bold = pages.flat().filter(line => line.font === 'F2').map(line => line.text).join(' ').replace(/\s+/g, ' ');
  const regular = pages.flat().filter(line => line.font === 'F1').map(line => line.text).join(' ').replace(/\s+/g, ' ');
  assert.ok(flat.includes('§'), 'section sign renders');
  assert.ok(flat.includes('1681i'));
  assert.ok(bold.includes(CANCEL_SENTENCE));
  assert.strictEqual(flat.split(CANCEL_SENTENCE).length - 1, 1);
  assert.ok(!regular.includes('You may cancel this contract without penalty or obligation'));
  assert.strictEqual(flat.split('Notice of Cancellation').length - 1, 2);
  assert.strictEqual(regular.split('Client typed name (signature):').length - 1, 1);
  assert.ok(!flat.includes('______________________'));
  assert.ok(flat.includes('Pat Example'));
  assert.ok(flat.includes('1 Main St'));
  assert.ok(flat.includes('Sample Bank / ending 4242 / Equifax'));
  assert.ok(flat.includes('which is $80'));
  assert.ok(flat.includes('[date]'));
  assert.ok(flat.includes("purchaser's signature"));
  let poppler = '';
  try { poppler = execFileSync('pdftotext', ['-layout', '-', '-'], { input: built.pdf }).toString('utf8'); } catch { poppler = ''; }
  if (poppler) {
    const collapsed = poppler.replace(/\s+/g, ' ');
    assert.ok(collapsed.includes('§'));
    assert.strictEqual(collapsed.split(CANCEL_SENTENCE).length - 1, 1);
    assert.strictEqual(collapsed.split('Notice of Cancellation').length - 1, 2);
    assert.ok(collapsed.includes('which is $80'));
  }
});

test('uploads stay open while report AI and staff chat wait for the cancellation window', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-ai-hold-'));
  const built = createApp({ dataDir: dir, encryptionKey: 'ai-hold-key-not-a-secret', selfSignupEnabled: true, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' } });
  const { server, base, client: makeClient } = listen(built.app);
  const owner = makeClient();
  const pat = makeClient();
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner-hold@signup.test', password: 'owner password 1' })).status, 200);
    assert.strictEqual((await pat('POST', '/api/signup', { firstName: 'Pat', lastName: 'Example', email: 'pat-hold@signup.test', password: 'pat password 1', acceptAccountTerms: true, state: 'NJ', njResident: true })).status, 200);
    const user = built.db.data.users.find(u => u.email === 'pat-hold@signup.test');
    user.emailVerifiedAt = new Date().toISOString();
    assert.strictEqual((await pat('POST', '/api/login', { email: 'pat-hold@signup.test', password: 'pat password 1' })).status, 200);
    const fd = new FormData();
    fd.append('type', 'report');
    fd.append('file', new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), 'report.pdf');
    const cookie = Object.entries(pat.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const up = await fetch(base + '/api/portal/files', { method: 'POST', body: fd, headers: { cookie } });
    assert.strictEqual(up.status, 200);
    await new Promise(r => setImmediate(r));
    const ws = (await owner('GET', '/api/workspace')).body.data;
    const row = ws.clients.find(c => c.email === 'pat-hold@signup.test');
    assert.ok(ws.documents.some(d => d.clientId === row.id && d.type === 'report'));
    assert.ok(!(ws.pendingImports || []).some(p => p.clientId === row.id));
    assert.ok(ws.tasks.some(t => t.clientId === row.id && /on hold until the cancellation window/.test(t.title)));
    assert.ok(!ws.tasks.some(t => /AI already read|AI read the report/.test(t.title)));
    assert.strictEqual((await owner('POST', `/api/clients/${row.id}/files/x/scan`)).status, 409);
    assert.strictEqual((await owner('POST', `/api/clients/${row.id}/scan-text`, { text: 'report '.repeat(40) })).status, 409);
    assert.strictEqual((await owner('POST', `/api/clients/${row.id}/ai-plan`)).status, 409);
    assert.strictEqual((await owner('POST', '/api/assistant/staff', { clientId: row.id, history: [{ role: 'user', content: 'Summarize this file' }] })).status, 409);
    assert.strictEqual((await owner('POST', '/api/assistant/staff', { history: [{ role: 'user', content: 'What is a dispute?' }] })).status, 200);
    const add = await owner('GET', '/api/workspace');
    add.body.data.clients.push({ id: 'inv-hold', name: 'Invited Person', kind: 'personal', email: 'inv-hold@signup.test', status: 'onboarding', onboarding: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: add.body.version, data: add.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/clients/inv-hold/files/x/scan')).status, 501);
    assert.strictEqual((await owner('POST', '/api/assistant/staff', { clientId: 'inv-hold', history: [{ role: 'user', content: 'Hello' }] })).status, 200);
  } finally {
    server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Eastern document times, staff enrollment terms, address, and the signature page', async () => {
  const { formatDocumentTimeEt } = await import('../server/croa-window.js');
  const { personalizeCroaDocs, sha256, stampContractSignedAt } = await import('../server/croa-docs.js');
  const { buildContractPackagePdf, readPdfPages, CANCEL_SENTENCE } = await import('../server/enrollment-pdf.js');
  assert.strictEqual(formatDocumentTimeEt('2026-11-19T02:00:00.000Z'), 'November 18, 2026, 9:00 PM ET');
  assert.strictEqual(formatDocumentTimeEt('2026-11-18T21:30:00.000Z'), 'November 18, 2026, 4:30 PM ET');
  const dateLine = { disclosure: '', contract: 'Date of this agreement: [DATE SIGNED, filled automatically]\nDate signed: __________\n', cancellation: 'before midnight of [DATE: Weekday, Month D, YYYY]\n', esign: '' };
  const eveningClient = { name: 'Pat Example', address: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102' };
  const evening = personalizeCroaDocs(dateLine, eveningClient, new Date('2026-11-19T02:00:00.000Z'));
  const tenMinutesLater = personalizeCroaDocs(dateLine, eveningClient, new Date('2026-11-19T02:10:00.000Z'));
  assert.strictEqual(evening.contract, tenMinutesLater.contract);
  assert.strictEqual(evening.cancellation, tenMinutesLater.cancellation);
  assert.strictEqual(sha256(evening.contract), sha256(tenMinutesLater.contract));
  assert.match(evening.contract, /the date and time you sign/);
  assert.match(evening.cancellation, /filled when you sign/);
  assert.doesNotMatch(evening.contract + evening.cancellation, /\d{1,2}:\d{2} [AP]M ET|November/);
  const stamped = stampContractSignedAt(evening.contract, '2026-11-19T02:10:00.000Z');
  assert.match(stamped, /November 18, 2026, 9:10 PM ET/);
  assert.doesNotMatch(stamped, /November 19/);
  const contractFile = read('legal/croa-contract-1679d.md');
  const hold = contractFile.split('\n').find(line => line.includes('OPTIONAL HOLD'));
  assert.match(hold, /at least NUMBER days/);
  assert.doesNotMatch(hold, /\[NUMBER\]/);
  assert.strictEqual(hold.match(/\[[^\]]+\]/g).length, 1);
  const partial = personalizeCroaDocs({ disclosure: '', contract: contractFile, cancellation: '', esign: '' }, { name: 'Pat Example', state: 'NJ', pricePerResult: 10, scheduleA: [{ creditor: 'Bank', bureau: 'Equifax' }] });
  assert.match(partial.contract, /\[CLIENT ADDRESS\]/);
  assert.doesNotMatch(partial.contract, /Client mailing address: New Jersey/);
  assert.match(read('js/views.js'), /data-act="enrollment-terms"/);
  assert.match(read('js/app.js'), /enrollment-terms/);
  assert.match(read('site/privacy.html'), /hash of the agreement text viewed, plus hash of the signed PDF/);
  assert.doesNotMatch(read('site/privacy.html'), /—/);
  assert.match(read('js/portal.js'), /before midnight of/);
  assert.doesNotMatch(read('site/privacy.html') + read('js/views.js') + read('server/app.js') + read('server/croa-docs.js'), /PDF the client saw/);

  const notice = read('legal/croa-cancellation-1679e.md');
  for (let n = 1; n <= 40; n++) {
    const scheduleA = Array.from({ length: n }, (_, i) => ({ item: 'Item ' + (i + 1), creditor: 'Bank ' + (i + 1), last4: '4242', bureau: 'Equifax' }));
    const client = { name: 'Pat Example', address: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102', pricePerResult: 10, scheduleA };
    const docs = personalizeCroaDocs({ disclosure: '', contract: contractFile, cancellation: notice, esign: '' }, client, new Date('2026-11-19T02:00:00.000Z'));
    const built = buildContractPackagePdf({ contract: docs.contract, notice: docs.cancellation, clientName: client.name, signedLabel: 'November 18, 2026, 9:00 PM ET', deadlineLabel: 'Monday, November 23, 2026' });
    const pages = readPdfPages(built.pdf);
    const marker = '3rd business day after the date on which you signed';
    const sentencePages = pages.filter(lines => lines.map(line => line.text).join(' ').includes(marker));
    assert.strictEqual(sentencePages.length, 1, 'sentence split with ' + n + ' rows');
    const text = sentencePages[0].map(line => line.text).join(' ').replace(/\s+/g, ' ');
    assert.ok(text.includes(CANCEL_SENTENCE), 'sentence incomplete with ' + n + ' rows');
    assert.ok(text.includes('Client typed name (signature):'), 'signature left the sentence page with ' + n + ' rows');
    assert.ok(text.includes('Date signed:'), 'date signed left the sentence page with ' + n + ' rows');
  }

  const onlyClient = {
    disclosure: 'Consumer Credit File Rights Under State and Federal Law\n\nAcknowledgment.\n',
    contract: 'Credit Services Agreement\n\nClient: [CLIENT FULL NAME]\nClient mailing address: [CLIENT ADDRESS]\nDate of this agreement: [DATE SIGNED, filled automatically]\nSchedule A\n[ITEM / CREDITOR NAME / ACCOUNT ENDING IN LAST 4 ONLY / BUREAU(S)]\nThe most you can owe is $[PRICE] times [NUMBER OF ITEM AND BUREAU ENTRIES IN SCHEDULE A], which is $[MAXIMUM TOTAL].\n',
    cancellation: '**Notice of Cancellation**\n\nbefore midnight of [DATE: Weekday, Month D, YYYY]\n\n[date]\n\n[purchaser\'s signature]\n',
    esign: 'Consent to Electronic Records\n\nOpen [LINK TO SAMPLE PDF]. Code [______]\n\n[ ] I agree.\n'
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-terms-'));
  let clock = new Date('2026-11-19T02:00:00.000Z');
  const built = createApp({ dataDir: dir, encryptionKey: 'terms-key-not-a-secret-00', selfSignupEnabled: true, publicBaseUrl: 'http://127.0.0.1:4100', env: { NODE_ENV: 'test' }, croaDocs: onlyClient, now: () => clock });
  const { server, client: makeClient } = listen(built.app);
  const owner = makeClient();
  const pat = makeClient();
  try {
    assert.strictEqual((await owner('POST', '/api/setup', { name: 'Owner', email: 'owner-terms@signup.test', password: 'owner password 1' })).status, 200);
    assert.strictEqual((await pat('POST', '/api/signup', { firstName: 'Pat', lastName: 'Example', email: 'pat-terms@signup.test', password: 'pat password 1', acceptAccountTerms: true, state: 'NJ', njResident: true })).status, 200);
    built.db.data.users.find(u => u.email === 'pat-terms@signup.test').emailVerifiedAt = new Date().toISOString();
    assert.strictEqual((await pat('POST', '/api/login', { email: 'pat-terms@signup.test', password: 'pat password 1' })).status, 200);
    const id = built.db.data.workspace.clients.find(c => c.email === 'pat-terms@signup.test').id;
    built.db.data.users.push({ id: 'staff-terms', name: 'Staff Person', email: 'staff-terms@signup.test', role: 'staff', password: hashPassword('staff password 1'), sessionEpoch: 1, createdAt: new Date().toISOString(), emailVerifiedAt: new Date().toISOString() });
    const staff = makeClient();
    assert.strictEqual((await staff('POST', '/api/login', { email: 'staff-terms@signup.test', password: 'staff password 1' })).status, 200);
    const terms = { pricePerResult: 25, scheduleA: [{ item: 'Late fee', creditor: 'North Bank', bureau: 'Equifax', last4: '4242' }, { item: 'Late fee', furnisher: 'North Bank', bureau: 'Experian' }] };
    assert.match((await pat('POST', '/api/signup', { firstName: 'Pa', lastName: 'Zip', email: 'pa-zip@signup.test', password: 'pat password 1', acceptAccountTerms: true, state: 'NJ', njResident: true, address: '1 Broad St', city: 'Philadelphia', zip: '19103' })).body.error, /New Jersey address/);
    assert.strictEqual((await pat('PUT', '/api/clients/' + id + '/enrollment-terms', terms)).status, 403);
    assert.strictEqual((await staff('PUT', '/api/clients/' + id + '/enrollment-terms', terms)).status, 403);
    assert.strictEqual((await owner('PUT', '/api/clients/' + id + '/enrollment-terms', terms)).status, 200);
    const staffWs = await staff('GET', '/api/workspace');
    const staffCopy = JSON.parse(JSON.stringify(staffWs.body.data));
    staffCopy.clients.find(c => c.id === id).pricePerResult = 99;
    assert.strictEqual((await staff('PUT', '/api/workspace', { baseVersion: staffWs.body.version, data: staffCopy })).status, 403);
    const ownerWs = await owner('GET', '/api/workspace');
    const ownerCopy = JSON.parse(JSON.stringify(ownerWs.body.data));
    ownerCopy.clients.find(c => c.id === id).pricePerResult = 99;
    const refusedTerms = await owner('PUT', '/api/workspace', { baseVersion: ownerWs.body.version, data: ownerCopy });
    assert.strictEqual(refusedTerms.status, 400);
    assert.match(refusedTerms.body.error, /enrollment-terms/);
    assert.strictEqual(built.db.data.workspace.clients.find(c => c.id === id).pricePerResult, 25);
    assert.ok(built.db.data.audit.some(a => a.action === 'client.enrollment_terms'));
    assert.strictEqual((await owner('POST', '/api/assistant', { clientId: id, history: [{ role: 'user', content: 'What should we do next?' }] })).status, 409);
    const missingAddress = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true });
    assert.strictEqual(missingAddress.status, 503);
    assert.match(missingAddress.body.error, /mailing address is needed/i);
    assert.match((await pat('POST', '/api/portal/address', { address: '1 Broad St', city: 'Philadelphia', state: 'PA', zip: '19103' })).body.error, /New Jersey/);
    assert.match((await pat('POST', '/api/portal/address', { address: '1 Main St', city: 'Newark', state: 'NJ', zip: '10001' })).body.error, /New Jersey/);
    assert.strictEqual((await pat('POST', '/api/portal/address', { address: '1 Main St', city: 'Newark', state: 'NJ', zip: '07102' })).status, 200);
    const logged = built.db.data.audit.find(a => a.action === 'client.enrollment_terms' && String(a.detail).startsWith('{'));
    const detail = JSON.parse(logged.detail);
    assert.strictEqual(detail.user, 'owner-terms@signup.test');
    assert.match(detail.at, /T/);
    assert.strictEqual(detail.old.pricePerResult, null);
    assert.strictEqual(detail.new.pricePerResult, 25);
    const sample = await pat('GET', '/api/portal/esign/sample');
    const code = sample.body.match(/Your code is ([A-F0-9]{6})/)[1];
    assert.strictEqual((await pat('POST', '/api/portal/esign/consent', { agree: true, code })).status, 200);
    assert.strictEqual((await pat('POST', '/api/portal/disclosure-view')).status, 200);
    assert.strictEqual((await pat('POST', '/api/portal/sign', { doc: 'disclosure', typedName: 'Pat Example', agree: true })).status, 200);
    const shown = await pat('GET', '/api/portal/me');
    assert.match(shown.body.documents.contract, /Late fee/);
    assert.match(shown.body.documents.contract, /1 Main St, Newark, NJ 07102/);
    assert.match(shown.body.documents.contract, /which is \$50/);
    const unread = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true });
    assert.strictEqual(unread.status, 400);
    assert.strictEqual(unread.body.error, 'Please read the agreement before you sign.');
    const viewedOnce = await pat('POST', '/api/portal/contract-view');
    assert.strictEqual(viewedOnce.status, 200);
    const changed = { pricePerResult: 30, scheduleA: terms.scheduleA };
    assert.strictEqual((await owner('PUT', '/api/clients/' + id + '/enrollment-terms', changed)).status, 200);
    const relog = built.db.data.audit.find(a => a.action === 'client.enrollment_terms' && String(a.detail).startsWith('{'));
    const againDetail = JSON.parse(relog.detail);
    assert.strictEqual(againDetail.old.pricePerResult, 25);
    assert.strictEqual(againDetail.new.pricePerResult, 30);
    const again = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true });
    assert.strictEqual(again.status, 400);
    assert.strictEqual(again.body.error, 'Please read the agreement again.');
    clock = new Date('2026-11-19T02:00:00.000Z');
    const viewedTwice = await pat('POST', '/api/portal/contract-view');
    assert.strictEqual(viewedTwice.status, 200);
    const viewedText = await pat('GET', '/api/portal/me');
    assert.match(viewedText.body.documents.contract, /the date and time you sign/);
    assert.match(viewedText.body.documents.cancellation, /filled when you sign/);
    assert.doesNotMatch(viewedText.body.documents.contract + viewedText.body.documents.cancellation, /\d{1,2}:\d{2} [AP]M ET|November 23/);
    assert.strictEqual(viewedTwice.body.contractSha256, sha256(viewedText.body.documents.contract));
    clock = new Date(clock.getTime() + 10 * 60 * 1000);
    const signed = await pat('POST', '/api/portal/sign', { doc: 'contract', typedName: 'Pat Example', agree: true });
    assert.strictEqual(signed.status, 200);
    assert.strictEqual(signed.body.signature.documentSha256, viewedTwice.body.contractSha256);
    assert.strictEqual(signed.body.signature.at, '2026-11-19T02:10:00.000Z');
    const pdf = await pat('GET', '/api/portal/signed/' + signed.body.signature.pdfId);
    assert.match(pdf.body, /9:10 PM ET/);
    assert.doesNotMatch(pdf.body, /9:00 PM ET/);
    assert.match(pdf.body, /before midnight of Monday, November 23, 2026/);
    assert.doesNotMatch(pdf.body, /11:59/);
    assert.strictEqual(pdf.body.split('before midnight of Monday, November 23, 2026').length - 1, 2);
    assert.doesNotMatch(pdf.body, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.strictEqual((await owner('PUT', '/api/clients/' + id + '/enrollment-terms', terms)).status, 409);
    const locked = await owner('GET', '/api/workspace');
    locked.body.data.clients.find(c => c.id === id).pricePerResult = 99;
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: locked.body.version, data: locked.body.data })).status, 409);
    const ws = await owner('GET', '/api/workspace');
    ws.body.data.reports.push({ id: 'r-hold', clientId: id, bureau: 'Equifax', date: '2026-11-01', accounts: [], scores: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: ws.body.version, data: ws.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/assistant', { clientId: id, history: [{ role: 'user', content: 'What is on this report?' }] })).status, 409);
    const general = await owner('GET', '/api/workspace');
    general.body.data.clients.push({ id: 'inv-terms', name: 'Invited Person', kind: 'personal', email: 'inv-terms@signup.test', status: 'onboarding', onboarding: {}, reports: [] });
    general.body.data.reports.push({ id: 'r-inv', clientId: 'inv-terms', bureau: 'Equifax', date: '2026-11-01', accounts: [], scores: {} });
    assert.strictEqual((await owner('PUT', '/api/workspace', { baseVersion: general.body.version, data: general.body.data })).status, 200);
    assert.strictEqual((await owner('POST', '/api/assistant', { clientId: 'inv-terms', history: [{ role: 'user', content: 'What next?' }] })).status, 501);
    assert.strictEqual((await owner('PUT', '/api/clients/inv-terms/enrollment-terms', terms)).status, 400);
  } finally {
    server.close();
    built.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

