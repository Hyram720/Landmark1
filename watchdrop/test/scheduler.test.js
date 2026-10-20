import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdrop-sched-'));
process.env.SOURCES_FIXTURES = new URL('./fixtures', import.meta.url).pathname;
const store = await import('../src/store.js');
const { tick } = await import('../src/scheduler.js');

const sub = (email, services, extra = {}) => store.saveSubscriber({ id: store.newToken(), email, prefs: { services, types: ['movie', 'series'], free: false }, confirmed: true, ...extra });

test('midweek builds a preview without sending; Thursday rebuilds, sends once, skips empty and inactive', async () => {
  sub('netflix@x.com', ['netflix']);
  sub('hbo@x.com', ['hbo']);
  sub('peacock@x.com', ['peacock']); // nothing on Peacock in the fixtures
  sub('pending@x.com', ['netflix'], { confirmed: false });
  sub('gone@x.com', ['netflix'], { unsubscribed: true });

  await tick(new Date('2026-10-20T12:00:00Z'));
  const preview = store.getIssue('2026-W43');
  assert.ok(preview, 'preview built before the slot');
  assert.equal(preview.sentTo.length, 0);
  assert.equal(preview.sendStartedAt, null);

  await tick(new Date('2026-10-20T13:00:00Z'));
  assert.equal(store.getIssue('2026-W43').createdAt, preview.createdAt, 'preview not rebuilt within the preview window');

  await tick(new Date('2026-10-22T16:30:00Z'));
  const sent = store.getIssue('2026-W43');
  assert.notEqual(sent.createdAt, preview.createdAt, 'rebuilt with fresh data at send time');
  assert.ok(sent.sendStartedAt);
  assert.equal(sent.sentTo.length, 3, 'netflix + hbo sent, peacock marked as done with nothing to send');

  await tick(new Date('2026-10-22T16:40:00Z'));
  const again = store.getIssue('2026-W43');
  assert.equal(again.sentTo.length, 3);
  assert.equal(again.createdAt, sent.createdAt, 'not rebuilt once sending started');
});
