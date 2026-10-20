// Automated revenue recovery: someone ran a free scan, left an email, found real issues,
// but didn't unlock the report -> one reminder after ~1h with a discount code. Never more than one.
import config from './config.js';
import { listScans, updateScan } from './store.js';
import { sendEmail } from './notify.js';

const HOUR = 3600_000;

export function recoveryEmail(scan) {
  const s = scan.summary;
  const worst = s.critical ? `${s.critical} critical` : `${s.high} high-severity`;
  return {
    to: scan.email,
    subject: `${worst} issue${(s.critical || s.high) === 1 ? '' : 's'} in ${scan.source.name} are still open`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#111">
      <h2 style="font-size:20px">Your app scored ${s.score}/100</h2>
      <p>Your free scan found ${s.total} issue${s.total === 1 ? '' : 's'}, including <strong>${worst}</strong>. Things like leaked keys and open tables get found by bots within hours of launch.</p>
      <p>Unlock the exact file, line and a copy-paste fix prompt for each one. Use code <strong>${config.recovery.code}</strong> for ${config.recovery.percentOff}% off.</p>
      <p><a href="${config.baseUrl}/r/${scan.id}" style="background:#16a34a;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">See the fixes</a></p>
      <p style="color:#888;font-size:12px">${config.brandName} · <a href="${config.baseUrl}/u/${scan.id}">Unsubscribe</a></p>
    </div>`,
  };
}

// Pure so it can be tested: which scans are due a reminder right now.
export function dueForRecovery(scans, now = Date.now()) {
  return scans.filter((s) => {
    const age = now - Date.parse(s.createdAt);
    return (
      s.email && !s.paid && !s.unsubscribed && !s.recoveryEmailedAt && !s.rescanOf &&
      (s.summary.critical || s.summary.high) &&
      age > config.recovery.afterHours * HOUR && age < 48 * HOUR
    );
  });
}

async function runFollowups() {
  // Only once checkout works; otherwise the email would point at a dead end.
  if (!config.stripe.secretKey || config.devSkipPayment) return;
  for (const scan of dueForRecovery(listScans())) {
    try {
      await sendEmail(recoveryEmail(scan));
      updateScan(scan.id, { recoveryEmailedAt: new Date().toISOString() });
    } catch (err) {
      console.error(`recovery email failed for ${scan.id}:`, err.message);
    }
  }
}

export function startFollowupScheduler() {
  setInterval(() => runFollowups().catch((e) => console.error('followups', e)), 10 * 60_000).unref();
}
