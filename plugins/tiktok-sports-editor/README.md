# tiktok-sports-editor

A Claude Code plugin that **finds** basketball, football, boxing, college football, and college basketball clips and **edits** them into
vertical TikToks with pro-editor style, every one branded with the **Sun Custom Designs** watermark.

## Commands and agent

| Piece | What it does |
|---|---|
| `/find-clips <sport> [folder] [what]` | Scans your footage folders for the best moments, searches free-to-use sources (Pexels, Pixabay, Wikimedia, YouTube CC), and drafts footage-request DMs |
| `/sports-clip <video-or-folder> [sport] [angle]` | End-to-end pro edit: find the moment → hook → reframe → replay → impact effects → captions → watermark → render → post package |
| `/tiktok-post-plan <clip>` | Hooks, caption, hashtags, sound advice, and posting window |
| `highlight-scout` agent | Sifts full games, fight nights, or whole libraries and ranks moments with exact impact frames and an edit recipe |
| `tiktok-sports-editing` skill | The pro editing playbook (also triggers on its own when you ask to edit sports clips) |

## Built to get paid
Every edit defaults to the **payout format** for TikTok's Creator Rewards Program: 62–75 seconds
(Creator Rewards only pays on original videos over one minute), with a hook that holds past 5 seconds,
a re-hook every 8–12 seconds, the best moment last, and searchable keywords. `draft_plan.py` auto-builds
a 60+ second countdown edit from your footage, and every render reports whether it's long enough to
earn.

## Pro editing toolkit
- **Sport-tuned highlight detection**: basketball (dunks, blocks, threes), football (TDs, hits, catches),
  boxing (KOs, combos, counters), college football (`cfb`), and college basketball (`cbb`), from crowd
  roar, impact transients, and motion bursts, across whole folders. The college settings rank sudden
  crowd *surges*, so the band and student section don't fool them
- **Effects**: flash, camera shake, eased zoom ramps, black & white, RGB-split glitch, vignette, and
  synthesized **boom** (808 hit) and **whoosh** sounds
- **Moves**: speed ramps, slow-mo replays (down to 0.2x), freeze frames (crowd audio keeps rolling),
  per-segment crop that follows the action
- **Grades**: punchy, teal_orange, cinematic, gritty, cold, mono
- **Text**: box/outline/stamp hooks, plus cap, pop, impact (slanted slam), stamp (label), and top (score
  bar) captions; kinetic word-by-word captions
- **Beat sync**: `find_beats.py` gives BPM, beats, and drops so cuts land on the beat
- **Brand watermark**: Sun Custom Designs on every render (see below)
- **Clip sourcing with license logging**: `fetch_clip.py` writes `CREDITS.json`

## Sun Custom Designs watermark
The Sun Custom Designs logo ships with the plugin (`assets/watermark.png`: a sunset sun plus the
SUN / CUSTOM DESIGNS wordmark), and every edit carries it top-left. There's also a sun-only icon
(`assets/sun-icon.png`) for a smaller mark or a profile picture. Position, size, and opacity can be
changed per edit (see `skills/tiktok-sports-editing/references/edit-plan-schema.md`). To swap logos,
replace `assets/watermark.png`.

## Requirements
`python3` (3.8+) and `ffmpeg`/`ffprobe` with libass (standard on most distributions and in Homebrew).

## Install
```
/plugin marketplace add hyram720/landmark1
/plugin install tiktok-sports-editor@landmark-plugins
```

## Examples
```
/find-clips boxing ~/Footage/fight-night "knockdowns and big combos"
/sports-clip ~/Footage/varsity_vs_central.mp4 football "the 85-yard TD in the 4th"
/sports-clip ~/Footage/aau/ basketball "best 3 dunks, mixtape style"
/sports-clip ~/Footage/homecoming.mp4 college_football "the pick-six and the student section"
/find-clips college_basketball "buzzer beaters and court storms"
```

## Rights
Built for footage you filmed, have permission for, or that's licensed for reuse. It won't download or
disguise NBA/NFL/NCAA/March Madness/PPV broadcast footage to get around platform detection. It suggests
transformative formats and, for college sports, legitimate paths such as athlete NIL content, school
creative teams, and student media.
