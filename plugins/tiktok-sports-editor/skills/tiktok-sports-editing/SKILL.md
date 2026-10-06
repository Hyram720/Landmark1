---
name: tiktok-sports-editing
description: Find and edit basketball, football, boxing, college football (CFB), and college basketball (CBB / March Madness) clips (and other sports) into vertical TikTok / Reels / Shorts edits with pro-editor style — sport-tuned highlight detection across whole footage folders, sourcing clips you're allowed to use, 3-second hooks, 9:16 reframing, speed ramps, slow-mo replays, freeze frames, flash/shake/boom impact effects, zoom ramps, color grades, kinetic captions, beat-synced cuts, the Sun Custom Designs watermark, and a posting plan. Use whenever the user wants to find, cut, edit, clip, or repurpose game film, fights, highlights, mixtapes, or athlete content for short-form vertical video, or asks how to get more views on sports clips.
---

# TikTok Sports Editing

Turn sports footage into short vertical clips edited like a pro, built for retention, because on TikTok
**retention is reach**. Completion, rewatches, shares, and comments decide how far a video travels.
Every decision below serves those signals.

All scripts are in this skill's `scripts/` directory and need only `python3` + `ffmpeg`/`ffprobe`:

| Script | What it does |
|---|---|
| `analyze_footage.py PATHS... --sport basketball\|football\|boxing\|college_football\|college_basketball [--top 8]` | Scans files **or whole folders** and ranks highlight moments by crowd roar, impacts (punches, hits, rim slams), and motion bursts, tuned per sport. College profiles rank sudden crowd *surges*, because bands and student sections are loud all game |
| `find_beats.py MUSIC` | BPM, beat grid, downbeats, and drops, for beat-synced cuts |
| `fetch_clip.py URL --license ... --source-page ...` | Downloads a clip you're allowed to use and logs its credit/license in `CREDITS.json` |
| `render_edit.py PLAN.json` | Renders the edit: reframe, grade, speed, freeze, effects, captions, watermark, music, loudness → 1080x1920 MP4 + cover |

References (read the ones the task needs before writing a plan):
- `references/sport-styles.md`: pro recipes for basketball, football, boxing, college football, and college basketball (**read for every edit**)
- `references/edit-plan-schema.md`: every plan field, effect, caption style, and watermark option
- `references/viral-playbook.md`: hooks, captions, hashtags, sound, posting
- `references/clip-sourcing.md`: where to find clips and what's safe to use

## Workflow

### 1. Intake
Footage location (a file or a folder), the **sport**, whose footage it is, the angle (a single play,
athlete mixtape, fight KO, training montage), and who it's for. If they have no footage, go to
*Finding clips*.

### 2. Find the moments
```bash
python3 scripts/analyze_footage.py ~/Footage/ --sport boxing --top 10 --out analysis.json
```
Each candidate has `peak`, `signals_at_peak` (which signal fired), and `impacts_in_clip` (sharp hits).
**Never trust a candidate blind.** Extract frames around each peak and look at them:
```bash
for t in 41 42 43 44; do ffmpeg -v error -y -ss $t -i fight.mp4 -frames:v 1 -vf scale=640:-2 f_$t.jpg; done
```
Pin down the exact start of the action, the **impact frame** (where effects go), the end of the
reaction, and the subject's horizontal position (for `crop_center`). For long footage or many files,
delegate the scouting to the `highlight-scout` agent.

### 3. Design the edit like a pro editor
Pick the matching recipe from `sport-styles.md` and adapt it to what's actually in the frames.
- **0–1.5s, the hook:** start in motion, with hook text that opens a curiosity gap.
- **Payoff at real speed → slow-mo replay** with a punch-in. The hit-stack (`flash` + `shake` + `boom`)
  goes exactly on the impact frame.
- **Signature moves, used with restraint:** speed ramps, freeze + stamp, zoom ramps, B&W replays,
  kinetic captions. Use one or two per clip, done well. Effects must land on actions, never at random.
- **Grade to the vibe:** `punchy`, `teal_orange`, `cinematic`, `gritty`, `cold`, `mono`.
- **Length:** 7–15s for a single play, 15–30s for a mixtape. End right after the reaction so it loops.
- **Music edits:** run `find_beats.py`, make segment lengths whole beats, and land the payoff on a drop.

### 4. Reframe
`crop` + `crop_center` when the action stays in one area (boxing in close, a dunk). `blur` when the full
width matters (fast breaks, open-field runs, passes). Override `reframe`/`crop_center` per segment to
follow the action.

### 5. Text
Hook ≤ 7 words. Captions 2–5 words, in hype-commentator voice. Use `impact` for the payoff, `stamp` for
freeze labels, `top` for score/clock/yardage, and `words: true` for punch counts and chants. Burned-in
emoji render monochrome, so put emoji in the TikTok caption instead.

### 6. Branding: Sun Custom Designs watermark
Every render is branded automatically (top-left, 85% opacity). It uses the logo at
`plugins/tiktok-sports-editor/assets/watermark.png` if present, otherwise the text "SUN CUSTOM DESIGNS".
Only change or disable it if the user asks. If the logo file is missing, mention once that they can add
it.

### 7. Audio
Keep the real crowd, commentary, and contact sounds. Add trending sounds **in the TikTok app**. Only use
`music` for audio the user owns or has licensed. Output is loudness-normalized to −14 LUFS.

### 8. Render and verify
Run `render_edit.py`, then ffprobe the output and look at frames for the hook, each impact, and the
ending. Check that the subject is in frame, effects land on the hit, text is readable and unclipped,
and the watermark is visible but not covering the action. Fix the plan and re-render as needed.

### 9. Package the post
Deliver 3 hook variations, a caption ending in a question, 3–5 hashtags, the cover frame, any credits
required by `CREDITS.json`, and the best posting window.

## Finding clips
When the user wants clips found for them, follow `references/clip-sourcing.md`:
1. **Their own library first:** run `analyze_footage.py` across their folders with `--sport`.
2. **Free-to-use stock:** search Pexels, Pixabay, Wikimedia Commons, and YouTube Creative Commons with the
   web tools. Download direct file links with `fetch_clip.py` so the license is logged.
3. **Permission:** draft DMs to local teams, gyms, videographers, and promoters offering edits for footage.
4. **College:** athletes' own NIL content, school creative teams, student media, footage shot from the
   stands (check venue policy), and D2/D3/NAIA/JUCO programs. See the college section of `clip-sourcing.md`.
5. **Pro/college broadcast footage (NBA, NFL, NCAA/March Madness, boxing PPV):** don't download or repost it. Offer the
   transformative formats in `clip-sourcing.md` instead.

## Rights and platform rules
- Never help disguise copyrighted footage to evade detection (mirroring, pitch-shifting, crops, or
  overlays meant to beat Content ID). Say plainly when footage isn't theirs to post.
- Credit creators when the license requires it (`CREDITS.json`).
- Minors: have parent or guardian consent before posting identifiable clips.
- Don't glorify illegal or dangerous hits. Don't promise view counts.
