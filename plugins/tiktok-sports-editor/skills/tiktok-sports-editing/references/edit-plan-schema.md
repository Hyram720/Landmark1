# Edit plan schema (`render_edit.py`)

Relative paths resolve against the plan file's directory. All times are seconds.

```json
{
  "input": "fight.mp4",
  "output": "ko_tiktok.mp4",

  "width": 1080, "height": 1920, "fps": 30,
  "reframe": "blur",
  "crop_center": 0.5,
  "grade": "gritty",

  "segments": [
    {"start": 41.2, "end": 44.0, "effects": [{"type": "zoom_ramp", "to": 1.3}]},
    {"start": 43.6, "end": 44.4, "speed": 0.3, "zoom": 1.5, "freeze": 0.7,
     "effects": ["flash", "shake", "boom", {"type": "bw", "at": 2.0}]},
    {"start": 44.4, "end": 47.0, "reframe": "crop", "crop_center": 0.35,
     "effects": [{"type": "whoosh", "at": 0}]}
  ],

  "hook": {"text": "HE NEVER SAW IT COMING", "style": "stamp", "duration": 2.2},

  "captions": [
    {"start": 2.9, "end": 4.2, "text": "1 2 3", "style": "impact", "words": true},
    {"start": 5.0, "end": 7.5, "text": "LIGHTS OUT", "style": "impact"},
    {"start": 0.5, "end": 2.5, "text": "ROUND 3 • 0:47", "style": "top"}
  ],

  "watermark": {"position": "top_left", "opacity": 0.85, "width": 200},

  "music": {"path": "beat.mp3", "volume": 0.25, "original_volume": 1.0, "start": 12.5},
  "cover_at": 5.5,
  "font": "DejaVu Sans",
  "loudness": -14
}
```

## Top-level fields

| Field | Default | Notes |
|---|---|---|
| `input` / `output` | required / `tiktok_edit.mp4` | Source and rendered MP4 |
| `width` / `height` / `fps` | 1080 / 1920 / 30 | Use `fps: 60` only if the source is ≥ 50fps |
| `reframe` | `blur` | `blur`: full-width video over a blurred fill. `crop`: fills the screen, cropped to the subject. `fit`: black bars. Can be overridden per segment |
| `crop_center` | 0.5 | Horizontal focus for `crop` (0 = left, 1 = right). Can be overridden per segment to follow the action |
| `grade` | `punchy` | `punchy`, `teal_orange`, `cinematic`, `gritty`, `cold`, `mono`, `none`. Can be overridden per segment |
| `hook` | none | `text`, `style` (`box` / `outline` / `stamp`), `duration` (default 2.5), `font_size` |
| `captions[]` | [] | See below. Times are on the **output** timeline |
| `watermark` | brand logo | Sun Custom Designs branding, applied automatically. See below |
| `music` | none | Only for audio the user owns or has licensed. `start` = where in the song to begin |
| `cover_at` | none | Also writes `<output>_cover.jpg` from this output time |
| `font` | DejaVu Sans | Any installed family (`fc-list : family`); Anton/Bebas Neue/Impact look most pro |
| `caption_font_size` | 78 | Base size. Styles scale from it |
| `loudness` | -14 | Integrated LUFS target |

## Segment fields

| Field | Default | Notes |
|---|---|---|
| `start` / `end` | required | Source times. The same moment can appear more than once (real speed, then replays) |
| `speed` | 1.0 | 0.2–0.5 = slow-mo replay, 1.5–2 = compress dead time. Audio is time-stretched |
| `zoom` | 1.0 | Static punch-in (≥ 1) |
| `freeze` | 0 | Hold the last frame this many seconds (source audio keeps rolling under it) |
| `mute` | false | Silence this segment's source audio |
| `effects[]` | [] | Strings or objects `{"type", "at", "duration", "strength", "to"}`; `at` is seconds from this segment's start |

## Effects

| Type | What it does | Defaults |
|---|---|---|
| `flash` | White flash that decays | `at` 0, `duration` 0.18 |
| `shake` | Decaying camera shake (impact) | `at` 0, `strength` 1 (higher = longer) |
| `zoom_ramp` | Smooth eased push-in | `at` 0, through the end of the segment, `to` 1.35 |
| `bw` | Black & white | `at` 0, through the end of the segment |
| `rgb_split` | Chromatic glitch | `at` 0, `duration` 0.25, `strength` 1 |
| `vignette` | Dark edges | `at` 0, through the end of the segment |
| `boom` | Sub-bass hit sound | `at` 0, `strength` 1 |
| `whoosh` | Air-swipe sound that peaks at `at` | `at` 0 |

## Captions

| Field | Notes |
|---|---|
| `start`, `end`, `text` | Output-timeline seconds |
| `style` | `cap` (default; white with outline, lower-middle), `pop` (yellow, center), `impact` (huge red, slanted, slams in), `stamp` (yellow label box), `top` (small info bar: score, clock, yardage). `emphasis: true` = `pop` |
| `words` | `true` = kinetic: each word slams in on its own, evenly across start→end |

## Watermark (Sun Custom Designs)
Every render is branded automatically:
1. If `plugins/tiktok-sports-editor/assets/watermark.png` exists, that logo is overlaid.
2. Otherwise the text **SUN CUSTOM DESIGNS** is used.

| Field | Default | Notes |
|---|---|---|
| `image` | bundled logo | Path to a PNG (transparent background works best) |
| `text` | `SUN CUSTOM DESIGNS` | Used when there's no image |
| `position` | `top_left` | `top_left`, `top_right`, `bottom_left`, `center_left`. All clear TikTok's buttons and caption |
| `opacity` | 0.85 | 0–1 |
| `width` | 200 | Logo width in px (of 1080) |
| `size` | 34 | Text watermark font size |

`"watermark": false` turns it off; `"watermark": "other_logo.png"` swaps the image.

## Output-timeline math
Segment output length = `(end - start) / speed + freeze`. A caption's time = the sum of earlier segments'
output lengths + its offset in the current segment.

## Checks
```bash
python3 scripts/render_edit.py plan.json --dry-run      # print ffmpeg commands only
ffmpeg -v error -y -ss 3.1 -i out.mp4 -frames:v 1 check.jpg
```
