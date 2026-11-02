# Pet portrait studio

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
