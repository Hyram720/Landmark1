# Brand assets: Sun Custom Designs

| File | Use |
|---|---|
| `watermark.png` | Full logo (sunset sun + SUN / CUSTOM DESIGNS wordmark), transparent PNG, 1413x592. Applied to every edit automatically, top-left, 280px wide, 90% opacity |
| `sun-icon.png` | Sun emblem only, square 564x564, transparent. For a smaller, cleaner watermark (`"watermark": {"image": ".../sun-icon.png", "width": 120}`) or a profile picture |
| `source/make_logo.py` | Rebuilds the logo with ImageMagick: `python3 make_logo.py Anton-Regular.ttf watermark.png` |

Design notes:
- Colors: gold-to-orange gradient (#FFD84A → #FF6A00) with white "CUSTOM DESIGNS"
- Font: [Anton](https://github.com/google/fonts/tree/main/ofl/anton) (SIL Open Font License, free for
  commercial logo use)
- A thin dark contour keeps it readable over bright footage as well as dark footage

To use a different logo, replace `watermark.png` with any transparent PNG (600px+ wide) of the same name.
