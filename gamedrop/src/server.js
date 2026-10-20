import express from 'express';
import config from './config.js';
import { newToken, getSubscriber, saveSubscriber, listSubscribers, findSubscriberByEmail, getIssue, saveIssue, listIssues } from './store.js';
import { cleanPrefs, PLATFORM_LABELS } from './curate.js';
import { isoWeek, buildIssue, renderIssuePage, renderEmail, destination } from './issue.js';
import { sendEmail, confirmEmail, alertOwner } from './mailer.js';
import { startScheduler, sendIssueTo, recipients } from './scheduler.js';

const app = express();
app.set('trust proxy', true);
const publicDir = new URL('../public', import.meta.url).pathname;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('/health', (req, res) => res.json({ ok: true }));

const latestIssue = () => listIssues()[0] || null;
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | ${config.brandName}</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/styles.css"></head><body><div class="wrap"><header class="top"><a class="logo" href="/">Game<span>Drop</span></a></header>${body}</div></body></html>`;

// Signups are cheap to abuse (each sends a confirm email), so cap them per visitor.
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Too many signups from your network. Try again later.' });
  hits.set(req.ip, [...recent, now]);
  next();
}

app.post('/api/subscribe', rateLimit, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That email address looks off.' });
  const prefs = cleanPrefs(req.body);
  let sub = findSubscriberByEmail(email);
  if (sub?.confirmed && !sub.unsubscribed) {
    // Don't reveal or change anything for an existing subscriber; their own emails have a prefs link.
    return res.json({ ok: true, message: "You're already subscribed. Check any issue for the link to change your settings." });
  }
  sub = saveSubscriber({ ...(sub || { id: newToken(), createdAt: new Date().toISOString() }), email, prefs, confirmed: false, unsubscribed: false, source: String(req.body.source || '').slice(0, 60) || null });
  try {
    await sendEmail(confirmEmail(sub));
    if (config.devMode) console.log(`[dev] confirm link: ${config.baseUrl}/confirm/${sub.id}`);
    res.json({ ok: true, message: 'Check your inbox and click the confirm link.' });
  } catch (err) {
    alertOwner('Confirm email failed', `${email}: ${err.message}`);
    res.status(500).json({ error: 'We could not send the confirmation email. Please try again shortly.' });
  }
});

app.get('/confirm/:id', async (req, res) => {
  const sub = getSubscriber(req.params.id);
  if (!sub) return res.status(404).send(page('Not found', '<h1>Link not found</h1><p>Try signing up again.</p>'));
  const first = !sub.confirmed;
  saveSubscriber({ ...sub, confirmed: true, unsubscribed: false, confirmedAt: sub.confirmedAt || new Date().toISOString() });
  // Instant value: send the latest issue right away. If this week's send already went out, mark it so
  // it isn't repeated; if it's still a midweek preview, they also get the real issue on Thursday.
  const issue = first && latestIssue();
  if (issue && !issue.sentTo.includes(sub.id)) {
    sendIssueTo(issue, { ...sub, confirmed: true })
      .then(() => {
        const fresh = getIssue(issue.week);
        if (fresh.sendStartedAt && !fresh.sentTo.includes(sub.id)) saveIssue({ ...fresh, sentTo: [...fresh.sentTo, sub.id] });
      })
      .catch((e) => console.error('welcome issue failed', e.message));
  }
  res.send(page("You're in", `<h1>You're in 🎮</h1><p class="lead">${issue ? "This week's drops are on their way to your inbox now." : 'Your first issue arrives Thursday.'} After that, it's every Thursday.</p><p><a href="/prefs/${sub.id}">Change platforms or budget</a></p>`));
});

