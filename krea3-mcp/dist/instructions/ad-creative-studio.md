# Ad creative studio

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
