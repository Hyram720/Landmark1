# Sun Custom Designs: re-engineered storefront

Our own re-implementation of the suncustomdesigns.com storefront. It borrows Shopify's **structure** (products with variants, tag-based collections, a theme, and a Design Studio product template) but is built and run entirely from this repo. **It does not use Shopify's hosted platform or APIs, and nothing here creates a Shopify store or imports into a Shopify account.**

## Build and preview

From the repo root:

```bash
npm run storefront:build
```

```bash
npm run storefront:serve
```

The site is then at http://localhost:4321. The build writes static pages to `shopify/storefront/dist/` (not committed).

| What | Pages |
|---|---|
| Home | Hero, "The Goods" catalog with one tab per collection, Design Studio teaser, lookbook |
| Collections | `/collections/` plus one page per series. Membership comes from the product's `series-*` tag. |
| Products | `/products/<handle>/`: gallery, size/option picker, personalization field on products tagged `Customizable`, add to bag |
| Design Studio | `/products/custom-studio-design/`: upload art or pick a Studio Library design, one-click background removal, scale and rotate, DPI check, live garment preview |
| Bag | `/cart/`: stored in the browser (uploaded artwork in IndexedDB). **Checkout is not connected.** |

## Data sources

| File | Role |
|---|---|
| `products.csv` | **The product data source.** Product rows, variants, prices, images, tags and SEO fields. It keeps Shopify's CSV column layout only as a familiar format. Rebuild it from `catalog.json` with `npm run shopify:csv`. |
| `catalog.json` | Catalog taken from the live site, used to generate the CSV. Also supplies the collection titles and descriptions and the Studio Library artwork. |
| `storefront/providers.json` | Which print-on-demand provider makes each product. **Every handle listed under `printify` is left out of the build.** Printful and unlisted products are included. |
| `storefront/config.json` | Page copy: hero, catalog intro, lookbook picks, footer. |
| `site-assets/` | Created by `npm run shopify:assets`: local copies of the site's photos. The build uses them when present and otherwise loads images from their original URLs. |

**Printify-only products:** `providers.json` is empty right now, because nothing in the repo or on the live site records which provider makes which product. Until Fred fills it in, no products are left out.

**Studio prices are placeholders** ($38 tee, $68 hoodie, $30 Bella+Canvas, $42 all-over print, $28 tote) until Fred sets them in `catalog.json` → `customStudio.styles`. Then rebuild the CSV and the storefront.

## Code

| Path | What it is |
|---|---|
| `scripts/build-storefront.js` | Static-site generator: parses the CSV, applies the provider exclusion, and renders every page |
| `scripts/serve-storefront.js` | Local preview server |
| `storefront/assets/cart.js`, `storefront.css` | Bag logic and storefront-only styles |
| `theme/assets/theme.css`, `theme.js`, `studio.js` | Shared look, variant picker, and Design Studio logic, reused by the build |
| `theme/`, `sun-atelier-theme.zip` | The earlier Liquid version of the theme, kept for reference only. It runs only on Shopify's platform and is not used by this build. |

## Copy rules

- The copy makes no location claim and no claim about where or by whom products are printed. Keep it that way. The only production statement is "Made to order. Printed after you check out."
- The products are marketed as "bootleg" art with "zero brand logos". Keep it that way: trademarked logos, car badges, or real fighters' names and likenesses can get products pulled by the print-on-demand providers.
