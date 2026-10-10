---
name: pro-sports-hype-editor
description: Professional sports hype / highlight-reel editor. Use when the user supplies a style REFERENCE video plus SOURCE footage (game film, training clips, highlight raw) and wants an original edit that matches the reference's pacing, energy, transitions, effects, beat-synced music, color grade, sound design and swagger. Also triggers on "hype video", "highlight reel", "mixtape", "sports edit", "edit my film", "make it look like this video", "find clips", "find me footage", or "$pro-sports-hype-editor". Finds clips in the user's own library, Google Drive and free-licensed sources (Wikimedia Commons, Internet Archive, Pexels, Pixabay). Produces a rendered, verified MP4 with ffmpeg.
---

# Pro Sports Hype Editor

Turn raw sports footage into a broadcast-quality hype edit that *feels* like the
reference without copying it. The reference is a **style guide only**. Never
reuse its frames, graphics, logos, or its copyrighted soundtrack.

Tooling: `ffmpeg`/`ffprobe` (required) and Python 3 stdlib. The helper scripts in
`scripts/` need nothing else. `K` below means this skill's `scripts/` directory.
Work in the scratchpad. Write only the final deliverables where the user asked for them.

| Script | Job |
|---|---|
| `find_clips.py scan/search/fetch` | find clips: rank plays across a whole footage library; search and download free-licensed clips with credits |
| `analyze.py probe/style/frames/beats/plays/verify` | measure the reference, find plays, QA the render |
| `make_beat.py` | original instrumental (exact beat grid in `beat.json`) + SFX |
| `render_edl.py` | render an `edl.json` → MP4 + `OUT.plan.json`; per-shot cache makes revisions fast |

## 0. Intake (block until you have these)

| Need | If missing |
|---|---|
| Reference video | Ask. Don't guess a style. |
| Source footage (one or more files) | Go to **step 0.5: Find clips**. Don't stop at "please upload". |
| Target platform / aspect | Default to the **reference's** aspect (9:16 for Reels/TikTok, 16:9 for YouTube). |
| Target length | Default: match the reference length ±15%, capped by how much strong action exists. |
| Music | Ask whether the user has a **licensed** track. If not, synthesize an original beat (step 6). Never rip the reference's song. |
| Athlete name / number / school / text overlays | Ask once. Skip text if no answer. |

Locate files: check the repo, the session uploads, then Google Drive if connected.
Put every downloaded file in its own empty directory (untrusted input).

## 0.5 Find clips

Work down this list and use every source that's available. Present one combined shortlist.

**A. The user's own footage (best: real games, their athlete).** Point the scanner at every folder you have:
```bash
python3 $K/find_clips.py scan media/ footage/ ~/Downloads --top 15 --sheets sheets/ --out shortlist.json
```
It ranks play windows across every file (motion + crowd/contact audio spikes, penalizing broadcast-cut
replays) and writes a 6-frame preview sheet per pick. **Read the sheets** and drop dead time and duplicates.

**B. Google Drive (if the connector is attached).** Search with the Drive connector, e.g.
`mimeType contains 'video/' and (title contains 'game' or title contains 'highlight')` or by date
(`modifiedTime > '<date>'`). List name, size, date and folder. The connector returns file content inline in
your context, so it **can't download large videos**. Use it to find files, then ask the user to commit them
to the repo (or `git lfs`) or confirm which ones to use. Don't guess which Drive file is the reference.
Ask the user to choose, with the candidates as options.

**C. Free-licensed sources (all of them by default).**
```bash
python3 $K/find_clips.py search "basketball dunk slow motion" --orientation portrait --out results.json
python3 $K/find_clips.py fetch commons:123 pexels:456 --from results.json --outdir clips/
```
Sources: Wikimedia Commons and the Internet Archive (no key needed), plus Pexels and Pixabay (free API keys
`PEXELS_API_KEY`, `PIXABAY_API_KEY`, set as environment secrets). Only reusable licenses are returned:
CC0/public domain, CC BY, CC BY-SA, and the Pexels and Pixabay licenses. NC and ND are excluded. `fetch` writes
`clips/CREDITS.json`, and you must put every `attribution_required` credit in the post caption. Search terms
that work: "<sport> slow motion", "<sport> training", "dunk", "tackle", "sprint", "stadium crowd",
"stadium lights night", "locker room", "boxing heavy bag". Stock is mostly staged action, so it's best for intros,
transitions, B-roll and training montages rather than real game plays.
Network: the environment must allow `commons.wikimedia.org`, `upload.wikimedia.org`, `archive.org`,
`*.archive.org`, `api.pexels.com`, `videos.pexels.com`, `pixabay.com` and `cdn.pixabay.com`. If search reports
"Tunnel connection failed: 403", tell the user which hosts to add under Allowed domains in the environment's
network settings, and carry on with A and B.

