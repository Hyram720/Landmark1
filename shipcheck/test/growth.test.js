import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcheck-'));
const { dueForRecovery, recoveryEmail } = await import('../src/followups.js');
const { badgeSvg } = await import('../src/badge.js');
const { GUIDES, guidePage, sitemap, robots } = await import('../src/seo.js');

const now = Date.parse('2026-10-20T12:00:00Z');
const scan = (over) => ({
  id: 'a'.repeat(32), email: 'dev@example.com', paid: false, createdAt: '2026-10-20T10:00:00Z',
  source: { type: 'github', name: 'me/app' }, summary: { total: 3, critical: 1, high: 0, medium: 1, low: 1, score: 70 }, ...over,
});

test('recovery emails only go to unpaid scans with serious issues, once, in the 1-48h window', () => {
  assert.equal(dueForRecovery([scan()], now).length, 1);
  for (const over of [
    { paid: true }, { email: '' }, { unsubscribed: true }, { recoveryEmailedAt: 'x' }, { rescanOf: 'b'.repeat(32) },
    { summary: { total: 1, critical: 0, high: 0, medium: 0, low: 1, score: 99 } },
    { createdAt: '2026-10-20T11:30:00Z' }, { createdAt: '2026-10-17T10:00:00Z' },
  ]) assert.equal(dueForRecovery([scan(over)], now).length, 0, JSON.stringify(over));
  const email = recoveryEmail(scan());
  assert.match(email.subject, /1 critical issue in me\/app/);
  assert.match(email.html, /SHIPIT20/);
  assert.match(email.html, /\/u\/a{32}/);
});

test('badge shows score and colour, or unknown', () => {
  assert.match(badgeSvg(95), /95\/100/);
  assert.match(badgeSvg(95), /#16a34a/);
  assert.match(badgeSvg(40), /#dc2626/);
  assert.match(badgeSvg(null), /unknown/);
});

test('every guide renders and is in the sitemap; private pages are disallowed', () => {
  for (const slug of Object.keys(GUIDES)) {
    assert.match(guidePage(slug), /<h1>/);
    assert.ok(sitemap().includes(`/guides/${slug}`));
  }
  assert.equal(guidePage('nope'), null);
  assert.match(robots(), /Disallow: \/r\//);
});
