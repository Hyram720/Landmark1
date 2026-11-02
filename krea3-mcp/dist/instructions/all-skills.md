# Krea 3 Studio skills

These instructions go with the "krea3-studio" MCP connector (tools such as krea3_edit, pet_portrait, product_mockup, ad_format_pack, compare_providers, animate_image). Follow the section that matches the request.

<!-- skill: ad-creative-studio -->
> When to use: Produce ad and social creatives from one product or hero image: placements for Instagram, Stories/Reels/TikTok, Facebook, Pinterest, Etsy, banners and YouTube thumbnails, A/B variants, seasonal re-skins, localized posters, and short animated clips. Use for ad sets, campaign variants, social posts, thumbnails and "make this into an ad".

## Ad creative studio

Tools: `ad_format_pack`, `krea3_batch`, `krea3_edit`, `animate_image`, `compare_providers`, `estimate_cost`.

## Every placement from one image

`ad_format_pack` re-frames one hero image for several placements in parallel and keeps the subject and any text intact:

| Format | Ratio |
|---|---|
| `instagram_feed` | 4:5 |
| `instagram_story` (Stories, Reels, TikTok) | 9:16 |
| `facebook_feed` | 1:1 |
| `pinterest_pin` | 2:3 |
| `etsy_listing` | 4:3 |
| `web_banner` | 21:9 |
| `youtube_thumbnail` | 16:9 |

Add `direction` to apply one change to every format ("add soft falling snow").

## A/B test variants

Write 3-6 distinct angles, not near-duplicates, and run them in one `krea3_batch` call on the same product image:

- Setting: kitchen morning vs. cozy sofa night vs. outdoor park.
- Season: everyday vs. Christmas vs. Mother's Day vs. memorial.
- Person: product alone vs. in someone's hands vs. reaction shot.
- Color: brand color by hex (`#FFC12E`) on the backdrop.

End every prompt with "Keep the product exactly as it is." Explore at 1K, then re-run winners at 2K.

## Text in ads

Krea 3 can re-letter signs and posters ("Change the headline to \"50% OFF THIS WEEK\" in the same font and color, keep the layout."). Always proofread the result. For prices, legal lines and small print, add text in a design tool instead.

## Short video ads

Turn the best still into a 5-10 second clip with `animate_image` (Higgsfield by default):

- Prompt motion and camera, not the scene: "slow dolly-in, steam rises from the mug, soft light flicker".
- Use 9:16 stills for TikTok/Reels. Video is billed per second; keep it short.

## Picking the best model

When a look matters (a new style or a new campaign), run `compare_providers` once with the same brief on Krea 3, Higgsfield and Kie, show the results side by side, and use the winner for the rest of the batch.

## Rules

- No fake reviews, fake "as seen on" badges, before/after claims you cannot back up, or real people's likeness without permission.
- Do not imitate a competitor's brand or trade dress.

---

<!-- skill: krea3-image-editing -->
> When to use: Edit or generate images with Krea 3 through the krea3-studio MCP tools. Use whenever the user wants to change part of a photo, swap or recolor an object, put a product in a new scene, combine several reference images, remove something, relight, re-frame, or match an exact hex color. Covers prompt structure, thinking modes, regional edits, bounding boxes and cost control.

## Krea 3 image editing

Krea 3 is an instruction-following image **editor** (it can also generate from text). Most edits finish in under 8 seconds at native 2K. It keeps what you did not ask to change: products, labels, faces and characters.

Tools (from the `krea3-studio` MCP server): `krea3_edit`, `krea3_batch`, `get_job`, `upload_image`, `estimate_cost`, `list_providers`.

## Write the prompt like this

1. **Lead with the change.** "Change the mug to red", "Put the sneaker from the second image on the person in the first image".
2. **Add only details that help:** the scene, the light, the camera, the material, an exact color (`#FFC12E`).
3. **With several images, name each one by what it shows:** "the dog in the first image", "the sofa from the third image".
4. **End with one preservation sentence:** "Keep everything else the same." Do not list everything that stays.
5. Use **"only"** for single changes: "Remove only the woman in the red coat."

Good: `Replace the background with a sunlit kitchen, soft window light from the left. Keep the product and its label exactly as they are.`
Weak: `make it nicer, keep the bottle, keep the label, keep the cap, keep the color, keep...`

## Pick the mode