function prefsForm(sub, saved) {
  const p = sub.prefs || cleanPrefs();
  return page('Your settings', `
    <h1>Your settings</h1>
    ${saved ? '<p class="ok">Saved. Your next issue will use these.</p>' : ''}
    <form method="post" action="/prefs/${sub.id}" class="panel">
      <p class="fine">Sending to ${sub.email.replace(/</g, '&lt;')}</p>
      <label>Platforms you play on</label>
      <div class="chips">${Object.entries(PLATFORM_LABELS).map(([k, v]) => `<label class="chip"><input type="checkbox" name="platforms" value="${k}" ${p.platforms.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div>
      <label for="maxPrice">Max price for deals ($)</label>
      <input type="number" id="maxPrice" name="maxPrice" min="0" max="200" value="${p.maxPrice}">
      <button type="submit">Save</button>
    </form>
    <p><a href="/unsubscribe/${sub.id}">Unsubscribe</a></p>`);
}

app.get('/prefs/:id', (req, res) => {
  const sub = getSubscriber(req.params.id);
  if (!sub) return res.status(404).send(page('Not found', '<h1>Link not found</h1>'));
  res.send(prefsForm(sub, false));
});

app.post('/prefs/:id', (req, res) => {
  const sub = getSubscriber(req.params.id);
  if (!sub) return res.status(404).send(page('Not found', '<h1>Link not found</h1>'));
  res.send(prefsForm(saveSubscriber({ ...sub, prefs: cleanPrefs(req.body) }), true));
});

// GET shows a confirmation button (link scanners must not unsubscribe people); POST does it,
// which is also what mail clients call for one-click List-Unsubscribe.
app.get('/unsubscribe/:id', (req, res) => {
  const sub = getSubscriber(req.params.id);
  if (!sub) return res.status(404).send(page('Not found', '<h1>Link not found</h1>'));
  res.send(page('Unsubscribe', `<h1>Unsubscribe?</h1><form method="post" action="/unsubscribe/${sub.id}"><button type="submit">Yes, stop the emails</button></form><p><a href="/prefs/${sub.id}">Or change what you get instead</a></p>`));
});
app.post('/unsubscribe/:id', (req, res) => {
  const sub = getSubscriber(req.params.id);
  if (sub) saveSubscriber({ ...sub, unsubscribed: true, unsubscribedAt: new Date().toISOString() });
  res.send(page('Unsubscribed', "<h1>Done</h1><p>You won't get any more emails. Changed your mind? Sign up again any time.</p>"));
});

// Public issue pages: shareable, indexable, and the landing page preview.
app.get('/api/latest', (req, res) => {
  const issue = latestIssue();
  if (!issue) return res.json(null);
  const { week, copy, free, deals } = issue;
  res.json({ week, headline: copy.headline, intro: copy.intro, free: free.slice(0, 3).map(({ title, store, worth, image }) => ({ title, store, worth, image })), freeCount: free.length, dealCount: deals.length });
});

app.get('/issues', (req, res) => {
  const items = listIssues().map((i) => `<li><a href="/issues/${i.week}">${i.week}: ${i.copy.headline.replace(/</g, '&lt;')}</a></li>`).join('');
  res.send(page('Past issues', `<h1>Past issues</h1><ul>${items || '<li>The first issue is on its way.</li>'}</ul><a class="btn" href="/#signup">Get it every Thursday</a>`));
});

app.get('/issues/:week', (req, res) => {
  let issue = null;
  try {
    issue = getIssue(req.params.week);
  } catch {}
  if (!issue) return res.status(404).send(page('Not found', '<h1>Issue not found</h1>'));
  res.send(renderIssuePage(issue));
});

// Click tracking: counts per item, then redirects. Only items in that issue can be targets (no open redirect).
app.get('/out/:week/:itemId', (req, res) => {
  let issue = null;
  try {
    issue = getIssue(req.params.week);
  } catch {}
  const item = issue && [...issue.free, ...issue.deals].find((i) => i.id === req.params.itemId);
  if (!item) return res.redirect(302, '/');
  issue.clicks[item.id] = (issue.clicks[item.id] || 0) + 1;
  saveIssue(issue);
  res.redirect(302, destination(item));
});

app.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/issues', ...listIssues().map((i) => `/issues/${i.week}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${config.baseUrl}${u}</loc></url>`).join('\n')}\n</urlset>`);
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /out/\nDisallow: /prefs/\nDisallow: /confirm/\nDisallow: /unsubscribe/\nSitemap: ${config.baseUrl}/sitemap.xml\n`));

// Owner dashboard + manual controls.
const isAdmin = (req) => config.adminKey && req.query.key === config.adminKey;
app.get('/admin', (req, res) => {
  if (!isAdmin(req)) return res.status(401).send('unauthorized');
  const subs = listSubscribers();
  const active = recipients(subs);
  res.json({
    subscribers: { active: active.length, pending: subs.filter((s) => !s.confirmed).length, unsubscribed: subs.filter((s) => s.unsubscribed).length },
    byPlatform: Object.fromEntries(Object.keys(PLATFORM_LABELS).map((p) => [p, active.filter((s) => s.prefs.platforms.includes(p)).length])),
    issues: listIssues().slice(0, 12).map((i) => ({ week: i.week, headline: i.copy.headline, copyBy: i.copy.source, sent: i.sentTo.length, clicks: Object.values(i.clicks).reduce((a, b) => a + b, 0) })),
  });
});

app.post('/admin/build', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send('unauthorized');
  try {
    const issue = await buildIssue(isoWeek(), { force: req.query.force === '1' });
    res.json({ week: issue.week, headline: issue.copy.headline, copyBy: issue.copy.source, free: issue.free.length, deals: issue.deals.length, url: `${config.baseUrl}/issues/${issue.week}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/test-send', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send('unauthorized');
  const issue = latestIssue();
  if (!issue || !req.query.to) return res.status(400).json({ error: 'need ?to= and a built issue' });
  const email = renderEmail(issue, { id: '0'.repeat(32), email: req.query.to, prefs: cleanPrefs() });
  await sendEmail({ to: req.query.to, subject: `[TEST] ${email.subject}`, html: email.html });
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`${config.brandName} on ${config.baseUrl}${config.devMode ? ' (dev mode)' : ''}`);
  if (!config.anthropic.apiKey) console.warn('ANTHROPIC_API_KEY not set: issues will use template copy.');
  if (!config.email.resendKey) console.warn('RESEND_API_KEY not set: emails are logged, not sent.');
  startScheduler();
});
