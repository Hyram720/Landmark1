# Customer acquisition playbook

The plan runs five channels in parallel:
- two that can bring in money on **day one**: paid ads and Etsy
- two that **compound** for free: SEO and Pinterest
- one that **multiplies** the rest: referrals and reviews

Most of the work is done by code or by the CSV files in `marketing/`.

---

## 1. Meta ads (Facebook + Instagram): the day-one engine

You already run Meta ads, so this is familiar ground.

**Setup (once)**
1. Create a new ad account or Business Portfolio for this brand, separate from insurance.
2. Paste the Meta Pixel into the `<head>` of `public/index.html` and `public/order.html`. The pages already fire `InitiateCheckout` and `Purchase` events when `fbq` exists.
3. Make about 6 demo portraits: your own pets, or friends' pets with their permission. These become the ad creatives.

**Campaign structure**
- **Campaign:** Sales, Advantage+ Shopping (or Advantage+ audience), optimizing for Purchase
- **Budget:** $25/day to start
- **Creatives:** 4–6 ads
  - 2 videos that reveal a photo turning into a portrait (use the hooks in `marketing/social-calendar.csv`)
  - 2 carousels showing the before photo and 3 styles
  - 1 static image of the canvas hanging on a wall
- **Copy:** `marketing/meta-ads.csv` (5 variants with UTM-tagged links)
- **Memorial campaign:** separate, $10/day, gentle creative only, sends people to `/gifts/pet-memorial`

**Kill / scale rules** (check every 3 days, not every hour)

| Result after $75 spent per ad | Action |
|---|---|
| Cost per purchase under $15 | Raise the budget 20% every 3 days |
| $15–25 | Keep it running and test new hooks |
| Over $25, or 0 purchases | Turn the ad off and replace it with a new hook |

A digital order makes about $27 in gross profit, so anything under about $20 per purchase is profitable on the first sale. Canvas upgrades and referrals add on top of that.

**Q4 timing:** Spend from Nov 1 to Dec 20 is where most of the money is. Switch the copy to "delivered in minutes, never too late" after Dec 10, when canvas shipping can no longer make it by Christmas.

## 2. Etsy: built-in buyers on day one

Etsy shoppers already search for "custom pet portrait" every day.
- List the **digital portrait** at $24.99 and the **canvas** at $89.
- In each listing, ask buyers to message their photo and pick a style.
- Fulfill through your own site: create the order from `/` using your Etsy buyer's photo and send them the gallery link. That takes about 2 minutes per order. (Etsy can be automated later with Zapier.)
- Use the titles and tags from `marketing/pinterest-pins.csv`, which already pair each breed with each style.
- Budget $1–3/day for Etsy Ads on your 3 best listings.

## 3. Programmatic SEO: free traffic that compounds

The site already serves **46 indexable pages**:
- `/portraits/<breed>`: 38 breeds, each with unique copy, a suggested style, Product + FAQ schema, and a canonical URL
- `/gifts/<occasion>`: Christmas, memorial, Mother's Day, Father's Day, birthday, dog lovers, cat lovers
- `/sitemap.xml` and `/robots.txt`. Private galleries, admin and the API are kept out of search engines.

**Your part**
1. Submit the sitemap in Google Search Console and Bing Webmaster Tools on launch day.
2. Once customer results exist, add a real portrait image to each breed page. Pages with images rank and convert better.
3. To add more breeds, edit `BREED_DATA` in `src/seo.js`. The sitemap updates itself.
4. Expect ranking movement in 6–12 weeks. This is the channel that lowers your ad cost over time.

## 4. Short-form video + Pinterest: free reach

- `npm run content` writes `marketing/social-calendar.csv`: 30 days of posts with an on-screen hook, a shot list, a caption, hashtags and a UTM link. Seasonal angles switch in automatically for Christmas, Mother's Day and Father's Day.
  - Post once a day to TikTok, Reels, Shorts and Facebook Reels from one recording.
  - Schedule a week at a time in Meta Business Suite or Buffer.
- `marketing/pinterest-pins.csv` holds 228 pins (38 breeds × 6 styles), each linking to its breed page. Pinterest is search-driven and gift-heavy, a perfect match.
  - Bulk-upload 5–10 pins a day.
- Optional: use the connected Higgsfield, Canva or Adobe tools to batch-produce the reveal videos and pin images from the shot lists.

## 5. Referrals + reviews: automated word of mouth

These run on their own once the env vars are set:
- **Abandoned checkout:** 1 hour after someone uploads a photo but doesn't pay, they get a "finish your portrait" email with `COMEBACK15`. This typically recovers 5–15% of abandoned checkouts.
- **Review + referral:** 3 days after delivery, the customer gets an email asking for a review (`REVIEW_URL`) and a social tag, and is given `FRIEND20` for a friend.
- The gallery page also shows the `FRIEND20` code.
- Every email has an unsubscribe link (CAN-SPAM).

## 6. Free launch push (week 1)

- Post your own pet's portrait on your personal Facebook with a "launch special" code.
- Breed-specific Facebook groups: share *your* pet's portrait as a fun post, not spam. Follow each group's rules about promotion.
- Offer 5 free portraits to local pet groomers, vets or rescues in exchange for displaying the canvas with a QR code to your site.

## Weekly 30-minute review

1. Open `/admin`. Check revenue, failed orders, and the **Source** column, which shows which ad or page each order came from.
2. In Meta Ads Manager, apply the kill/scale rules above.
3. Run `npm run content` and schedule next week's posts and pins.
4. Reply to any repaint requests.
