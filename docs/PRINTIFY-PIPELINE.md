# Printify product pipeline (site portrait → unpublished Printify product)

**Status: off by default.** Nothing happens until `PRINTIFY_PIPELINE_ENABLED=true` and both
`PRINTIFY_API_TOKEN` and `PRINTIFY_SHOP_ID` are set. The code never calls Printify's publish
endpoint (the client refuses `publish.json` and `send_to_production.json`), so nothing reaches Etsy
or is printed.

## How it works

```
paid site order ─► AI paints portraits ─► gallery email (unchanged)
                                   │
                                   └─► (flag on) square 2400×2400 ornament crop (face-aware)
                                         ─► POST /v1/uploads/images.json (base64; image never on a public URL)
                                         ─► GET  the template product (existing ornament draft) for blueprint,
                                              print provider, enabled variants + prices, photo position/scale
                                         ─► POST /v1/shops/{shop}/products.json  (new image, "<Pet> …" title,
                                              listing description, the 13 Etsy tags, visible=false)
                                         ─► order record: printify.status / products.{ceramic,metal}.productId + url
```

- Runs in the background after portraits are generated; a Printify failure never fails the order.
- Retries 429/5xx with backoff (honours `Retry-After`), records errors on the order, emails the
  owner once, and an admin **Printify** button on `/admin` re-runs it (idempotent: products already
  created for the same image are skipped). `POST /admin/printify/:id` with `image=<file>` uses another portrait.
- Products are created with `visible: false` ("Hide in store"). If a human later clicks **Publish**
  in Printify, Printify's Etsy integration sends it to Etsy as a **draft** listing, not an active one.
- `/admin/check` shows `printify: ok|failed|not configured` and `printifyPipeline: on|off` (no secrets).

## Why "unpublished in Printify" and not "Etsy draft"

- Printify's API publish endpoint only triggers the sales-channel integration
  (https://developers.printify.com/#publish-a-product); there is no "publish as draft" parameter,
  only the product's `visible` flag (documented as read-only but writable in practice).
  Publishing is rate-limited to 200 requests / 30 min.
- Creating an Etsy draft directly needs an Etsy Open API v3 app, OAuth 2.0 (PKCE) with `listings_w`,
  plus `shipping_profile_id`, `readiness_state_id` and `taxonomy_id`
  (https://developer.etsy.com/documentation/tutorials/listings). An Etsy listing made that way is
  not linked to Printify, so its orders would not auto-fulfil.

## Recommendation

A per-customer Etsy listing for every site order puts customers' private pet photos in the shop,
clutters search, costs $0.20 per listing when published, and the customer already paid on the site.
The usual pattern: Etsy keeps a few generic personalizable listings; a site order for a physical
item becomes a Printify **order** (`POST /v1/shops/{id}/orders.json` with `print_areas` from the
portrait). `buildOrder`/`createOrder` in `src/printify.js` are ready for that but are not wired to
checkout, because the site does not sell ornaments today (adding that is a pricing decision).

## Owner setup

1. Printify → My profile → Connections → generate a token with `shops.read`, `products.read`,
   `products.write`, `uploads.write` (add `orders.write` only if order creation is wired later).
2. Find the store id of **My Etsy Store** (the number in `printify.com/app/store/<id>/…`, or
   `GET https://api.printify.com/v1/shops.json`).
3. In Railway (service `web`) add `PRINTIFY_API_TOKEN`, `PRINTIFY_SHOP_ID`, optionally
   `PRINTIFY_TEMPLATES=ceramic,metal`, and finally `PRINTIFY_PIPELINE_ENABLED=true`.
4. Before enabling, check the two template drafts: their artwork is replaced automatically, but their
   enabled variants, prices and photo placement are copied as-is.
