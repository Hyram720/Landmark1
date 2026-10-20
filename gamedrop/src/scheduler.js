// Weekly send loop. Every 10 minutes: once this week's send time has passed, build the issue (once)
// and email every confirmed subscriber who hasn't had it yet. Progress is saved after each email,
// so a restart mid-send picks up where it left off and nobody gets it twice.
import config from './config.js';
import { listSubscribers, getIssue, saveIssue } from './store.js';
import { isoWeek, buildIssue, renderEmail } from './issue.js';
import { sendEmail, alertOwner } from './mailer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The configured weekday/hour inside the ISO week that contains `now`.
export function sendSlot(now = new Date()) {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const offsetDays = (config.schedule.weekday + 6) % 7;
  return new Date(monday.getTime() + offsetDays * 86400_000 + config.schedule.hourUtc * 3600_000);
}

export const recipients = (subs) => subs.filter((s) => s.confirmed && !s.unsubscribed);

export async function sendIssueTo(issue, sub) {
  const email = renderEmail(issue, sub);
  if (!email.count) return false; // nothing matches their filters; don't send an empty email
  await sendEmail({ to: sub.email, subject: email.subject, html: email.html, unsubscribeUrl: `${config.baseUrl}/unsubscribe/${sub.id}` });
  return true;
}

const MAX_ATTEMPTS = 3;

export async function sendIssue(issue) {
  let sent = 0;
  let failed = 0;
  const gaveUp = [];
  issue.failures ||= {};
  for (const sub of recipients(listSubscribers())) {
    if (issue.sentTo.includes(sub.id) || (issue.failures[sub.id] || 0) >= MAX_ATTEMPTS) continue;
    try {
      if (await sendIssueTo(issue, sub)) sent++;
      issue.sentTo.push(sub.id);
    } catch (err) {
      failed++;
      issue.failures[sub.id] = (issue.failures[sub.id] || 0) + 1;
      if (issue.failures[sub.id] === MAX_ATTEMPTS) gaveUp.push(`${sub.email}: ${err.message}`);
      console.error(`[send] ${sub.id}: ${err.message}`);
    }
    saveIssue(issue);
    await sleep(600); // stay under Resend's default 2 requests/second
  }
  if (gaveUp.length) await alertOwner(`Gave up on ${gaveUp.length} emails for ${issue.week}`, gaveUp.join('\n'));
  return { sent, failed };
}

let running = false;
let alertedWeek = null; // one failure alert per week, not one every 10 minutes
export async function tick(now = new Date()) {
  if (running || now < sendSlot(now)) return;
  running = true;
  try {
    const week = isoWeek(now);
    const issue = getIssue(week) || (await buildIssue(week));
    const result = await sendIssue(issue);
    if (result.sent || result.failed) console.log(`[send] ${week}: sent ${result.sent}, failed ${result.failed}`);
  } catch (err) {
    console.error('[send] weekly issue failed:', err.message);
    if (alertedWeek !== isoWeek(now)) {
      alertedWeek = isoWeek(now);
      await alertOwner('Weekly issue failed (will keep retrying every 10 minutes)', err.stack || err.message);
    }
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setInterval(() => tick(), 10 * 60_000).unref();
  setTimeout(() => tick(), 30_000).unref();
}
