# Edit plan schema (`render_edit.py`)

Relative paths resolve against the plan file's directory. All times are seconds.

```json
{
  "input": "game.mp4",
  "output": "tiktok_edit.mp4",

  "width": 1080, "height": 1920, "fps": 30,
  "reframe": "blur",
  "crop_center": 0.5,

  "segments": [
    {"start": 41.2, "end": 47.0},
    {"start": 45.1, "end": 46.6, "speed": 0.4, "zoom": 1.5},
    {"start": 52.0, "end": 54.0, "mute": false}
  ],

  "hook": {"text": "WATCH THE KID ON THE LEFT", "duration": 2.2, "font_size": 92},

  "captions": [
    {"start": 2.4, "end": 4.0, "text": "one defender left"},
    {"start": 6.0, "end": 9.5, "text": "ARE YOU SERIOUS", "emphasis": true}
  ],
  "caption_font_size": 78,

  "music": {"path": "beat.mp3", "volume": 0.25, "original_volume": 1.0, "start": 0},

  "cover_at": 6.5,
  "font": "DejaVu Sans",
  "loudness": -14,
  "crf": 18
}
```

## Fields

| Field | Default | Notes |
|---|---|---|
| `input` | required | Source video |
| `output` | `tiktok_edit.mp4` | Rendered MP4 |
| `width` / `height` / `fps` | 1080 / 1920 / 30 | Use `fps: 60` only if the source is ≥ 50fps |
| `reframe` | `blur` | `blur`: full-width video over a blurred fill. `crop`: fills the screen by cropping to the subject. `fit`: black bars |
| `crop_center` | 0.5 | Horizontal focus for `crop`: 0 = far left, 1 = far right. Applies to the whole plan; split into separate renders if the focus must move a lot |
| `segments[]` | required | Played in order. The same source time can appear twice (real speed, then replay) |
| `segments[].speed` | 1.0 | 0.4–0.5 for slow-mo replays, 1.5–2 to compress dead time. Audio is time-stretched to match |
| `segments[].zoom` | 1.0 | Punch-in factor (≥ 1). Centered for `blur`, around `crop_center` for `crop` |
| `segments[].mute` | false | Replace this segment's audio with silence |
| `hook` | none | Top-of-frame text box shown from 0s for `duration` (default 2.5s) |
| `captions[]` | [] | Times are on the **output** timeline (after speed changes). `emphasis: true` = big yellow center pop |
| `music` | none | Only for audio the user owns or has licensed. Loops to fill the clip. Prefer adding trending sounds in the TikTok app |
| `cover_at` | none | Also writes `<output>_cover.jpg` from this output timestamp |
| `font` | DejaVu Sans | Any installed font family (`fc-list : family`). Bold sans fonts (Montserrat, Anton, Bebas Neue, Impact) look most native |
| `loudness` | -14 | Integrated LUFS target |

## Computing output-timeline times
Output time = sum over earlier segments of `(end - start) / speed`. Example: segment 1 is 41.2→47.0
(5.8s), and segment 2 is 1.5s at speed 0.4 (3.75s), so the replay runs from 5.8s to 9.55s on the output.

## Useful checks
```bash
python3 scripts/render_edit.py plan.json --dry-run      # show ffmpeg commands only
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of compact out.mp4
ffmpeg -v error -y -ss 1 -i out.mp4 -frames:v 1 check_hook.jpg
```