| Need | Setting |
|---|---|
| Normal edit | `thinking_mode: "fast"` (default) |
| 3+ references, multi-step change, or `fast` missed the brief | `"high"` (+$0.02) |
| Final hero image, user explicitly wants best quality | `"ultra"` (Max plan only, minutes, +$0.20, always 2K, needs an input image, no negative_prompt) |
| Small local fix that must not touch anything else | `regional_edit: true` |
| Point at an exact area | `regions: [{image_idx, x, y, width, height, note}]` (0-1 fractions, top-left origin, up to 24, refer to them as `@label`) |
| Preview / cheap exploration | `resolution: "1K"` ($0.03) |
| Print / final | `resolution: "2K"` ($0.06) or `"4K"` (+$0.04) |

Aspect ratios: `1:1 4:5 3:4 2:3 9:16 5:4 4:3 3:2 16:9 21:9`. Omit to keep the input framing.

## Images

- Up to 8 images per edit. Pass `image_urls` (public URLs, data URIs), `image_base64` (attachments), or `image_paths` (local files, desktop only).
- About 1 megapixel per reference is enough. Send full resolution only when tiny text, logos or faces in a wide shot matter.
- With 5+ references each is shrunk to 1536px; send 4 or fewer for full detail.
- Reusing the same image across many edits? Call `upload_image` once and reuse the URL.

## Cost rules (Krea list prices)

Base $0.03 (1K) / $0.06 (2K). Each reference: +$0.02 (~1MP) or +$0.07 (2K+). `high` +$0.02. `ultra` +$0.20 with the first 4 references at $0.07.

- Before any batch of more than ~10 images, call `estimate_cost` and tell the user the total.
- Explore at 1K, deliver at 2K.
- Never loop retries silently; if a result misses, change the prompt or mode, then try once more.

## Iterating

- Feed a result URL back in as the first image for the next edit. With `regional_edit` you can stack edits with no quality loss.
- For several ideas at once, use `krea3_batch` (up to 8 prompts, same references, in parallel).
- If a call returns `status` other than `completed`, call `get_job` with the `job_id` instead of resubmitting (resubmitting bills again).

## Limits

- Seeds are not fully repeatable (Krea expands the prompt each run).
- LoRAs and style references are not in the API yet.
- Do not edit real people into misleading or sexual situations, add real brand logos you do not own, or remove watermarks from images the user does not own.

---

<!-- skill: multi-provider-blending -->
> When to use: Choose between and chain Krea 3, Higgsfield and Kie.ai through the krea3-studio MCP server: compare models side by side, route each job to the best or cheapest provider, and build pipelines such as Krea still to Higgsfield video. Use when the user asks which model is best, wants to compare, wants video from an image, mentions Higgsfield, Kie, Nano Banana, Kling, Seedance, Soul or Qwen, or wants to cut cost.

## Blending Krea 3, Higgsfield and Kie.ai

Tools: `list_providers`, `generate_image`, `compare_providers`, `animate_image`, `get_job`, `upload_image`.

Always start with `list_providers` to see which keys are set. Never pick a provider that is not configured.

## Who does what

| Job | First choice | Why |
|---|---|---|
| Precise edits, product kept intact, recolors, removals, multi-reference composites | **Krea 3** (`krea3_edit`, or `generate_image` with provider `krea`) | Fastest (<8s), cheapest ($0.03-0.06), changes only what you ask |
| Photoreal people / fashion editorial from text | **Higgsfield** Soul (`higgsfield-ai/soul/v2/standard`) | Strong photographic look |
| Alternative editor for a second opinion | Higgsfield Qwen Image 3 edit (`alibaba/qwen-image-3/edit`), Kie `nano-banana-pro` | Different model families fail differently |
| Long prompts, dense text, infographics | Kie `nano-banana-pro` | Good text rendering |
| Image to video | **Higgsfield** (`kling-video/o3/image-reference` default) or a Kie video model | Krea 3 does not make video |

Higgsfield and Kie host many more models. Any documented endpoint path (Higgsfield) or market model id (Kie) works through the `model` field, with model-specific fields in `extra`.

## Compare once, then commit

`compare_providers` runs the same prompt and images on every configured provider in parallel. Use it once per new style or campaign, rank the results (likeness, detail, prompt-following, artifacts), tell the user which won and why, then run the rest of the batch on the winner only. Comparing every image triples the cost.

## Pipelines

- **Still to video:** make the still with Krea 3 → pass its URL to `animate_image` with a motion prompt.
- **Generate then fix:** create with Higgsfield Soul or Kie → fix details with `krea3_edit` + `regional_edit: true`.
- **One upload, many models:** `upload_image` once (hosted on Krea or Higgsfield) and reuse the URL everywhere. Kie has no upload API here, so local files and attachments for Kie are hosted through Krea or Higgsfield automatically.

