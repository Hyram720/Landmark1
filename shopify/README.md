# suncustomdesigns.com → Shopify migration kit

This folder rebuilds **suncustomdesigns.com** as a Shopify store. It holds the same 24 products, prices, copy, and photos, the same 7 product series, and the same dark luxury-bootleg look, plus the upload-your-own-art Design Studio rebuilt as a Shopify page. Printful and Printify are reconnected through their official Shopify apps.

| File | What it is |
|---|---|
| `catalog.json` | The full catalog taken from the live site: 24 products, 7 series, 12 Studio Library designs. This is the single source of truth. Edit it, then rebuild the CSV. |
| `products.csv` | Ready to import in **Shopify admin → Products → Import**. Each product gets size variants S–3XL (caps: One Size). Inventory tracking is off and orders are allowed at zero stock, the right settings for print-on-demand. |
| `sun-atelier-theme.zip` | A custom Online Store 2.0 theme in your brand: Fraunces / Plus Jakarta Sans fonts, `#0D0F12` background, `#EA580C` orange, `#F59E0B` gold. |
| `theme/` | The theme's source. Rebuild the zip with `npm run shopify:zip`. |
| `site-assets/` | Created by `npm run shopify:assets`: local copies of every photo, artwork file, and brand file from the current site. |

Rebuild commands (from the repo root):

```bash
npm run shopify:csv
```

```bash
npm run shopify:assets
```

```bash
npm run shopify:zip
```

---

## The one rule: keep the current site online until step 3 is done

Shopify copies product photos from the image URLs in `products.csv`, and those URLs point at `suncustomdesigns.com/assets/...`. If you point the domain at Shopify first, the photos and Studio artwork disappear. **Do the domain switch (step 9) last.**

---

## Step 1: Create the Shopify store

1. Sign up at shopify.com. Using `sunmarketingllc@gmail.com` keeps the owner account the same as Printful and Printify.
2. Pick a plan. **Basic** is enough to start.
3. In **Settings → General**, set the store name to `Sun Custom Designs`, the currency to USD, and the time zone to Eastern.

## Step 2: Decide which products Printful fulfills and which Printify fulfills

This matters because the two apps link products differently:

| | Printful | Printify |
|---|---|---|
| Can it link to a product that **already exists** in Shopify (imported from the CSV)? | **Yes.** It shows up as "unsynced" in Printful, and you match each variant to a Printful product and design. | **No.** Printify must **publish** the product to Shopify itself. |
| What to do | Import it from `products.csv`, then sync it in Printful. | Leave it **out** of the CSV import and publish it from Printify. |

Write down the handles of any Printify products, then rebuild the CSV without them:

```bash
node scripts/build-shopify-csv.js --skip pink-slips-only-street-circuit-legends-drift-tee,horizon-cut-sew-pullover-hoodie
```

(Those two handles are only examples. Every handle is listed in `catalog.json`.)

## Step 3: Import products and save the site's files

1. Run `npm run shopify:assets` to back up every image and artwork file to `shopify/site-assets/`. You need these files for the Studio Library and for any re-uploads.
2. Go to **Shopify admin → Products → Import**, upload `products.csv`, and leave "Overwrite products with matching handles" ticked if you re-import.
3. Spot-check 3 products: photos, sizes, price, description.

Every product is tagged with its series (`series-supercar-bout` and so on), its weight (`260 GSM`), and its colour (`color-Bone Cream`). The collections in step 5 are built from these tags.

## Step 4: Reconnect Printful and Printify

### Printful
1. In Printful, go to **Stores → Add store → Shopify** and install the Printful app on the new store.
2. Open **Stores → [your Shopify store] → Products**. The CSV-imported products show up as **unsynced**.
3. For each product, click **Sync** and choose the matching Printful product (blank, colour, sizes). Then attach the print file from your Printful **File library**, or from `shopify/site-assets/`.
   - If the current site's products live in a Printful **API / manual-order store**, save each one as a **product template** first. Templates can be reused in any of your Printful stores, so you don't have to rebuild designs.
4. Once a product is synced, Printful takes over its fulfillment. Paid orders go to Printful automatically, and tracking numbers flow back to Shopify.

### Printify
1. In Printify, go to **My Stores → Add new store → Shopify** and connect it.
2. Create or copy each Printify product into the new store, then click **Publish**. Printify creates the product in Shopify.
   - Printify products belong to one store. If your account can't copy them from the old store, rebuild each one from the design saved in **My library**.
   - When publishing, you can paste the title and description from `catalog.json` so the copy matches the rest of the store.
3. After publishing, add the right series tag (for example `series-winter-hoodies`) to the product in Shopify so it lands in the right collection.

### Shipping rates
Printful's live shipping rates at checkout need Shopify's third-party calculated shipping, which comes with the Advanced plan or as a paid add-on. Otherwise, set flat rates in **Settings → Shipping and delivery** that cover the print-on-demand shipping cost (for example $5.99 for a tee and $9.99 for a hoodie, free over $100).

## Step 5: Create the 7 collections

