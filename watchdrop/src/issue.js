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

export async function buildIssue(week = isoWeek(), { force = false, now = new Date() } = {}) {
  const existing = getIssue(week);
  if (existing && !force) return existing;
  const picks = curate(await fetchAll());
  const copy = await writeCopy(picks);
  return saveIssue({
    week,
    createdAt: now.toISOString(),
    ...picks,
    copy,
    sentTo: existing?.sentTo || [],
    sendStartedAt: existing?.sendStartedAt || null,
    clicks: existing?.clicks || {},
  });
}

export const allItems = (issue) => [...issue.new, ...issue.leaving, ...issue.free];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// Every outbound link goes through /out so we can count clicks. ?s= picks the reader's service.
export const outLink = (week, item, service) => `${config.baseUrl}/out/${week}/${encodeURIComponent(item.id)}?s=${encodeURIComponent(service.id)}`;
export function destination(item, serviceId) {
  return (item.services.find((s) => s.id === serviceId) || item.services[0]).link;
}

function meta(item) {
  const names = item.services.map((s) => s.name).join(', ');
  const where =
    item.kind === 'leaving'
      ? `Leaving ${names}${item.services[0].date ? ` ${fmtDate(item.services[0].date)}` : ' soon'}`
      : item.kind === 'free'
        ? `Free on ${names}`
        : `New on ${names}`;
  return [where, item.showType === 'series' ? 'Series' : 'Movie', item.year, item.genres.slice(0, 2).join('/'), item.rating ? `${item.rating}/100` : null]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
}

function card(issue, item, { email }) {
  const blurb = issue.copy.blurbs?.[item.id];
  const pick = issue.copy.pickOfTheWeek === item.id;
  const service = item.services[0];
  const href = outLink(issue.week, item, service);
  const box = email ? 'border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:12px 0;background:#fff' : '';
  const accent = item.kind === 'leaving' ? '#dc2626' : '#e11d48';
  return `<div class="item${pick ? ' pick' : ''}" style="${box}">
    ${item.image ? `<a href="${href}"><img src="${esc(item.image)}" alt="" width="460" style="width:100%;max-width:460px;height:auto;max-height:220px;object-fit:cover;border-radius:6px;display:block;margin-bottom:8px"></a>` : ''}
    ${pick ? `<div style="font-size:12px;font-weight:700;color:${accent};letter-spacing:.05em">PICK OF THE WEEK</div>` : ''}
    <div style="font-size:17px;font-weight:700"><a href="${href}" style="color:#111;text-decoration:none">${esc(item.title)}</a></div>
    <div style="font-size:13px;color:#6b7280;margin:4px 0">${meta(item)}</div>
    ${blurb ? `<div style="font-size:15px;margin:6px 0">${esc(blurb)}</div>` : item.overview ? `<div style="font-size:14px;color:#374151">${esc(item.overview)}</div>` : ''}
    <a href="${href}" style="display:inline-block;margin-top:8px;background:${accent};color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">Watch on ${esc(service.name)}</a>
  </div>`;
}

const SECTIONS = [
  ['new', 'New and worth it', 'Added to your services this week, rated 70+.'],
  ['leaving', 'Leaving soon', 'Last chance in the next two weeks.'],
  ['free', 'Free this week', 'Good stuff on free, ad-supported services. No subscription needed.'],
];

function sections(issue, picks, opts) {
  const sponsor = config.sponsor
    ? `<div style="border:1px dashed #fda4af;border-radius:10px;padding:12px;margin:16px 0;font-size:14px"><span style="color:#e11d48;font-weight:700;font-size:12px">SPONSOR</span><br><a href="${esc(config.sponsor.url)}">${esc(config.sponsor.text)}</a></div>`
    : '';
  const parts = SECTIONS.filter(([key]) => picks[key].length).map(
    ([key, title, sub]) => `<h2 style="font-size:20px;margin:24px 0 4px">${title}</h2><p style="color:#6b7280;font-size:13px;margin:0">${sub}</p>${picks[key].map((i) => card(issue, i, opts)).join('')}`
  );
  if (parts.length > 1) parts.splice(1, 0, sponsor);
  return `
    ${parts.join('')}
    ${!parts.length ? '<p>Nothing matched your services this week. Try adding a few more in your settings.</p>' : ''}
    <p style="color:#9ca3af;font-size:12px;margin-top:24px">Streaming data via the <a href="https://www.movieofthenight.com/about/api">Streaming Availability API</a>. Catalogs change fast; check the service before you settle in.</p>`;
}

// The headline names the week's top pick; if that pick isn't on this reader's services, lead with theirs.
function subjectFor(issue, picks) {
  const top = issue.copy.pickOfTheWeek || issue.new[0]?.id || issue.free[0]?.id;
  const mine = [...picks.new, ...picks.leaving, ...picks.free];
  if (mine.some((i) => i.id === top)) return issue.copy.headline;
  const lead = picks.new[0] || picks.free[0] || picks.leaving[0];
  if (!lead) return issue.copy.headline;
  const verb = lead.kind === 'leaving' ? 'is leaving' : lead.kind === 'free' ? 'is free on' : 'is new on';
  const more = mine.length - 1;
  return `${lead.title} ${verb} ${lead.services[0].name}${more ? ` (+${more} more)` : ''}`;
}

export function renderEmail(issue, sub) {
  const picks = personalize(issue, sub.prefs);
  const html = `<div style="background:#fff1f2;padding:16px 0"><div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;color:#111;padding:0 16px">
    <div style="font-weight:800;font-size:18px;color:#e11d48">${esc(config.brandName)}</div>
    <h1 style="font-size:24px;margin:12px 0 6px">${esc(issue.copy.headline)}</h1>
    <p style="font-size:15px;margin:0 0 8px">${esc(issue.copy.intro)}</p>
    ${sections(issue, picks, { email: true })}
    <p style="color:#9ca3af;font-size:12px"><a href="${config.baseUrl}/prefs/${sub.id}">Change your services</a> · <a href="${config.baseUrl}/unsubscribe/${sub.id}">Unsubscribe</a> · <a href="${config.baseUrl}/issues/${issue.week}">View on the web</a></p>
  </div></div>`;
  return { subject: subjectFor(issue, picks), html, count: picks.new.length + picks.leaving.length + picks.free.length };
}

export function renderIssuePage(issue) {
  const title = `${issue.copy.headline} | ${config.brandName} ${issue.week}`;
  const ogImage = allItems(issue).find((i) => i.image)?.image;
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(issue.copy.intro)}">
  <link rel="canonical" href="${config.baseUrl}/issues/${issue.week}">
  <meta property="og:title" content="${esc(issue.copy.headline)}"><meta property="og:description" content="${esc(issue.copy.intro)}">
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
  <link rel="stylesheet" href="/styles.css">
</head><body><div class="wrap">
  <header class="top"><a class="logo" href="/">Watch<span>Drop</span></a><a href="/issues">Past issues</a></header>
  <p class="fine">${esc(issue.week)} · updated ${fmtDate(issue.createdAt)}</p>
  <h1>${esc(issue.copy.headline)}</h1>
  <p class="lead">${esc(issue.copy.intro)}</p>
  <div class="cta"><a class="btn" href="/#signup">Get this for your services every Thursday, free</a></div>
  <div class="issue">${sections(issue, { new: issue.new, leaving: issue.leaving, free: issue.free }, { email: false })}</div>
  <div class="cta"><a class="btn" href="/#signup">Get next week's picks by email</a></div>
</div></body></html>`;
}
