// Tiny JSON-file store: one file per subscriber, one per weekly issue.
// Good for thousands of subscribers; swap for Postgres when the list outgrows it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from './config.js';

const subsDir = path.join(config.dataDir, 'subscribers');
const issuesDir = path.join(config.dataDir, 'issues');
for (const dir of [subsDir, issuesDir]) fs.mkdirSync(dir, { recursive: true });

// Subscriber ids double as the private token in confirm / preferences / unsubscribe links.
export const newToken = () => crypto.randomBytes(16).toString('hex');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return value;
}

const subFile = (id) => {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('invalid subscriber id');
  return path.join(subsDir, `${id}.json`);
};

export function getSubscriber(id) {
  try {
    return readJson(subFile(id));
  } catch {
    return null;
  }
}

export function saveSubscriber(sub) {
  sub.updatedAt = new Date().toISOString();
  return writeJson(subFile(sub.id), sub);
}

export function listSubscribers() {
  return fs
    .readdirSync(subsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(subsDir, f)))
    .filter(Boolean);
}

export const findSubscriberByEmail = (email) =>
  listSubscribers().find((s) => s.email === email.toLowerCase());

// Issues are keyed by ISO week, e.g. 2026-W43.
const issueFile = (week) => {
  if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error('invalid issue week');
  return path.join(issuesDir, `${week}.json`);
};

export const getIssue = (week) => {
  try {
    return readJson(issueFile(week));
  } catch {
    return null;
  }
};
export const saveIssue = (issue) => writeJson(issueFile(issue.week), issue);
export const listIssues = () =>
  fs
    .readdirSync(issuesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(issuesDir, f)))
    .filter(Boolean)
    .sort((a, b) => b.week.localeCompare(a.week));