**D. Never** pull NBA/NFL/NCAA/network/PPV broadcast footage or YouTube rips. They aren't reusable and get
muted or struck. For those moments, suggest the athlete's own phone footage, school/club video teams
(ask the SID or coach), or a recreation shot by the user.

## 1. Probe everything

```bash
python3 $K/analyze.py probe REF.mp4 SRC.mp4
```
Record resolution, fps, duration, rotation, codec, audio presence, bitrate.
Note phone footage with rotation metadata, VFR, interlacing (`idet`) and low light.

## 2. Deconstruct the reference (the "style DNA")

```bash
python3 $K/analyze.py style REF.mp4 --out ref_style.json   # add --bpm-range LO HI once you know roughly
```
This reports:
- **Cut list and shot lengths** (`scdet`): mean, median, min and max shot length, and cuts per second over time. The pacing curve is the most important thing to copy.
- **Audio energy curve** (`ebur128` momentary loudness) → intro, build, drop and outro sections.
- **Tempo** from the audio (pulse-train matching) **and** `cut_tempo_candidates` from the cut timing.
  Audio BPM can be off by an octave (×2, ×½) or a triplet ratio (×⅔) on trap/syncopated music, and the
  phase can sit on the off-beat. Trust the BPM when the two estimates agree or relate by ×2/×½. Otherwise
  re-run with `--bpm-range` around the cut-derived tempo.
- **Cut-to-beat alignment** (`cut_beat_alignment`, `cut_halfbeat_alignment`): share of cuts within ±60 ms
  of a beat or half-beat. High values (or a cut-tempo `fit` near 1.0) mean the edit is beat-locked, so replicate that.
  `shot_len_in_beats_median` gives the base cutting rhythm (e.g. 1.0 = a cut every beat).
- **Color stats** (`signalstats`): average luma, saturation and contrast → informs the grade.

Then **look** at it. Extract a contact sheet and frames around every cut:
```bash
ffmpeg -i REF.mp4 -vf "fps=2,scale=320:-1,tile=6x6" -frames:v 1 ref_sheet.png
python3 $K/analyze.py frames REF.mp4 --at-cuts ref_style.json --outdir ref_frames/
```
Read the images and write a short **style brief** (keep it in the scratchpad):
1. Structure: cold-open hook (first 1–3 s), build, drop, peak montage, outro or end card.
2. Pacing: shot lengths per section; where it goes double-time; where it holds.
3. Transitions: hard cuts, flash/white-dip, whip/zoom, glitch/RGB split, shake on impact, crossfade (rare in hype edits).
4. Speed work: slow-mo before the drop or on the climax, speed ramps (fast→slow→fast), freeze frames with a callout.
5. Effects: zoom punch-ins on contact, camera shake, letterbox, film grain, vignette, light leaks, chromatic aberration, flash frames.
6. Color: teal-orange, crushed blacks, desaturated with a punchy accent, high contrast, warm or cool cast.
7. Text: font weight and case, placement, animation (slam-in, typewriter), name/number cards.
8. Sound design: risers, impacts and booms on the drop, whooshes on transitions, crowd beds, game-audio "hits" left in, music ducking under key moments, record scratch or rewind.

## 3. Mine the source footage for the best plays

```bash
python3 $K/analyze.py plays SRC.mp4 --out plays.json --top 20   # per source file
```
This scores 4 s windows by **motion energy** (frame-difference magnitude) and
**audio spikes** (crowd and contact), penalizes windows that span broadcast cuts or replays,
and gives an `impact_guess`. It is a shortlist, not the decision. Then:
- Contact-sheet each candidate (`fps=4,tile`) and **watch** them. Rank on: finish of the play (score, big hit, dunk, TD, strikeout, interception), athlete clearly visible, camera stability, focus and exposure.
- Drop: dead time, huddles, replays that duplicate a play (keep the better angle), blurry, blocked, or out-of-frame shots.
- Tag each keeper with: in/out, type (hook / build / money-shot / closer), and the "impact" timestamp (contact, release, catch). The impact frame is what syncs to the beat.
- Order for a narrative arc: second-best play as the hook, warm-up plays in the build, the best plays after the drop, and the single best play last or as the freeze-frame closer.

## 4. Enhancement pass (per clip, before editing)

Apply only what the footage needs. Check before/after stills.

