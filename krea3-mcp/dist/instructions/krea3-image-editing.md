# Krea 3 image editing

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
