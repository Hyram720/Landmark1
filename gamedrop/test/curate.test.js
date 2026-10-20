import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedrop-'));
process.env.BASE_URL = 'https://gamedrop.test';
const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const read = (f) => JSON.parse(fs.readFileSync(path.join(fixtures, f), 'utf8'));

const { normalizeGiveaway, normalizeDeal, platformGroups } = await import('../src/sources.js');
const { curate, personalize, cleanPrefs } = await import('../src/curate.js');
const { templateCopy, validCopy } = await import('../src/writer.js');
const { isoWeek, renderEmail, renderIssuePage } = await import('../src/issue.js');
const { sendSlot, recipients } = await import('../src/scheduler.js');

const now = Date.parse('2026-10-20T12:00:00Z');
const raw = { free: read('giveaways.json').map(normalizeGiveaway), deals: read('deals.json').map((d) => normalizeDeal(d, { 1: 'Steam', 7: 'GOG', 11: 'Humble Store', 15: 'Fanatical', 25: 'Epic Games Store' })) };

test('normalizes GamerPower titles, stores, platforms and the points catch', () => {
  const agent = raw.free.find((g) => g.id === 'gp-3817');
  assert.equal(agent.title, 'Agent A: A puzzle in disguise');
  assert.equal(agent.store, 'Epic Games');
  assert.deepEqual(agent.platforms.sort(), ['mobile', 'pc']);
  assert.equal(raw.free.find((g) => g.id === 'gp-3716').title, 'Dwarven Realms');
  assert.match(raw.free.find((g) => g.id === 'gp-3716').catch, /points/);
  assert.deepEqual(platformGroups('VR'), ['vr']);
  assert.deepEqual(platformGroups('Playstation 5, Xbox Series X|S'), ['console']);
});

test('free picks: drop expired, fresh and valuable first, points-grind last', () => {
  const { free } = curate(raw, now);
  const ids = free.map((g) => g.id);
  assert.ok(!ids.includes('gp-4000'), 'expired giveaway kept');
  assert.equal(ids[0], 'gp-3817', 'freshest, most valuable giveaway should lead');
  assert.equal(ids.at(-1), 'gp-3716', 'points-required giveaway should be last');
});

test('deals: well reviewed, 50%+ off, cheapest store per game, no duplicate of a free game', () => {
  const { deals } = curate(raw, now);
  const titles = deals.map((d) => d.title);
  assert.ok(!titles.includes('Silver Pines'), 'only 38% off');
  assert.ok(!titles.includes('Tiny Farm'), 'too few reviews');
  assert.ok(!titles.includes('Mega Shooter Ultimate'), 'rated under 80%');
  assert.ok(!titles.includes('Agent A: A puzzle in disguise'), 'already in the free section');
  assert.deepEqual(deals.map((d) => [d.title, d.store, d.price]), [['Hollow Depths', 'GOG', 4.99]]);
  assert.match(deals[0].url, /^https:\/\/www\.cheapshark\.com\/redirect\?dealID=/);
});

test('personalize filters by platform and budget; prefs are sanitized', () => {
  const issue = curate(raw, now);
  const mobile = personalize(issue, { platforms: ['mobile'], maxPrice: 60 });
  assert.ok(mobile.free.every((g) => g.platforms.includes('mobile')));
  assert.equal(mobile.deals.length, 0, 'deals are PC only');
  assert.equal(personalize(issue, { platforms: ['pc'], maxPrice: 3 }).deals.length, 0);
  assert.deepEqual(cleanPrefs({ platforms: ['pc', 'hax', 'pc'], maxPrice: '9999' }), { platforms: ['pc'], maxPrice: 200 });
  assert.deepEqual(cleanPrefs({}).platforms, ['pc', 'mobile', 'console', 'vr']);
});

test('AI copy is validated: unknown ids dropped, template used when invalid', () => {
  const picks = curate(raw, now);
  const ok = validCopy({ headline: 'H', intro: 'I', pickOfTheWeek: 'gp-3817', blurbs: [{ id: 'gp-3817', line: 'Great' }, { id: 'made-up', line: 'x' }] }, picks);
  assert.deepEqual(ok.blurbs, { 'gp-3817': 'Great' });
  assert.equal(validCopy({ headline: 'H', intro: 'I', pickOfTheWeek: 'nope', blurbs: [] }, picks).pickOfTheWeek, null);
  assert.equal(validCopy({}, picks), null);
  assert.match(templateCopy(picks).headline, /free this week/);
});

test('emails and pages escape content, carry prefs/unsubscribe links and route clicks through /out', () => {
  const picks = curate(raw, now);
  picks.free[0].title = '<script>x</script>';
  const issue = { week: '2026-W43', createdAt: new Date(now).toISOString(), ...picks, copy: templateCopy(picks), sentTo: [], clicks: {} };
  const email = renderEmail(issue, { id: 'a'.repeat(32), prefs: { platforms: ['pc'], maxPrice: 60 } });
  assert.ok(!email.html.includes('<script>x'));
  assert.match(email.html, /\/unsubscribe\/a{32}/);
  assert.match(email.html, /\/prefs\/a{32}/);
  assert.match(email.html, /https:\/\/gamedrop\.test\/out\/2026-W43\/gp-/);
  assert.ok(email.count > 0);
  assert.match(renderIssuePage(issue), /<link rel="canonical" href="https:\/\/gamedrop\.test\/issues\/2026-W43">/);
});

test('weeks and the Thursday send slot', () => {
  assert.equal(isoWeek(new Date('2026-10-20T12:00:00Z')), '2026-W43');
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53');
  assert.equal(sendSlot(new Date('2026-10-20T12:00:00Z')).toISOString(), '2026-10-22T16:00:00.000Z');
  assert.equal(sendSlot(new Date('2026-10-25T23:00:00Z')).toISOString(), '2026-10-22T16:00:00.000Z');
  assert.deepEqual(recipients([{ id: 1, confirmed: true }, { id: 2, confirmed: false }, { id: 3, confirmed: true, unsubscribed: true }]).map((s) => s.id), [1]);
});

test('subject line follows the reader: VR-only readers are not promised a PC game', () => {
  const picks = curate(raw, now);
  const issue = { week: '2026-W43', createdAt: new Date(now).toISOString(), ...picks, copy: { ...templateCopy(picks), pickOfTheWeek: 'gp-3817' }, sentTo: [], clicks: {} };
  assert.equal(renderEmail(issue, { id: 'a'.repeat(32), prefs: { platforms: ['pc'] } }).subject, issue.copy.headline);
  assert.equal(renderEmail(issue, { id: 'a'.repeat(32), prefs: { platforms: ['vr'] } }).subject, 'Sharknado VR is free this week');
});
