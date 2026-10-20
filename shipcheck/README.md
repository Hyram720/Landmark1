# ShipCheck: a pre-launch security check for vibe-coded apps

People build apps in Cursor, Lovable, Bolt and Claude Code, then launch them with leaked API keys, Supabase tables anyone can read, and Stripe webhooks anyone can fake. ShipCheck finds those problems in about 30 seconds and gives a copy-paste fix prompt for each one.

## The business

| | |
|---|---|
| **Customer** | Solo builders and indie hackers shipping AI-built apps |
| **Free** | Scan + score + the list of problems (by name only) |
| **Paid, $19 one-time** | Exact file and line, plain-English explanation, and a fix prompt for their AI coding tool |
| **Cost per scan** | About $0. It's pure static analysis, with no AI calls and no source code stored |
| **Margin** | About 95% after Stripe fees |

**Why the free scan sells the paid report:** the free scan tells someone "Supabase service_role key in code" but not where it is. That gap between "you have a problem" and "here's the fix" is what they pay $19 for.

**Fully automated:** scan → preview → Stripe Checkout → webhook unlocks the report → email with the private link. The only human work is reading the failure alerts that `ALERT_EMAIL` receives and checking `/admin?key=...` (scans, paid count, conversion rate, revenue).

## What it checks

| Severity | Check |
|---|---|
| Critical | Hardcoded keys: OpenAI, Anthropic, Stripe live, AWS, GitHub, Google, Resend, Slack, private keys |
| Critical | Supabase `service_role` JWT in code (the anon key is correctly ignored) |
| Critical | SQL tables created without `enable row level security` |
| Critical | Firebase rules that allow everyone (`if true`) |
| Critical | Committed `.env` files |
| High | Secrets in `NEXT_PUBLIC_` / `VITE_` / `REACT_APP_` / `EXPO_PUBLIC_` vars |
| High | OpenAI or Anthropic SDK with `dangerouslyAllowBrowser: true` |
| High | Stripe webhooks that skip signature verification |
| High | RLS policies of `using (true)` |
| Medium | CORS `*` combined with credentials |
| Low | `.gitignore` missing `.env`, no lockfile, raw HTML rendering |

**Safety by design:**
- It only reads code the customer submits (a public GitHub repo or a .zip upload). It never sends requests to anyone's live site.
- Archives are read in memory and never extracted to disk.
- Found secrets are masked (first 6 characters plus the length), and source code isn't stored.

## Launch checklist

1. **Accounts:** Stripe, Resend, a domain (e.g. shipcheck.dev), and a Railway or Render host.
2. **Deploy:** this `shipcheck/` folder is its own app.
   - Set the service's root directory to `shipcheck`.
   - Use start command `npm start`.
   - Mount a persistent volume at `/data`.
   - Copy `.env.example` into the host's environment variables and fill them in.
3. **Stripe:**
   - Add a webhook pointing to `https://YOURDOMAIN/webhooks/stripe` for `checkout.session.completed`.
   - Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. **Smoke test:** scan one of your own repos, pay $19 with a real card, confirm the email arrives, then refund yourself.

## Getting customers (playbook)

1. **Content loop (free, compounding):** offer free scans to builders who volunteer their apps, then post anonymized "what we found in 50 vibe-coded apps" threads on X, Reddit (r/vibecoding, r/SideProject, r/cursor, r/Supabase) and Indie Hackers. Share aggregate stats only: never name a project or post its secrets.
2. **Launch:** Product Hunt and Hacker News "Show HN", leading with the free scan.
3. **Short video:** show a 30-second screen recording of a scan turning 45 into 100 after pasting the fix prompts. It suits TikTok, Shorts and X.
4. **Partnerships:** AI coding YouTubers and newsletters, with a 30% affiliate offer via Stripe promotion codes.
5. **Upsells (next):** a $9/month "scan on every push" GitHub Action, and a $49 "launch pack" that includes a human-reviewed summary.

Positioning: ShipCheck is an automated check for common, costly mistakes. It isn't a full audit or a guarantee, and the site says so.

## Local development

```bash
npm install
npm run dev     # http://localhost:3000. Reports unlock without payment; emails print to the console.
npm test
```

## Layout

```
src/scanner.js   the checks, masking, scoring, fix prompts
src/intake.js    GitHub zip download + in-memory zip reading
src/server.js    scan API, free preview vs paid report, Stripe webhook, admin
src/stripe.js    Checkout + webhook signature verification (no SDK)
src/notify.js    report email + owner alerts (Resend)
public/          landing page + report page
```
