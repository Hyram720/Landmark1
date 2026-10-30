# Press Box Kicks & Jerseys (pressboxkicksjerseys.com)

Static storefront plus one Netlify Function for Stripe Checkout. It rebuilds the
single-page site that was live on Oct 25, 2026 (kept for reference in `recovered/`)
as a multi-page store.

```
node build.mjs        # renders dist/ (44 indexable pages + sitemap)
```

| Path | What it is |
|---|---|
| `src/catalog.mjs` | Every product, price, size, team option and `available` flag. Edit products here only. |
| `build.mjs` | Renders home, product, team, category and search-landing pages, sitemap, robots, schema.org |
| `static/site.js` | Locker (cart), size/team pickers, filters, bundle builder, checkout call |
| `static/styles.css` | The original stylesheet plus multi-page additions |
| `netlify/functions/checkout.mjs` | `POST /api/checkout`: re-prices the cart from the catalog, applies 10% off 3+ items, and opens Stripe Checkout |
| `netlify.toml` | Build settings, `/news` redirect, and the image proxy (see below) |
| `recovered/` | The original `app.js`, `styles.css` and rendered homepage. Not deployed. |

## What changed from the live site

- **Checkout works:** the "checkout preview / awaiting Fred's approval" modal is replaced by Stripe Checkout (card, Apple Pay, Google Pay, Link). Prices are checked on the server.
- **Cart starts empty:** the live site pre-loaded every visitor's cart with an Eagles jersey and a hat. The cart is now saved between pages.
- **Mitchell & Ness jerseys are "Coming soon":** they can't be bought, and each page has a notify-me email form (Netlify Forms).
- **Multi-team FOCO items** (hoodie, knit sweater, crewneck, slides) now ask for a team. Before, orders didn't say which team.
- **Pages:** 24 product pages, 10 team pages, 4 category pages, plus landing pages for "kelly green eagles jersey", "allen iverson jersey" and "eagles kelly green hat". Each has a canonical URL, Product/Breadcrumb/ItemList schema and a sitemap entry.
- **Copy removed:**
  - supplier names (Casey's, eBay, SanMar, "dropship")
  - internal labels
  - the Gmail address and the wrong-domain meta description
  - the 15 U.S.C. § 1114 notice
  - MSRP strike-through prices and "SAVE $X" badges
  - "Only 2 left" scarcity badges
  - unverifiable stats
- **The Press Box Wire news section** is off the site for now. Its articles leaned on numbers we can't support. The originals are in `recovered/app.js` (`WIRE_ARTICLES`) to rewrite later.

## Images

Product photos aren't in the repo yet; they couldn't be downloaded from this build
environment. Until they are, `netlify.toml` serves `/assets/*` from the Oct 25
deploy. To bring them in, save each file from
`https://pressboxkicksjerseys.com/assets/<name>.png` into `pressbox/assets/`. Files
there are deployed directly and take priority over the proxy.

## Going live (Fred's checklist)

1. **Stripe:** in the Netlify project → Site configuration → Environment variables, add `STRIPE_SECRET_KEY` (secret, Functions scope). Use a `sk_test_…` key first and place a test order, then switch to `sk_live_…`. In Stripe → Settings → Payment methods, turn on Apple Pay and Google Pay.
2. **Deploy a preview, not production:**
   - From this folder: `npx netlify-cli deploy --build --site a7a7f27a-d847-4b4c-8a21-4a2119382fe1`. Without `--prod` this makes a draft URL.
   - Or connect the Netlify project to GitHub `hyram720/landmark1` with Base directory `pressbox` and branch deploys on.
   - Check the draft, then deploy with `--prod`.
3. **Forms:** Netlify → Forms → enable form detection. Notify-me sign-ups appear there.
4. **Email:** set up `orders@pressboxkicksjerseys.com` (forwarding to Gmail is fine) before launch. The site now links to it.
5. **Check these facts before going live.** The site states them as true:
   - sneaker names and SKUs match what your supplier ships
   - product photos show the real items
   - FOCO team options in `src/catalog.mjs` are actually stocked
   - shipping is $9.99 flat under $150, ships in 2–4 business days, and arrives in 3–8 business days
   - the returns policy on `/shipping-returns/` (30 days unworn, buyer pays return shipping, custom caps final sale)
   - the "full refund if not genuine" promise
6. **Tracking (optional):** set `GA_MEASUREMENT_ID` and/or `META_PIXEL_ID` as Netlify build environment variables and redeploy. The tags are added automatically.
7. **Search:** submit `https://pressboxkicksjerseys.com/sitemap.xml` in Google Search Console.
8. **Mitchell & Ness launch:** when the account is approved, set `available: true` on those products in `src/catalog.mjs` and redeploy.
