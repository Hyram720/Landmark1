// Builds the weekly issue (fetch -> curate -> write copy) and renders it for the web and for email.
import config from './config.js';
import { fetchAll } from './sources.js';
import { curate, personalize } from './curate.js';
import { writeCopy } from './writer.js';
import { getIssue, saveIssue } from './store.js';

// ISO-8601 week id, e.g. 2026-W43. Issues are keyed by it so each week is built and sent once.
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function buildIssue(week = isoWeek(), { force = false } = {}) {
  const existing = getIssue(week);
  if (existing && !force) return existing;
  const picks = curate(await fetchAll());
  const copy = await writeCopy(picks);
  return saveIssue({
    week,
    createdAt: new Date().toISOString(),
    ...picks,
    copy,
    sentTo: existing?.sentTo || [],
    clicks: existing?.clicks || {},
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const money = (n) => (n === 0 ? 'Free' : `$${n.toFixed(2)}`);

// Every outbound link goes through /out so we can count clicks (and apply an affiliate template to deals).
export const outLink = (week, item) => `${config.baseUrl}/out/${week}/${encodeURIComponent(item.id)}`;
export function destination(item) {
  if (item.kind === 'deal' && config.dealLinkTemplate) return config.dealLinkTemplate.replace('{url}', encodeURIComponent(item.url));
  return item.url;
}

function meta(item) {
  if (item.kind === 'free') {
    return [
      item.store,
      item.worth ? `normally $${item.worth.toFixed(2)}` : null,
      item.endsAt ? `free until ${fmtDate(item.endsAt)}` : 'free while it lasts',
    ].filter(Boolean).join(' · ');
  }
  return [
    item.store,
    `<s>${money(item.normalPrice)}</s> <strong>${money(item.price)}</strong> (-${item.savings}%)`,
    item.ratingText ? `${item.ratingText} on Steam` : null,
  ].filter(Boolean).join(' · ');
}

function card(issue, item, { email }) {
  const blurb = issue.copy.blurbs?.[item.id];
  const pick = issue.copy.pickOfTheWeek === item.id;
  const href = outLink(issue.week, item);
  const box = email
    ? 'border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:12px 0;background:#fff'
    : '';
  return `<div class="item${pick ? ' pick' : ''}" style="${box}">
    ${item.image ? `<a href="${href}"><img src="${esc(item.image)}" alt="" width="460" style="width:100%;max-width:460px;height:auto;max-height:220px;object-fit:cover;border-radius:6px;display:block;margin-bottom:8px"></a>` : ''}
    ${pick ? `<div style="font-size:12px;font-weight:700;color:#7c3aed;letter-spacing:.05em">PICK OF THE WEEK</div>` : ''}
    <div style="font-size:17px;font-weight:700"><a href="${href}" style="color:#111;text-decoration:none">${esc(item.title)}</a></div>
    <div style="font-size:13px;color:#6b7280;margin:4px 0">${meta(item)}</div>
    ${blurb ? `<div style="font-size:15px;margin:6px 0">${esc(blurb)}</div>` : item.about ? `<div style="font-size:14px;color:#374151">${esc(item.about)}</div>` : ''}
    ${item.catch ? `<div style="font-size:13px;color:#b45309">Heads up: ${esc(item.catch)}</div>` : ''}
    <a href="${href}" style="display:inline-block;margin-top:8px;background:#7c3aed;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">${item.kind === 'free' ? 'Claim it free' : 'See the deal'}</a>
  </div>`;
}

function sections(issue, picks, opts) {
  const sponsor = config.sponsor
    ? `<div style="border:1px dashed #a78bfa;border-radius:10px;padding:12px;margin:16px 0;font-size:14px"><span style="color:#7c3aed;font-weight:700;font-size:12px">SPONSOR</span><br><a href="${esc(config.sponsor.url)}">${esc(config.sponsor.text)}</a></div>`
    : '';
  return `
    ${picks.free.length ? `<h2 style="font-size:20px;margin:24px 0 4px">Free to keep</h2>${picks.free.map((i) => card(issue, i, opts)).join('')}` : ''}
    ${sponsor}
    ${picks.deals.length ? `<h2 style="font-size:20px;margin:24px 0 4px">Worth buying on sale</h2><p style="color:#6b7280;font-size:13px;margin:0">Rated 80%+ on Steam by 500+ players, at least 50% off.</p>${picks.deals.map((i) => card(issue, i, opts)).join('')}` : ''}
    ${!picks.free.length && !picks.deals.length ? '<p>Nothing matched your filters this week. Try widening your platforms or budget.</p>' : ''}
    <p style="color:#9ca3af;font-size:12px;margin-top:24px">Free games via <a href="https://www.gamerpower.com">GamerPower</a>, deals via <a href="https://www.cheapshark.com">CheapShark</a>. Prices change fast; check the store before you buy. Some links may earn us a commission.</p>`;
}

// The headline names the week's top pick; if that pick is filtered out for this reader, lead with theirs.
function subjectFor(issue, picks) {
  const top = issue.copy.pickOfTheWeek || issue.free[0]?.id || issue.deals[0]?.id;
  const mine = [...picks.free, ...picks.deals];
  if (mine.some((i) => i.id === top)) return issue.copy.headline;
  const lead = mine[0];
  if (!lead) return issue.copy.headline;
  const more = mine.length - 1;
  return `${lead.title} is ${lead.kind === 'free' ? 'free' : `$${lead.price.toFixed(2)}`} this week${more ? ` (+${more} more)` : ''}`;
}

export function renderEmail(issue, sub) {
  const picks = personalize(issue, sub.prefs);
  const html = `<div style="background:#f5f3ff;padding:16px 0"><div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;color:#111;padding:0 16px">
    <div style="font-weight:800;font-size:18px;color:#7c3aed">${esc(config.brandName)}</div>
    <h1 style="font-size:24px;margin:12px 0 6px">${esc(issue.copy.headline)}</h1>
    <p style="font-size:15px;margin:0 0 8px">${esc(issue.copy.intro)}</p>
    ${sections(issue, picks, { email: true })}
    <p style="color:#9ca3af;font-size:12px"><a href="${config.baseUrl}/prefs/${sub.id}">Change platforms or budget</a> · <a href="${config.baseUrl}/unsubscribe/${sub.id}">Unsubscribe</a> · <a href="${config.baseUrl}/issues/${issue.week}">View on the web</a></p>
  </div></div>`;
  return { subject: subjectFor(issue, picks), html, count: picks.free.length + picks.deals.length };
}

export function renderIssuePage(issue) {
  const title = `${issue.copy.headline} | ${config.brandName} ${issue.week}`;
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(issue.copy.intro)}">
  <link rel="canonical" href="${config.baseUrl}/issues/${issue.week}">
  <meta property="og:title" content="${esc(issue.copy.headline)}"><meta property="og:description" content="${esc(issue.copy.intro)}">
  ${issue.free[0]?.image ? `<meta property="og:image" content="${esc(issue.free[0].image)}">` : ''}
  <link rel="stylesheet" href="/styles.css">
</head><body><div class="wrap">
  <header class="top"><a class="logo" href="/">Game<span>Drop</span></a><a href="/issues">Past issues</a></header>
  <p class="fine">${esc(issue.week)} · updated ${fmtDate(issue.createdAt)}</p>
  <h1>${esc(issue.copy.headline)}</h1>
  <p class="lead">${esc(issue.copy.intro)}</p>
  <div class="cta"><a class="btn" href="/#signup">Get this every Thursday, free</a></div>
  <div class="issue">${sections(issue, { free: issue.free, deals: issue.deals }, { email: false })}</div>
  <div class="cta"><a class="btn" href="/#signup">Get next week's drops by email</a></div>
</div></body></html>`;
}