Go to **Products → Collections → Create collection**, choose **Automated**, and set the condition **Product tag is equal to** the tag below. **Copy the handle exactly**: the homepage tabs look collections up by handle.

| Title | Handle (edit under "Search engine listing") | Tag condition |
|---|---|---|
| Mesoamerican & Architectural Series | `mesoamerican-architectural-series` | `series-mesoamerican-architectural` |
| 260 GSM Supercar & Bout Tees | `supercar-bout-tees` | `series-supercar-bout` |
| 450 GSM Winter Bootleg Hoodies | `winter-bootleg-hoodies` | `series-winter-hoodies` |
| Street Graphic Tees | `street-graphic-tees` | `series-street-graphic` |
| Signature Tracksuit & Cap Set | `signature-tracksuit-cap-set` | `series-tracksuit` |
| All-Over Prints | `all-over-prints` | `series-all-over-print` |
| Collaborations | `collaborations` | `series-collaboration` |

Collection descriptions are in `catalog.json` → `collections`.

## Step 6: Install the theme

1. Go to **Online Store → Themes → Add theme → Upload zip file** and choose `sun-atelier-theme.zip`.
2. Click **Customize**:
   - **Theme settings → Brand**: upload the logo (`site-assets/brand/scd-header-horizontal-dark.svg`, or a PNG version) and the favicon.
   - The homepage is pre-filled with your hero, the "The Goods" tabs (one per collection), a Studio teaser, the 5-look lookbook, and the "From the mill to the press" columns. Every section is editable.
3. **Navigation**: create the `main-menu` menu (Shop all, Mesoamerican & Architectural, Supercar & Bout Tees, Winter Hoodies, Tracksuit Set, Design Studio, Contact) and the `footer` menu (Contact, Shipping Policy, Refund Policy, Privacy Policy, Terms of Service).
4. Click **Publish** when it looks right.

## Step 7: Set up the Design Studio (upload-your-own-art)

The CSV creates a product called **Custom Studio Design** (`/products/custom-studio-design`), with Style × Color × Size options (100 variants).

1. Open the product in admin. Under **Theme template**, choose **`studio`**.
2. In **Customize**, open that product page. Each **Studio Library design** block has a name already. Click each one and upload the matching transparent PNG from `site-assets/studio-library/`.
3. **Check the prices.** The Studio garment prices in `catalog.json` → `customStudio.styles` are placeholders ($38 tee, $68 hoodie, $30 Bella+Canvas, $42 all-over print, $28 tote). The current site doesn't show them, so set them against your Printful or Printify costs.

How Studio orders work:
- The customer uploads a PNG, JPG, WebP, or SVG, or picks a Library design. They can remove a plain background in one click, scale and rotate the art, toggle the art-only view, and see a live DPI check (300+ DPI is "sharp").
- The file is attached to the order. In **Orders → [order]** you see an **Artwork** link, plus the placement, the Library design name, and whether the background was removed.
- **These orders are fulfilled by hand**, because Printful and Printify can't read a customer's upload automatically. Download the artwork and create the order in Printful (**Orders → New order**) or Printify (**Orders → Create order**). If you'd rather automate it, swap this page for a personalization app that connects to your provider (Printful's Product Personalization, Teeinblue, or Customily).

The tracksuit set is tagged `Customizable`, so its product page shows a **Side-stripe text** field. That text appears on the order the same way.

## Step 8: Pages, policies, and checkout

- **Pages → Add page**: *Contact* (template `page.contact`, which has a working contact form), *Wholesale & Custom Runs*, and *About*.
- **Settings → Policies**: generate the Refund, Privacy, Terms, and Shipping policies. State that items are made to order: production takes 2–7 business days before shipping, and there are no returns on custom uploads except for misprints.
- **Settings → Payments**: turn on Shopify Payments, plus PayPal, Apple Pay, and Google Pay.
- **Settings → Taxes**: register for New Jersey sales tax collection if you haven't already.
- Place a **real test order** for one Printful product and one Printify product, and confirm that each reaches the right provider.

## Step 9: Move the domain (last)

1. Confirm that `shopify/site-assets/` holds every file (`npm run shopify:assets` prints the count and lists any failures).
2. Go to **Settings → Domains → Connect existing domain** and enter `suncustomdesigns.com`.
3. At your domain registrar, follow Shopify's instructions: an **A record** `@ → 23.227.38.65` and a **CNAME** `www → shops.myshopify.com`. Shopify verifies the records and issues SSL automatically.
4. Make `suncustomdesigns.com` the **primary domain**.
5. Resubmit the sitemap (`https://suncustomdesigns.com/sitemap.xml`) in Google Search Console.

The old site was a single page with `#catalog` / `#custom-studio` anchors, so there are no old product URLs to redirect.

---

## Check the copy before launch

The theme's default copy says "made to order" and makes no location or local-production claim. Keep it that way: do not add any claim about where or by whom the products are printed.

The products are also marketed as **"bootleg"** art featuring luxury cars, championship belts, and so on, and as having "zero brand logos". Keep it that way. Trademarked logos, car badges, or real fighters' names and likenesses can get products taken down by Shopify, Printful, or Printify.