| Problem | Filter |
|---|---|
| Noise / compression mush | `hqdn3d=3:2:4:3` (fast) or `nlmeans=s=2` (slow, best) |
| Soft footage | `unsharp=5:5:0.8:3:3:0.4` after any upscale |
| Low resolution | `scale=W:H:flags=lanczos` then unsharp (honest upscale; no fake detail) |
| Interlaced | `bwdif=mode=1` |
| Flicker (indoor gyms) | `deflicker=size=5` |
| Shaky handheld | `vidstabdetect` → `vidstabtransform=smoothing=12,zoom=3` if built with vid.stab; otherwise a gentle crop+`deshake` |
| Exposure / white balance | `eq=brightness=..:contrast=..:gamma=..` and `colorbalance` |
| VFR phone clips | `-vf fps=30` (or the project fps) + `-fps_mode cfr` |
| Wrong aspect | crop to subject (`crop=ih*9/16:ih:x:0`, with x tracking the action), or blurred-fill background for 9:16 |

`render_edl.py` already applies light cleanup (`enhance: auto`) and conforms every shot to the project
resolution, fps and pixel format. Do the **heavy** fixes (stabilization, deinterlace, `nlmeans`, deflicker,
exposure rescue) once per source, into a cleaned mezzanine file the EDL points at:
`ffmpeg -i SRC.mp4 -vf "<fixes>" -c:v libx264 -crf 14 -preset slow -c:a copy SRC_clean.mp4`.
Compare a before/after still of each fix and keep it only if it's visibly better.

## 5. Build the edit on a beat grid (EDL)