## Field differences the tools handle for you

- Krea: `image_urls`, `resolution` 1K/2K/4K, `thinking_mode`, `regional_edit`, `regions`.
- Higgsfield: `image_urls` (edits) or `image_url` (single-image video models: set `image_field: "image_url"`), resolution like `1k` or `720p`/`1080p`.
- Kie: `{model, input}`; Nano Banana Pro uses `image_input`, `aspect_ratio`, `resolution`.

If a provider returns a validation error, read the message, fix the field in `extra`, and retry once.

## Jobs and billing

- Long jobs (video, Krea `ultra`) may return `status: pending` with a `job_id`. Call `get_job` with the same `provider`; do not resubmit.
- Each provider bills separately: Krea per image, Higgsfield and Kie in credits per model (video per second). `estimate_cost` covers Krea only; tell the user to check Higgsfield and Kie prices in their dashboards for big batches.

---

<!-- skill: pet-portrait-studio -->
> When to use: Turn customers' pet photos into custom portraits (royal, admiral, astronaut, watercolor, holiday, memorial and more) with the krea3-studio pet_portrait tool, check likeness, fix details, and prepare print-ready files and product mockups. Use for any pet portrait, pet gift, pet memorial art, or "make my dog/cat a ..." request.

## Pet portrait studio

Tools: `pet_portrait` (main), `krea3_edit` (fixes), `product_mockup`, `animate_image`, `compare_providers`, `list_providers`.

## 1. Get good photos

Ask for 1-4 photos if none are attached. Best inputs:
- Face clearly visible, eyes in focus, natural light, no heavy filters.
- One straight-on photo plus one 3/4 angle beats one perfect photo. More than 4 adds cost without helping.
- Show the distinctive markings (white chest, spotted ear, odd-colored eyes).
- For two pets or pet + owner: photos of the main pet first, the companion **last**, and describe it in `companion` ("the second dog, a black lab").

If the only photo is blurry, dark or the face is hidden, say so and ask for a better one before spending credits.

## 2. Paint

Call `pet_portrait` with `style` and `variants: 2` (default thinking_mode `high` reads multiple photos together). Styles:

`royal`, `admiral`, `duchess`, `general`, `astronaut`, `watercolor`, `holiday`, `halloween`, `pop_art`, `retro_arcade` (16-bit pixel art), `anime`, `memorial` (rainbow bridge), `line_art` (great for t-shirts).

- Default framing `2:3` matches 12x18 and 16x24 canvas prints with no cropping. Use `4:5` for 8x10 / 16x20, `1:1` for square canvases and pillows.
- Add art direction with `extra_direction` ("emerald velvet instead of red", "add a tiny golden bone medal").
- Rough cost on Krea at 2K with `high`: about $0.10-0.12 per variant with one or two photos.

## 3. Check likeness before showing "final"

Compare each result with the photos:
- Same breed and build, same fur colors and **markings in the same places**, same eye color, same ear shape.
- No extra legs, merged paws, human hands, or text/letters in the image.

Fix small misses with `krea3_edit` + `regional_edit: true` on the result URL, for example: "Make the white patch on the chest larger and match the photo. Keep everything else the same." Use a `regions` box around the area for precision. Repaint from scratch only if the face is wrong.

## 4. Names and text

The style prompts forbid text on purpose: models misspell names. Add names afterwards with a nameplate in code or a design tool. Only if the user insists, use `krea3_edit` with an exact quoted name ("a brass plaque that reads \"MAX\"") and check the spelling.

## 5. Deliver

- Print: use the 2K (or 4K) file. 2K at 2:3 is about 1536x2304 px, fine for 12x18; upscale for 16x24 and larger.
- Mockups: `product_mockup` with `canvas_wall`, `throw_blanket`, `mug`, `tshirt` etc. for listing photos or a preview the customer can share.
- Video: `animate_image` turns the portrait into a 5-second clip for TikTok/Reels ("slow push-in, the dog blinks and tilts its head, candlelight flickers").

## Memorial portraits

Be gentle and brief. Use `memorial` or a soft style the owner chooses, avoid jokes, do not add halos or wings unless asked, and offer to include a favorite toy or place from another photo.

---

<!-- skill: product-mockups -->
> When to use: Put a design or artwork onto realistic product photos (t-shirts, hoodies, throw blankets, canvas prints, mugs, phone cases, totes, framed posters) in several colorways, and turn product snapshots into studio packshots and lifestyle shots for Etsy, Shopify, Amazon or a website. Use for mockups, listing photos, colorway sets, and "show my design on a ...".

## Product mockups and listing photos

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

---
