// Search landing pages: one per question vibe coders actually type into Google, each ending in the free scan.
import config from './config.js';

export const GUIDES = {
  'lovable-app-security-checklist': {
    title: 'Lovable app security checklist before you launch',
    description: 'The 7 security mistakes Lovable apps ship with most often (open Supabase tables, leaked keys, fake-able payments) and how to fix each one.',
    intro: [
      'Lovable gets you from idea to working app in an afternoon. It does not stop you from launching with your database open to the internet.',
      'Most Lovable apps run on Supabase. The anon key that ships in your frontend is meant to be public, but only if every table has Row Level Security (RLS) and sensible policies. If even one table is missing RLS, anyone can read or overwrite it with a few lines of JavaScript.',
    ],
    checks: [
      ['Every table has RLS enabled', 'In Supabase, open Table Editor and look for the "RLS disabled" warning, or check your migrations for <code>enable row level security</code>.'],
      ['No policy says <code>using (true)</code>', 'That turns RLS back off. Scope policies to <code>auth.uid() = user_id</code>.'],
      ['The service_role key is not in your code', 'It bypasses RLS entirely. It belongs only in edge functions or server env vars.'],
      ['AI API keys live in edge functions', 'An OpenAI key in a <code>VITE_</code> variable ships to every visitor.'],
      ['Stripe webhooks verify signatures', 'Otherwise anyone can fake a "payment succeeded" event.'],
      ['.env is not committed', 'Check your GitHub repo. If it is there, rotate every key in it.'],
      ['Raw HTML from AI output is sanitized', 'Rendering model output as HTML opens the door to XSS.'],
    ],
  },
  'supabase-rls-checker': {
    title: 'Supabase RLS checker: find tables without Row Level Security',
    description: 'Check every table in your Supabase migrations for missing Row Level Security and policies that allow everyone. Free scan, results in seconds.',
    intro: [
      'A Supabase table without Row Level Security is readable and writable by anyone who has your anon key, and your anon key is in your frontend bundle by design.',
      'ShipCheck reads your SQL migrations and flags every <code>create table</code> that is never followed by <code>enable row level security</code>, plus any policy written as <code>using (true)</code>.',
    ],
    checks: [
      ['Tables created without RLS', 'Fix: <code>alter table public.your_table enable row level security;</code>'],
      ['Policies that allow everyone', 'Fix: replace <code>using (true)</code> with an ownership check like <code>auth.uid() = user_id</code>.'],
      ['service_role key in client code', 'We decode Supabase JWTs and only flag the service_role key, never the safe anon key.'],
    ],
  },
  'exposed-openai-api-key': {
    title: 'Is your OpenAI API key exposed? How to check and fix it',
    description: 'Find OpenAI and Anthropic API keys committed to your repo or shipped to the browser, then rotate and move them server-side.',
    intro: [
      'Bots scan GitHub for API keys around the clock. A leaked OpenAI key can be drained within hours, and you pay for whatever it is used for.',
      'Keys leak in three common ways: committed directly in code, committed in a <code>.env</code> file, or exposed to the browser through a <code>NEXT_PUBLIC_</code> or <code>VITE_</code> variable or <code>dangerouslyAllowBrowser: true</code>.',
    ],
    checks: [
      ['Hardcoded keys', 'We detect OpenAI, Anthropic, Stripe, AWS, GitHub, Google, Resend and Slack keys, and show them masked.'],
      ['Committed .env files', 'If one is in your repo, it is in your git history too. Rotate the keys.'],
      ['Keys in public env vars', 'Anything prefixed <code>NEXT_PUBLIC_</code>, <code>VITE_</code>, <code>REACT_APP_</code> or <code>EXPO_PUBLIC_</code> is public.'],
      ['AI SDKs running in the browser', 'Move the call to a server route; the browser should call your route, not OpenAI.'],
    ],
  },
  'stripe-webhook-signature-verification': {
    title: 'Stripe webhook signature verification: are your payments fake-able?',
    description: 'If your Stripe webhook does not verify signatures, anyone can unlock your product for free. Check your code in seconds.',
    intro: [
      'AI coding tools often write a webhook that reads <code>checkout.session.completed</code> straight from the request body. That works in testing, and it also lets anyone send the same JSON and get your product without paying.',
      'The fix is one call: <code>stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)</code>, using the raw request body rather than parsed JSON.',
    ],
    checks: [
      ['Webhook handlers without verification', 'We flag handlers that react to payment events but never call <code>constructEvent</code>.'],
      ['Live secret keys in code', '<code>sk_live_</code> keys belong in server env vars only.'],
    ],
  },
  'bolt-new-app-security': {
    title: 'Bolt.new app security: what to check before going live',
    description: 'A pre-launch security check for apps built with Bolt.new: leaked keys, open databases, public env vars and unverified payments.',
    intro: [
      'Bolt.new projects are usually Vite or Next.js frontends talking to Supabase or Firebase. The same handful of mistakes shows up again and again: secrets in <code>VITE_</code> variables, tables without RLS, and Firebase rules left in test mode.',
      'Download your project as a zip from Bolt and run it through ShipCheck to see exactly where each problem is.',
    ],
    checks: [
      ['Secrets in VITE_ variables', 'Vite inlines every <code>VITE_</code> variable into your public JavaScript.'],
      ['Firebase rules in test mode', '<code>allow read, write: if true</code> means anyone can dump or wipe your data.'],
      ['Supabase tables without RLS', 'Enable RLS on every table and write ownership policies.'],
      ['Committed .env files', 'Add <code>.env*</code> to .gitignore before your first push.'],
    ],
  },
  'cursor-vibe-coding-security': {
    title: 'Vibe coding security: a pre-launch check for Cursor and Claude Code projects',
    description: 'AI coding agents write working code fast, and sometimes insecure code. Here is what to check before you ship a vibe-coded app.',
    intro: [
      'Cursor, Claude Code and Windsurf are great at "make it work". Unless you ask, they are less careful about "make it safe to put on the internet".',
      'You don\'t need to become a security engineer. You need to catch the handful of mistakes that actually get apps hacked or bills run up, then paste a precise fix prompt back into your agent.',
    ],
    checks: [
      ['Hardcoded API keys', 'Agents sometimes inline a key "just to test" and it never gets removed.'],
      ['CORS set to * with credentials', 'This lets other websites make logged-in requests as your users.'],
      ['Unverified webhooks', 'Payment and auth webhooks must verify signatures.'],
      ['No lockfile', 'Without one, every deploy can pull different package versions.'],
    ],
  },
  'firebase-security-rules-test-mode': {
    title: 'Firebase security rules still in test mode? Check before launch',
    description: 'Firestore and Storage rules that say "if true" let anyone read or delete your data. Find and fix them before launch.',
    intro: [
      'Firebase starts new projects in test mode, which allows all reads and writes. It is easy to build the whole app on top of those rules and forget to change them.',
      'ShipCheck reads <code>firestore.rules</code>, <code>storage.rules</code> and <code>database.rules.json</code> and flags anything open to everyone.',
    ],
    checks: [
      ['allow read, write: if true', 'Replace it with <code>if request.auth != null && request.auth.uid == userId</code>.'],
      ['".read": true in Realtime Database', 'Scope reads to the authenticated user\'s own data.'],
    ],
  },
  'nextjs-env-variables-security': {
    title: 'NEXT_PUBLIC_ env variables: which secrets are you leaking?',
    description: 'Any env var prefixed NEXT_PUBLIC_ is bundled into your site\'s JavaScript. Find secrets that are public by accident.',
    intro: [
      'Next.js copies every variable starting with <code>NEXT_PUBLIC_</code> into the browser bundle at build time. That is right for a Supabase anon key or a Stripe publishable key, and a disaster for a secret key.',
      'ShipCheck flags public variables whose names say SECRET, SERVICE_ROLE, PRIVATE, OPENAI, ANTHROPIC or STRIPE_SK, along with the same patterns for Vite, Create React App and Expo.',
    ],
    checks: [
      ['NEXT_PUBLIC_*SECRET*', 'Rename it without the prefix and read it only in server components or route handlers.'],
      ['"use client" files calling AI SDKs', 'Move the call into a route handler or server action.'],
    ],
  },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function layout({ title, description, path, body, schema }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | ${esc(config.brandName)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${config.baseUrl}${path}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <link rel="stylesheet" href="/styles.css">
  ${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ''}
</head>
<body>
  <div class="wrap">
    <header class="top"><a class="logo" href="/">Ship<span>Check</span></a><a href="/guides">Guides</a></header>
    ${body}
    <footer>ShipCheck is an automated static check, not a full security audit or a guarantee.</footer>
  </div>
</body>
</html>`;
}

const cta = `<div class="panel" style="text-align:center">
  <h2 style="margin-top:0">Check your app in 30 seconds</h2>
  <p class="fine">Paste your GitHub repo or upload a zip. The scan is free.</p>
  <a class="btn" href="/#scan">Run a free scan</a>
</div>`;

export function guidePage(slug) {
  const g = GUIDES[slug];
  if (!g) return null;
  const body = `
    <article class="guide">
      <h1>${g.title}</h1>
      ${g.intro.map((p) => `<p>${p}</p>`).join('')}
      <h2>What to check</h2>
      ${g.checks.map(([h, p]) => `<div class="card" style="margin:12px 0"><h3>${h}</h3><p>${p}</p></div>`).join('')}
      ${cta}
      <h2>More guides</h2>
      <ul>${Object.entries(GUIDES).filter(([s]) => s !== slug).slice(0, 4).map(([s, o]) => `<li><a href="/guides/${s}">${esc(o.title)}</a></li>`).join('')}</ul>
    </article>`;
  return layout({
    title: g.title,
    description: g.description,
    path: `/guides/${slug}`,
    body,
    schema: { '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.description, publisher: { '@type': 'Organization', name: config.brandName } },
  });
}

export function guidesIndex() {
  const body = `<h1>Security guides for vibe coders</h1>
    <p class="fine">Plain-English checklists for shipping AI-built apps without leaking keys or data.</p>
    ${Object.entries(GUIDES).map(([s, g]) => `<a class="card" href="/guides/${s}" style="display:block;margin:12px 0;text-decoration:none"><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p></a>`).join('')}
    ${cta}`;
  return layout({ title: 'Security guides for vibe coders', description: 'Pre-launch security checklists for apps built with Lovable, Bolt, Cursor and Claude Code.', path: '/guides', body });
}

export function sitemap() {
  const urls = ['/', '/guides', ...Object.keys(GUIDES).map((s) => `/guides/${s}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${config.baseUrl}${u}</loc></url>`).join('\n')}
</urlset>`;
}

export function robots() {
  return `User-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /admin\nDisallow: /api/\nSitemap: ${config.baseUrl}/sitemap.xml\n`;
}
