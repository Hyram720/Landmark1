// Automated revenue recovery and word-of-mouth:
//  1. Abandoned checkout: started an order but didn't pay -> reminder at ~1h with a discount code.
//  2. Review + referral: 3 days after delivery -> ask for a review/photo and give a friend code.
import config from './config.js';
import { listOrders, updateOrder } from './store.js';
import { sendEmail } from './notify.js';

const HOUR = 3600_000;
const RECOVERY_CODE = process.env.RECOVERY_CODE || 'COMEBACK15';
const REFERRAL_CODE = process.env.REFERRAL_CODE || 'FRIEND20';
const REVIEW_URL = process.env.REVIEW_URL || '';

const footer = (order) =>
  `<p style="color:#9a8a7a;font-size:12px">${config.brandName} · <a href="${config.baseUrl}/u/${order.id}">Unsubscribe</a></p>`;

function abandonedEmail(order) {
  return {
    to: order.email,
    subject: `${order.petName || 'Your pet'}'s portrait is waiting 👑`,
    html: `<div style="font-family:Georgia,serif;max-width:560px;margin:auto">
      <h2>You were so close!</h2>
      <p>Your photo is uploaded and ready for the studio. Finish your order and use code <strong>${RECOVERY_CODE}</strong> for 15% off.</p>
      <p><a href="${config.baseUrl}/?resume=${order.id}#order" style="background:#7a1f1f;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">Finish my portrait</a></p>
      ${footer(order)}</div>`,
  };
}

function reviewEmail(order) {
  const review = REVIEW_URL ? `<p><a href="${REVIEW_URL}">Leave a quick review</a> — it helps a small studio more than you know.</p>` : '';
  return {
    to: order.email,
    subject: 'Did we capture them? (+ a gift for a friend)',
    html: `<div style="font-family:Georgia,serif;max-width:560px;margin:auto">
      <h2>How did we do?</h2>
      <p>We'd love to see ${order.petName || 'your portrait'} on the wall! Tag us on Instagram or TikTok and we may feature them.</p>
      ${review}
      <p><strong>Give 20%, make a friend's day:</strong> share code <strong>${REFERRAL_CODE}</strong> with any pet lover.</p>
      <p><a href="${config.baseUrl}/" >${config.baseUrl.replace(/^https?:\/\//, '')}</a></p>
      ${footer(order)}</div>`,
  };
}

export async function runFollowups(now = Date.now()) {
  for (const o of listOrders()) {
    if (o.noMarketing || !o.email) continue;
    const age = now - Date.parse(o.createdAt);
    try {
      if (o.status === 'pending_payment' && !o.abandonedSentAt && age > HOUR && age < 48 * HOUR) {
        await sendEmail(abandonedEmail(o));
        updateOrder(o.id, { abandonedSentAt: new Date(now).toISOString() });
      }
      const deliveredAt = Date.parse(o.deliveredAt || '');
      if (deliveredAt && !o.reviewSentAt && now - deliveredAt > 72 * HOUR) {
        await sendEmail(reviewEmail(o));
        updateOrder(o.id, { reviewSentAt: new Date(now).toISOString() });
      }
    } catch (err) {
      console.error(`follow-up failed for ${o.id}`, err);
    }
  }
}

export function startFollowupScheduler() {
  const tick = () => runFollowups().catch((e) => console.error('followups', e));
  setInterval(tick, 15 * 60_000).unref();
  setTimeout(tick, 30_000).unref();
}
