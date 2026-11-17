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

| | Digital $29 | Canvas 12×18 $89 |
|---|---|---|
| AI image cost (4 images) | ~$1 | ~$1 |
| Stripe fees | ~$1.14 | ~$2.88 |
| Print + shipping (Printful) | n/a | ~$25 + ~$10–15 shipping |
| **Gross profit before ads** | **~$27 (93%)** | **~$46–51** |

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
| Delivery email + private gallery | Nothing: repaints are self-serve (one per order) |
| Print, pack, ship (Printful) | Approve Printful drafts if `PRINTFUL_AUTO_CONFIRM=false` |
| Abandoned checkout recovery | Scale or cut ads every 3 days, using the rules in the playbook |
| Review + referral asks | |
| 46 SEO pages, sitemap, schema | |
| 30-day social calendar, 228 Pinterest pins, ad copy | |

## Launch checklist (one afternoon)

1. **Accounts:**
   - [Stripe](https://stripe.com)
   - [OpenAI API](https://platform.openai.com) (image generation until the Qwen cutover)
   - [Resend](https://resend.com) (email)
   - [Printful](https://printful.com) (free; print-on-demand)
   - a domain name
   - For the Qwen cutover only: a [Hugging Face token](https://huggingface.co/settings/tokens) with Inference Providers permission, or a self-hosted GPU. Do not switch `IMAGE_PROVIDER` until that cutover is approved.
2. **Deploy:** Railway, Render or any Node host. Mount a persistent volume at `/data`, copy `.env.example` into your host's environment variables, and fill them in. The start command is `npm start`.
3. **Stripe:** Set only `STRIPE_SECRET_KEY`. On startup the store creates its own webhook (and moves it when `BASE_URL` changes) and creates the `COMEBACK15` and `FRIEND20` promo codes. Check the result at `/admin/check`.
4. **Printful:** The canvas sizes are preset to 12×18 and 16×24, which fit the portraits exactly. Create an API token and set `PRINTFUL_TOKEN`. Leave `PRINTFUL_AUTO_CONFIRM=false` for your first 10 orders, then switch it to `true`.
5. **Quality check:** Place one real $29 order with your own pet's photo. Tune the prompts in `src/config.js` until you love the results.
6. **Search engines:** Submit `https://yourdomain.com/sitemap.xml` to Google Search Console and Bing Webmaster Tools.
7. **Marketing content:** Run `BASE_URL=https://yourdomain.com npm run content`, then follow `docs/MARKETING.md`.

## Local development

```bash
npm install
npm run dev          # http://localhost:3000. No payments, mock images, emails print to the console.
```

Owner dashboard: `/admin?key=YOUR_ADMIN_KEY`. It shows revenue, every order, which ad or page each order came from, and retry buttons.

Tests: `npm test`.

## Image provider

`IMAGE_PROVIDER` defaults to `openai`, which keeps today's GPT Image edit call. Set it to `qwen` to edit the customer's photo with [Qwen/Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511) (Apache-2.0). The portrait path does not read `OPENAI_API_KEY` in that mode. Demo subject photos for the showcase are text-to-image and are not created by Qwen; leave those PNGs cached. The local upscaler in `src/enhance.js` (Lanczos resize to 2400×3600 at 300 DPI) still runs after either provider.

`QWEN_BACKEND=hf` calls Hugging Face with `HF_TOKEN`. `QWEN_BACKEND=http` POSTs JSON `{ model, prompt, image, mime, seed }` to `QWEN_ENDPOINT_URL` and accepts raw image bytes or JSON `{ image }` / `{ url }`.

Which Hugging Face providers were live for this model on 17 Nov 2026, from `GET https://huggingface.co/api/models/Qwen/Qwen-Image-Edit-2511?expand[]=inferenceProviderMapping`:

| `QWEN_HF_PROVIDER` | Hub provider id | Note |
|---|---|---|
| `wavespeed` (default) | `wavespeed-ai/qwen-image/edit-2511` | The mapped id is the 2511 model. |
| `fal-ai` | `fal-ai/qwen-image-edit-plus` | fal's own page for that id describes it as Qwen-Image-Edit-2509, not 2511. |

Replicate and `hf-inference` were not in that mapping. A `QWEN_HF_URL` whose host is not `router.huggingface.co` is treated as a dedicated Inference Endpoint and is called with `{ inputs, parameters: { prompt } }`. Prices and GPU notes for the cutover decision are in the pull request; they change, so confirm them on the provider's page before switching.

Published prices read on 17 Nov 2026:

- fal prices [Qwen Image Edit 2511](https://fal.ai/models/fal-ai/qwen-image-edit-2511/llms.txt) and [Qwen Image Edit Plus](https://fal.ai/models/fal-ai/qwen-image-edit-plus/llms.txt) at **$0.03 per megapixel**. fal Serverless lists an H100 at **$4.50 per hour** (as low as $2.49 per hour) for deploying your own weights.
- [WaveSpeed's 2511 page](https://wavespeed.ai/models/wavespeed-ai/qwen-image/edit-2511) shows **$0.02 per run** next to the form and **$0.03 per edited image** under Pricing. Confirm the live price in their playground before relying on either number.
- [Hugging Face Inference Endpoints](https://huggingface.co/docs/inference-endpoints/support/pricing) bills per minute while an endpoint is running. Examples from that table: AWS L4 24 GB **$0.80/hour**, L40S 48 GB **$1.80/hour**, A10G 24 GB **$1.00/hour**, A100 80 GB **$2.50/hour**, H200 141 GB **$5/hour**. The Qwen model card does not publish a VRAM figure. It is a 20B BF16 checkpoint (the weights alone are about 40 GB before activations), so a 24 GB instance is unlikely to hold the unquantized diffusers quick start.
- [Hugging Face Inference Providers pricing](https://huggingface.co/docs/inference-providers/pricing): Hugging Face charges the provider's rate with no markup. Free accounts have no included credits. PRO is described there as **$2 of monthly credits**. Routed calls need a token with Inference Providers permission.

The health check reports `provider` and `image`. It is not ok when the selected provider's key or URL is missing, or when OpenAI returns `credit_balance_exhausted` / a spend-limit code, or when Hugging Face returns HTTP 402. `GET /v1/models` is not used, because that stays successful after credits run out. `/health` returns HTTP 503 once that check has failed, which will restart the app if the host treats `/health` as a liveness probe.

## Project layout

```
src/server.js       routes: checkout, webhook, gallery, SEO pages, admin
src/pipeline.js     paid order → generate → email → print
src/generate.js     portrait generation (OpenAI by default, Qwen when IMAGE_PROVIDER=qwen)
src/stripe.js       Stripe Checkout + webhook signature verification (no SDK)
src/stripe-setup.js automatic webhook + promo code setup on boot
src/printful.js     print-on-demand fulfillment
src/followups.js    abandoned-checkout recovery, review + referral emails
src/seo.js          38 breed pages + 7 gift-occasion pages, schema.org, sitemap, robots
src/config.js       styles (prompts), products, prices, all settings
scripts/content-engine.js   generates social calendar, Pinterest pins, Meta ad copy (CSV)
marketing/          generated CSVs (re-run with your real BASE_URL)
docs/MARKETING.md   customer acquisition playbook
```
