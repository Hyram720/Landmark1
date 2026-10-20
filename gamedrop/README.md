# GameDrop: free games and deals actually worth playing

**The problem:** "What's worth playing this week?" Free games are scattered across Epic, Steam, GOG, itch.io, Prime, mobile and console. Sales are endless, and most of them are bad games at small discounts.

**The product:** one short email every Thursday with:
- the free games worth claiming;
- deals on well-reviewed games at half price or better;
- filtering to each reader's platforms and budget;
- a headline, intro and one-line pitch per game, written by an AI editor (Claude).

## How it runs (fully autonomous)

```
Thursday 16:00 UTC (an hour after Epic's weekly free-game rotation)
  GamerPower (free games) + CheapShark (deals)
     └─► curate.js: drop expired, rank fresh/valuable first, label points-grind keys,
                    deals need 80%+ Steam rating from 500+ reviews and 50%+ off, cheapest store wins
         └─► writer.js: Claude writes headline, intro, pick of the week, one line per game
                         (facts always come from the data; the model's copy is validated by item id)
             └─► one personalized email per subscriber (platforms + max price), resumable, never double-sent
                 └─► public web issue at /issues/<week> (shareable, indexed, in the sitemap)
```

| Automated | Owner |
|---|---|
| Fetching, ranking, writing, sending every week | Glance at `/admin?key=...` (subscribers, sends, clicks per issue) |
| Double opt-in signups, a welcome issue on confirm | Sell the sponsor slot once the list is worth it |
| Preferences page, one-click unsubscribe (Gmail/Yahoo bulk-sender rules) | |
| Click tracking on every link (`/out/...`) | |
| Failure alerts (once per week, not per retry) | |

**AI cost:** one Claude call per week, about a cent. If `ANTHROPIC_API_KEY` isn't set, or the call fails, a plain template is used and the issue still goes out.

## Money

1. **Sponsor slot** (`SPONSOR_TEXT` and `SPONSOR_URL`): one placement between the free games and the deals. Gaming and AI tools pay well for niche lists. `/admin` gives you per-issue click counts to show sponsors.
2. **Affiliate deals** (`DEAL_LINK_TEMPLATE`): wrap deal links in your affiliate program's tracking link (for example Fanatical, Humble Partner or Green Man Gaming).
3. **Later:** a paid tier ($3/month) for instant alerts when a game on your wishlist goes free or hits a target price.

Honest expectation: a newsletter makes money once it has readers. Growth comes from:
- the public issue pages (search and social shares);
- `?ref=` tracking on signups to see which channel works;
- posting each week's issue to r/FreeGameFindings, r/GameDeals and gaming Discords, plus a short-form video of the pick of the week.

## Launch checklist

1. **Resend:** create an account, verify a sending domain, set `RESEND_API_KEY` and `EMAIL_FROM`.
2. **Anthropic:** create an API key and set `ANTHROPIC_API_KEY`. This is optional but recommended, since it's what makes the issue read like an editor wrote it.
3. **Deploy:** Railway or any Node host.
   - Set the root directory to `gamedrop`.
   - Use start command `npm start`.
   - Mount a volume at `/data`.
4. **First issue:** `POST /admin/build?key=...` builds this week's issue now; then `POST /admin/test-send?key=...&to=you@...` emails you a copy.

## Local development

```bash
npm install
SOURCES_FIXTURES=test/fixtures npm run dev   # sample data, emails print to the console
npm run issue                                # build this week's issue from live data and print it
npm test
```

## Layout

```
src/sources.js    GamerPower + CheapShark fetch and normalize
src/curate.js     ranking rules, per-subscriber filtering, prefs validation
src/writer.js     Claude editor (structured output, validated) with template fallback
src/issue.js      build issue, render email + web page, click-tracked links
src/scheduler.js  weekly send: resumable, no double sends, capped retries
src/mailer.js     Resend, confirm email, owner alerts
src/server.js     signup, confirm, prefs, unsubscribe, issue pages, /out, admin
```

Data credits: free games via [GamerPower](https://www.gamerpower.com), deals via [CheapShark](https://www.cheapshark.com).
