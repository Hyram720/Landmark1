# WatchDrop: what's new, leaving and free on your streaming services

**The problem:** people pay for 3–5 streaming services and still spend 20 minutes scrolling. Publisher newsletters send everyone the same list. Streaming apps make you open them. I found nobody who tells you what's *leaving* across your services before it's gone.

**The product:** one email every Thursday, built around the services each reader pays for:
- **New and worth it:** titles added this week, rated 70+.
- **Leaving soon:** a last chance in the next two weeks, soonest first.
- **Free this week:** good titles on free, ad-supported services (Tubi, Pluto and others).
- An AI editor (Claude) writes the headline, intro, pick of the week and one line per title.

It's a sibling of [GameDrop](../gamedrop) and shares its engine: double opt-in, preferences, one-click unsubscribe, a resumable weekly send, click tracking and public issue pages.

## How it runs

```
Daily before Thursday: preview build (site shows current picks)
Thursday 16:00 UTC: fresh build, then send
  Streaming Availability API /changes
    new (last 7 days, subscription catalogs) · expiring (next 14 days) · new on free catalogs (last 14 days)
     └─► curate.js: rating floors (70 new / 65 leaving / 65 free), leaving sorted soonest first,
                    one item per title with every service it's on
         └─► writer.js: Claude copy, validated by item id (facts always come from the data)
             └─► personalize: only the reader's services and types, only their service's "Watch on" link
```

**Data costs nothing on the free plan.** The [Streaming Availability API](https://www.movieofthenight.com/about/api/pricing) free plan is 1,000 requests a month and allows commercial use.
- One build is about 15 requests.
- Daily previews plus the Thursday send come to roughly 450 a month.
- `STREAMING_MONTHLY_BUDGET` (default 900) is a hard stop; usage shows in `/admin`.
- Service IDs come from the API's `/countries` endpoint, refreshed weekly, never hard-coded.

## Money

1. **Sponsor slot** (`SPONSOR_TEXT` and `SPONSOR_URL`) between sections. `/admin` shows clicks per issue and subscribers per service. "1,200 readers who pay for Hulu" is a pitch a sponsor understands.
2. **Later:** a paid tier for instant "leaving in 3 days" alerts on a personal watchlist.

## Growth

Real US Google search volumes per month:

| Search | Monthly searches |
|---|---|
| new on netflix | 90,500 |
| what to watch tonight | 14,800 |
| best movies on tubi | 12,100 |
| free movies on tubi | 8,100 |
| what's new on hulu | 6,600 |
| leaving netflix | 1,300 |

The public issue pages are built for these searches. Lead marketing with "leaving soon" and "free on Tubi", since few others cover them. Each week, post the issue to r/television, r/movies and r/Tubi with a `?ref=` link.

## Launch checklist

1. **Streaming data:** get a free key at developers.movieofthenight.com and set `STREAMING_API_KEY`. If your key came from RapidAPI, also set `STREAMING_API_VIA_RAPIDAPI=true`.
2. **Email:** set up Resend and set `RESEND_API_KEY` and `EMAIL_FROM` (needed for confirmation emails).
3. **AI editor (optional):** set `ANTHROPIC_API_KEY`.
4. **Deploy on Railway:**
   - Set the root directory to `watchdrop`.
   - Use start command `npm start`.
   - Mount a volume at `/data`.
5. **First issue:** `POST /admin/build?key=...`, or wait about 30 seconds after boot for the preview build.

## Local development

```bash
npm install
SOURCES_FIXTURES=test/fixtures npm run dev   # sample data, emails print to the console
npm test
```