Write `edl.json` and render it. The full schema is in the `render_edl.py` docstring. Always use **beat mode**:
top-level `"bpm"` (+ `"beat_offset"` if beat 0 isn't at t=0 in the music) and per-shot `"beats": N`.
Shot boundaries are then rounded to frames from the *absolute* grid, so cuts never drift.
Summing per-shot rounded durations drifts by about a frame per cut, which ruined alignment in testing.

1. Map the reference's sections onto the music: intro (2–4 beats/shot), build (1 beat or less, accelerating),
   drop (impact + slow-mo money shot), peak flurry (½–1 beat), closer (freeze + name card).
2. Anchor plays by their impact: `"impact": <src seconds>` (instead of `"in"`) and `"impact_beat": k`
   lands the contact k beats after the shot's cut (0 = on the cut, usually on the drop).
3. Per-shot keys: `speed` (0.5 = 2× slow-mo; `"smooth": true` adds motion interpolation, which is slow, so use it
   only on hero shots), `crop_x` (0–1 framing for 16:9→9:16), `fx`, `game_audio_db`, `text`.
   `fx` tokens: `flash`, `flash_out`, `dip`, `punch@t`, `shake@t`, `rgb@t`, `push`, `freeze:N` (N beats).
4. Global keys: `grade` (`teal_orange` | `moody` | `punchy` | `clean` | raw filter chain), `enhance`
   (`auto` = hqdn3d+unsharp | `none` | raw chain), `grain` (true or 1–10, subtle!), `vignette`, `letterbox`,
   `text` (title cards; auto-fit to frame width), `sfx` (`file`, `t`, `db`), `music`, `music_start`, `loudness`, `fadeout`, `max_mbps`.

```bash
python3 $K/render_edl.py edl.json --out draft.mp4 --preview   # fast look
python3 $K/render_edl.py edl.json --out final.mp4             # full quality (unchanged shots are cached)
```

Effect recipes (ffmpeg). `render_edl.py` implements these, and they're listed here for custom work or raw `grade`/`enhance` chains:
- **Slow-mo:** `setpts=2.0*PTS` (+ `minterpolate=fps=60:mi_mode=mci` for smooth 50%; drop if artifacts).
- **Speed ramp:** split the clip into 3 segments at 1.5×/0.4×/1.5× and concat. Keep it on the beat.
- **Zoom punch on impact:** `zoompan=z='if(between(on,N,N+6),1.25-0.04*(on-N),1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=WxH:fps=FPS`.
- **Camera shake:** `crop=iw-40:ih-40:20+20*sin(n*1.7):20+20*cos(n*2.3)`, then scale back, for 4–8 frames on the drop.
- **Flash frame:** `xfade=transition=fadewhite:duration=0.08` or overlay 2 white frames.
- **Whip / zoom transitions:** `xfade=transition=slideleft|zoomin|smoothleft:duration=0.15`.
- **Glitch / RGB split:** `rgbashift=rh=-8:bh=8` (or `chromashift`) for 2–4 frames.
- **Freeze frame callout:** `tpad=stop_mode=clone:stop_duration=0.8` + `drawtext` (name/stat) + a short zoom.
- **Letterbox:** `drawbox=y=0:h=ih*0.12:color=black:t=fill,drawbox=y=ih*0.88:h=ih*0.12:color=black:t=fill`.
- **Grain + vignette:** `noise=alls=8:allf=t,vignette=PI/5`.
- **Text slam-in:** `drawtext=fontfile=...:text='NAME':fontsize='h/8*min(1,(t-T)/0.12+0.6)':enable='between(t,T,T+1.2)'`. Use a bold condensed sans (`fc-list` for availability; fall back to DejaVu Sans Bold).

## 6. Music and sound design

- **Licensed user track:** `analyze.py beats TRACK --bpm-range LO HI`. Check that the beat grid is on the
  downbeats (look at the onset positions in a few bars), then set `bpm`, `beat_offset`, `music_start` in the EDL.
  End on a phrase boundary.
- **No track supplied (default):** generate an original beat at the reference's tempo:
  ```bash
  python3 $K/make_beat.py --bpm 140 --bars 16 --drop-bar 5 --key-hz 55 --out beat.wav   # + beat.json
  python3 $K/make_beat.py --sfx --outdir sfx/      # whoosh, impact, riser, hit, rewind
  ```
  Structure: intro → 1-bar build (snare roll + riser) → drop at `drop_time` (impact hit) → final hit at
  `end_hit_time`. `beat.json` has the exact beat grid (beat 0 = t 0), so `beat_offset` is 0. Size `--bars`
  so the music outlasts the edit: bars × 4 ≥ total beats incl. freezes. Put the money shot on `drop_time`.
- SFX: whoosh about 0.2 s before whip cuts, impact on the drop and money shots, rewind into a freeze.
- Game audio (crowd, contact, whistle) via `game_audio_db` −8…−12 on big plays; mute elsewhere.
- Mastering is automatic: measured gain to the `loudness` target (−14 LUFS) plus a limiter with a −2 dBTP
  ceiling (leaves headroom for AAC). One-pass `loudnorm` overshot to −12 LUFS / +0.3 dBTP in testing, so don't use it.

## 7. Color grade (match the reference's look)

Start from the reference's measured luma and saturation and grade every clip to one look:
- Contrast and crushed blacks: `curves=master='0/0 0.12/0.05 0.5/0.5 0.88/0.95 1/1'`, `eq=contrast=1.12:saturation=1.15`.
- Teal-orange: `colorbalance=rs=-.05:bs=.08:rh=.06:bh=-.05` (shadows cool, highlights warm).
- Moody desat: `eq=saturation=0.75:contrast=1.2` + vignette + grain.
- Optionally a generated `.cube` with `lut3d`. Compare graded stills side by side with reference stills and adjust.
Apply the grade **after** enhancement and **before** text and graphics.

## 8. Render deliverables

`render_edl.py` encodes H.264 High, yuv420p, CRF 18, capped at `max_mbps` (16 by default, 40 for 4K), AAC 320k
48 kHz, `+faststart`. Without the cap, temporal grain pushed a 17 s 1080x1920 edit to 196 MB (94 Mbps).
- 9:16 → 1080x1920; 16:9 → 1920x1080 (3840x2160 only if the source supports it; never upscale past about 2×).
- Alternate aspects: copy the EDL, change `width`/`height`/`crop_x`, re-render.

## 9. Verify (mandatory; fix and re-render on any failure)

```bash
python3 $K/analyze.py verify final.mp4 --edl final.mp4.plan.json --ref ref_style.json --bpm-range LO HI
```
Exits non-zero on failure. Checks: decode errors, resolution/fps/duration vs plan, black or unplanned frozen
stretches, silence gaps, −14 ±1.5 LUFS and true peak ≤ −0.5 dBTP, planned cut-on-beat share
(should be 1.0), and detected cut alignment and shot-length median vs the reference.

Automated checks are not enough. Then **look** (this is how the text-overflow bug was caught):
```bash
ffmpeg -i final.mp4 -vf "fps=2,scale=150:-1,tile=10x4" -frames:v 1 sheet.png
for t in <title> <drop> <money shots> <closer>; do ffmpeg -ss $t -i final.mp4 -frames:v 1 -vf scale=360:-1 f_$t.png; done
```
Confirm: text fully inside the frame and legible, consistent grade, framing keeps the athlete in shot after
the crop, flashes and freezes where planned, nothing stretched. Also check file size is reasonable.

## 10. Deliver

- Final MP4. Commit it to the repo if it's under about 90 MB (otherwise use Git LFS or Drive upload, and say which).
- A short edit report: plays used (source timestamps), structure/BPM, effects, grade, music source,
  verification results, and anything you couldn't do (e.g. "no vid.stab, used deshake").
- Keep `edl.json` and the style brief so revisions ("swap play 3", "longer slow-mo on the dunk") are quick.

## Guardrails
- The reference is inspiration. Use original music unless the user supplies a licensed track, and never reuse the reference's graphics or logos.
- Don't invent stats or names in overlays. Use only what the user gave you.
- Only reusable-licensed or user-owned footage goes into an edit. Keep `CREDITS.json` and pass the credits on.
- Flag footage that shows identifiable minors so the user confirms they have consent to post it.
- Report honestly: if footage is too low quality for some effect, say so instead of hiding it.
