---
name: tiktok-sports-editing
description: Edit sports footage into vertical TikTok / Reels / Shorts clips built for views — find the highlight, cut a 3-second hook, reframe 16:9 to 9:16, add slow-mo replays, punch-in zooms, bold captions inside the UI safe zone, normalize audio, and export a TikTok-ready MP4 plus the caption, hashtags, and posting plan. Use whenever the user wants to cut, edit, clip, or repurpose game film, highlights, practice footage, sports broadcasts, or athlete content for TikTok or other short-form vertical video, or asks how to get more views on sports clips.
---

# TikTok Sports Editing

Turn raw sports footage into short vertical clips designed for retention, because on TikTok **retention is
reach**: the For You feed pushes videos that people watch to the end, rewatch, share, and comment on.
Every edit decision below serves one of those signals.

Scripts live in this skill's `scripts/` directory and need only `python3` + `ffmpeg`/`ffprobe`:

| Script | What it does |
|---|---|
| `scripts/analyze_footage.py VIDEO [--clip-len 8] [--top 5] [--out analysis.json]` | Metadata, scene cuts, and ranked highlight candidates from crowd/commentary audio spikes |
| `scripts/render_edit.py PLAN.json [--dry-run]` | Renders the edit plan to a 1080x1920 H.264/AAC MP4 (and optional cover JPG) |

The edit-plan JSON format is in `references/edit-plan-schema.md`. Hook formulas, caption style, hashtag
strategy, and posting cadence are in `references/viral-playbook.md`. Read both before writing a plan.

## Workflow

### 1. Intake (ask only what you can't infer)
- Footage path(s), the sport, and **whose** footage it is (their own filming, a team/school they work
  with, or a licensed source). See *Rights* below.
- The angle: one athlete's highlight? a single crazy play? a funny moment? a skills/training clip?
- Who it's for: the athlete's recruiting page, a fan page, a brand, a local team.

### 2. Find the moment
Run `analyze_footage.py`. Candidates rank by crowd/commentator audio spikes (the payoff) with the clip
positioned so the peak lands ~70% in. **Never trust a candidate blind**: pull frames around each peak and
look at them to confirm what actually happens:

```bash
for t in 40 42 44 46; do ffmpeg -v error -y -ss $t -i game.mp4 -frames:v 1 -vf scale=640:-2 frame_$t.jpg; done
```

Then Read the JPGs. Find the exact second the play starts, the payoff frame, and where the subject is
horizontally in the frame (for `crop_center`). With no usable audio, rely on scene cuts plus frame review.

### 3. Structure the edit (the retention blueprint)
Target **7–15 seconds** for a single play and **15–30 seconds** for a multi-play highlight. Shorter edits
get more full watches and rewatches.

1. **0–1.5s, the hook.** Start *in motion*, never on a dead ball or a wide static shot. Overlay hook text
   that opens a curiosity gap ("Watch #23 on the left 👀", "Nobody expected this pass"). Cut out every
   second of setup the viewer doesn't need.
2. **Build-up.** Keep only the setup that makes the payoff land.
3. **Payoff at real speed**, then an immediate **slow-mo replay** (speed 0.4–0.5) with a punch-in
   (zoom 1.3–1.6) on the key moment. This is the single most reliable sports-edit pattern.
4. **Reaction or emphasis.** Crowd, bench, celebration, or an emphasis caption ("HE'S 15 YEARS OLD").
5. **Loop-friendly ending.** End abruptly right after the reaction, or on a frame that flows back into the
   opening, so autoplay replays feel seamless and count as rewatches. No outros, no logos, no "follow
   for more" end card.

### 4. Reframe for 9:16
- `crop` when the action stays in one area: set `crop_center` from what you saw in the frames. Make a
  separate segment with a different `crop_center` if the action moves.
- `blur` (default) when the full width matters (fast breaks, full-field plays, passes across the field).
  Use `zoom` on blur segments to fill more of the screen at the payoff.
- Footage that is already vertical passes through cleanly in any mode.

### 5. Text and captions
- Hook text: ≤ 7 words, ALL CAPS or Title Case, on screen for the first ~2–2.5s.
- Captions: 2–5 words each, timed on the **output** timeline (after speed changes). Use `emphasis: true`
  for the payoff line.
- The renderer keeps text out of TikTok's UI zones (top bar, right-side buttons, bottom caption area).
- Burned-in emoji render monochrome. Put color emoji in the TikTok caption instead, or add them with
  TikTok's text tool.

### 6. Audio
- Keep the real crowd and commentary. Authentic sound is a big part of why sports clips perform.
- For trending sounds, tell the user to **add the sound inside TikTok** after uploading (set the original
  audio low). That keeps the post eligible for the sound's discovery page and avoids music-licensing
  problems. Only use the plan's `music` field for audio the user owns or has licensed.
- Output is loudness-normalized to −14 LUFS.

### 7. Render and verify
Write the plan JSON next to the footage, run `render_edit.py`, then **check the output**: ffprobe it, pull
2–3 frames (hook, payoff, ending), and look at them. Confirm the subject is in frame, the text is readable
and not clipped, and the duration matches. Fix the plan and re-render if anything is off.

### 8. Package the post
Deliver with the video:
- **3 hook-text variations** to A/B on later posts
- **TikTok caption** (1 line plus a question to drive comments) and **3–5 hashtags** (see playbook)
- **Cover frame** (`cover_at` in the plan): the payoff frame with the hook text
- **Best posting window** and a note to reply to early comments within the first hour

## Rights and platform rules
- Prefer footage the user filmed or has permission to use (their own games, their athletes, their school
  or club with consent). Pro and college broadcast footage is usually owned by leagues and networks, and
  reposting it can get videos muted or removed and accounts struck.
- Do **not** help disguise copyrighted footage to evade detection (mirroring, pitch-shifting, cropping or
  overlays meant to beat Content ID). If the footage isn't theirs, say so plainly and suggest
  alternatives: filming their own content, licensed clips, or commentary/reaction formats that add real
  original value.
- For minors, remind the user to have parent or guardian consent before posting identifiable clips.
- Don't promise view counts. Frame advice as what tends to improve retention and reach.
