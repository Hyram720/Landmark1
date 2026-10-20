import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdrop-'));
process.env.BASE_URL = 'https://watchdrop.test';
process.env.SOURCES_FIXTURES = new URL('./fixtures', import.meta.url).pathname;

const { fetchAll, getServices } = await import('../src/sources.js');
const { curate, personalize, cleanPrefs } = await import('../src/curate.js');
const { templateCopy, validCopy } = await import('../src/writer.js');
const { renderEmail, renderIssuePage, destination } = await import('../src/issue.js');

const raw = await fetchAll();
const picks = curate(raw);
const issueOf = (p, copy = templateCopy(p)) => ({ week: '2026-W43', createdAt: '2026-10-20T12:00:00Z', ...p, copy, sentTo: [], clicks: {} });

test('normalizes API changes: one item per show, services merged, episode/season changes and linkless options skipped', () => {
  const longQuiet = raw.new.find((i) => i.showId === '101');
  assert.deepEqual(longQuiet.services.map((s) => s.name), ['Netflix', 'Hulu']);
  assert.equal(longQuiet.year, 2025);
  assert.equal(longQuiet.image, 'https://img.example/101-480.jpg');
  assert.ok(!raw.new.some((i) => i.showId === '106'), 'season-level change ignored');
  assert.equal(raw.free.find((i) => i.showId === '108').services.length, 1, 'option without a link dropped');
  assert.equal(raw.new.find((i) => i.showId === '102').showType, 'series');
});

test('curation: rating floors, leaving sorted soonest first, free excludes titles already new', () => {
  assert.deepEqual(picks.new.map((i) => i.title), ['The Long Quiet', 'Midnight Shift']);
  assert.deepEqual(picks.leaving.map((i) => i.title), ['Paper Moons', 'Cold Case Island'], 'Meh Thriller (52) dropped; Oct 25 before Oct 31');
  assert.deepEqual(picks.free.map((i) => i.title), ['Old Classic', 'Space Cowboys of Tomorrow'], 'The Long Quiet is already in New');
});

test('personalize: only my services (and only their links), my types, free toggle', () => {
  const issue = issueOf(picks);
  const netflixMovies = personalize(issue, { services: ['netflix'], types: ['movie'], free: false });
  assert.deepEqual(netflixMovies.new.map((i) => [i.title, i.services.map((s) => s.id)]), [['The Long Quiet', ['netflix']]]);
  assert.deepEqual(netflixMovies.leaving, [], 'Cold Case Island is a series');
  assert.deepEqual(netflixMovies.free, []);
  const hboAll = personalize(issue, { services: ['hbo'], types: ['movie', 'series'], free: true });
  assert.deepEqual(hboAll.new.map((i) => i.title), ['Midnight Shift']);
  assert.equal(hboAll.free.length, 2);
});

test('prefs are sanitized against the real service list; unticked form checkbox means no free picks', async () => {
  const valid = (await getServices()).map((s) => s.id);
  assert.deepEqual(cleanPrefs({ services: ['netflix', 'evil<script>', 'nope', 'netflix'], types: ['movie', 'x'] }, valid), { services: ['netflix'], types: ['movie'], free: true });
  assert.equal(cleanPrefs({ form: '1' }).free, false);
  assert.equal(cleanPrefs({ form: '1', free: 'on' }).free, true);
  assert.deepEqual(cleanPrefs({}, valid).services, ['netflix', 'hbo', 'hulu']);
});

test('AI copy is validated by id; template copy reads naturally', () => {
  const ok = validCopy({ headline: 'H', intro: 'I', pickOfTheWeek: 'new-101', blurbs: [{ id: 'new-101', line: 'Quiet and gripping.' }, { id: 'made-up', line: 'x' }] }, picks);
  assert.deepEqual(ok.blurbs, { 'new-101': 'Quiet and gripping.' });
  assert.equal(validCopy({ headline: 'H', intro: 'I', pickOfTheWeek: 'nope', blurbs: [] }, picks).pickOfTheWeek, null);
  assert.equal(templateCopy(picks).headline, 'The Long Quiet is new on Netflix, Hulu');
});

test('email: escaped, per-service tracked links, prefs/unsubscribe links, subject follows the reader', () => {
  const p = structuredClone(picks);
  p.new[0].overview = '<script>x</script>';
  const issue = issueOf(p);
  const email = renderEmail(issue, { id: 'a'.repeat(32), prefs: { services: ['hulu'], types: ['movie', 'series'], free: true } });
  assert.ok(!email.html.includes('<script>x'));
  assert.match(email.html, /https:\/\/watchdrop\.test\/out\/2026-W43\/new-101\?s=hulu/);
  assert.match(email.html, /Watch on Hulu/);
  assert.ok(!email.html.includes('Watch on Netflix'), 'reader does not have Netflix');
  assert.match(email.html, /\/unsubscribe\/a{32}/);
  assert.equal(email.subject, issue.copy.headline);
  const hboOnly = renderEmail(issue, { id: 'a'.repeat(32), prefs: { services: ['hbo'], types: ['series'], free: false } });
  assert.equal(hboOnly.subject, 'Midnight Shift is new on HBO Max');
  assert.equal(destination(picks.new[0], 'hulu'), 'https://hulu.example/title/101');
  assert.equal(destination(picks.new[0], 'bogus'), 'https://netflix.example/title/101', 'unknown service falls back to the first link');
  assert.match(renderIssuePage(issue), /<link rel="canonical" href="https:\/\/watchdrop\.test\/issues\/2026-W43">/);
});
