# Custom Pet Portrait Studio (custompetportraitstudio.com)

An automated AI pet portrait business.

Customers upload a photo of their dog or cat, pick a style (The Royal, The Admiral, Astronaut, and others), and pay. Software paints 4 portraits, emails a private gallery, and ships a canvas print through print-on-demand. No inventory, no staff, no skill in the niche required.

## Why this business (the reverse-engineering)

Keyword data pulled from Google Ads (US, last 12 months) through DataForSEO:

| Search term | Avg / month | Peak (Dec) | CPC |
|---|---|---|---|
| custom pet portrait | 6,600 | 12,100 | $2.92 |
| custom dog portrait | 1,900 | 5,400 | $3.69 |
| personalized pet portrait | 1,300 | 5,400 | $2.93 |
| pet portrait from photo | 1,000 | 1,900 | $3.56 |
| custom cat portrait | 720 | 3,600 | $2.29 |
| royal pet portrait | 390 | 880 | $2.15 |
| golden retriever portrait | 260 | 720 | **$0.43** |
| german shepherd portrait | 210 | 480 | **$0.48** |

What the data shows:
- **The demand is proven and lasts all year.** Established brands already sell this exact product at scale. There are spikes at Christmas (now about 8 weeks away), Mother's Day and Father's Day, plus steady memorial demand.
- **"Competition: HIGH" means people are paying to advertise, which means it converts.** Copying a proven model is lower risk than inventing a new market.
- **Long-tail breed searches are cheap.** They cost about 85% less per click than the head term, and big competitors don't build a page for each breed. The SEO system below goes after exactly those searches.

### Unit economics (estimates; check them against your own vendor pricing)

| | Digital $29 | Canvas 12×16 $89 |
|---|---|---|
| AI image cost (4 images) | ~$1 | ~$1 |
| Stripe fees | ~$1.14 | ~$2.88 |
| Print + shipping (Printful) | n/a | ~$35–45 |
| **Gross profit before ads** | **~$27 (93%)** | **~$40–50** |

There is no inventory and no upfront product cost. You pay for each image only after a customer has paid you.

### Honest risk statement

**No business is guaranteed to make money.** This one was picked to keep the downside small:
- proven demand
- about 93% margins on digital sales
- no inventory
- under $100 to launch

The one real unknown is **customer acquisition cost** (CAC): what you pay in ads for each sale. The playbook in [`docs/MARKETING.md`](docs/MARKETING.md) tests that cheaply with $20–30 a day and hard kill rules, so you learn fast without burning money. Revenue on day one comes from paid ads, Etsy, and your own network. SEO adds up over months.

## How the automation works (~95% hands-off)

```
Customer uploads photo ─► Stripe Checkout ─► webhook ─► AI paints 4 versions ─► gallery email
                                                                  │
                                    canvas order? ─► customer taps "Print this one" ─► Printful prints & ships
                                                                  │
             1h unpaid ─► recovery email (15% code)    3 days after delivery ─► review + referral email
```

| Automated | Human (the ~5%) |
|---|---|
| Checkout, payment, receipts | Glance at `/admin` once a day |
| Portrait generation (with retries) | Click **retry** on the rare failed order (you get an email) |
| Delivery email + private gallery | Answer "please repaint" replies |
| Print, pack, ship (Printful) | Approve Printful drafts if `PRINTFUL_AUTO_CONFIRM=false` |
| Abandoned checkout recovery | Scale or cut ads every 3 days, using the rules in the playbook |
| Review + referral asks | |
| 46 SEO pages, sitemap, schema | |
| 30-day social calendar, 228 Pinterest pins, ad copy | |

## Launch checklist (one afternoon)

1. **Accounts:**
   - [Stripe](https://stripe.com)
   - [OpenAI API](https://platform.openai.com) (image generation)
   - [Resend](https://resend.com) (email)
   - [Printful](https://printful.com) (free; print-on-demand)
   - a domain name
2. **Deploy:** Railway, Render or any Node host. Mount a persistent volume at `/data`, copy `.env.example` into your host's environment variables, and fill them in. The start command is `npm start`.
3. **Stripe:**
   - Add a webhook to `https://yourdomain.com/webhooks/stripe` for the `checkout.session.completed` event.
   - Create the promo codes `COMEBACK15` (15% off) and `FRIEND20` (20% off).
4. **Printful:** Pick your canvas products and put their variant IDs in `PRINTFUL_VARIANT_CANVAS_SMALL` / `_LARGE`. Leave `PRINTFUL_AUTO_CONFIRM=false` for your first 10 orders, then switch it to `true`.
5. **Quality check:** Place one real $29 order with your own pet's photo. Tune the prompts in `src/config.js` until you love the results.
6. **Search engines:** Submit `https://yourdomain.com/sitemap.xml` to Google Search Console and Bing Webmaster Tools.
7. **Marketing content:** Run `BASE_URL=https://yourdomain.com npm run content`, then follow `docs/MARKETING.md`.

## Local development

```bash
npm install
npm run dev          # http://localhost:3000. No payments, mock images, emails print to the console.
```

Owner dashboard: `/admin?key=YOUR_ADMIN_KEY`. It shows revenue, every order, which ad or page each order came from, and retry buttons.

## Project layout

```
src/server.js       routes: checkout, webhook, gallery, SEO pages, admin
src/pipeline.js     paid order → generate → email → print
src/generate.js     AI portrait generation (OpenAI image edits; mock mode for testing)
src/stripe.js       Stripe Checkout + webhook signature verification (no SDK)
src/printful.js     print-on-demand fulfillment
src/followups.js    abandoned-checkout recovery, review + referral emails
src/seo.js          38 breed pages + 7 gift-occasion pages, schema.org, sitemap, robots
src/config.js       styles (prompts), products, prices, all settings
scripts/content-engine.js   generates social calendar, Pinterest pins, Meta ad copy (CSV)
marketing/          generated CSVs (re-run with your real BASE_URL)
docs/MARKETING.md   customer acquisition playbook
```
