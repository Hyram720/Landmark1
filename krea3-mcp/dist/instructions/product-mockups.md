# Product mockups and listing photos

Tools: `product_mockup`, `krea3_edit`, `krea3_batch`, `ad_format_pack`, `estimate_cost`.

## Design onto a product

Call `product_mockup` with the artwork as the **first** image:

```
product: "tshirt" | "hoodie" | "throw_blanket" | "canvas_wall" | "mug" | "phone_case" | "tote_bag" | "poster_frame"
colors: ["washed sage", "heather gray", "black"]   # one image per color, in parallel
scene: "worn by a smiling woman at a pumpkin patch, golden hour"   # optional
aspect_ratio: "4:5"   # Etsy/Instagram friendly; "1:1" for Amazon/Shopify grids
```

Use transparent PNG artwork when possible. Krea 3 is told not to redraw the art; still check that the design, spelling and colors match the original.

## Real product photos

For a phone snapshot of a physical product, use `krea3_edit`:

- Packshot: "Place the product on a seamless white studio background with a soft shadow, studio lighting. Keep the product and its label exactly as they are."
- Lifestyle: "Put the candle from the first image on a rustic wooden table beside a window at dusk, warm light. Keep the candle and label exactly as they are."
- Colorways: "Change only the hoodie color to #2F5D46. Keep everything else the same." with `regional_edit: true`. Use `krea3_batch` to make many hex colors at once.
- Detail fix: draw a `regions` box over a smudge or wrinkle with the note "clean up the fabric".

## A full listing set (Etsy needs up to 10 photos)

1. Hero mockup (`product_mockup`, best color, 4:5 or 4:3).
2. Every colorway (`colors` list).
3. Lifestyle scene (custom `scene`).
4. Close-up of print detail ("tight crop on the chest print, fabric texture visible").
5. Size or scale shot (product held or worn).
6. Re-framed versions for pins and ads (`ad_format_pack` with `pinterest_pin`, `etsy_listing`, `instagram_feed`).

Run `estimate_cost` first: a 10-photo set at 2K with one reference is about $0.80 on Krea.

## Honesty rules

- Mockups must look like the product the customer receives: same print placement, realistic colors, no impossible materials.
- Do not add brand logos, licensed characters or trademarks the user does not own.
- Label AI lifestyle photos as illustrations when a marketplace requires it.
