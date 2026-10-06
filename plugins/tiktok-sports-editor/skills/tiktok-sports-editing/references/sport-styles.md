# Pro editing recipes: basketball, football, boxing, college football, college basketball

Edit like a pro editor: every effect **lands on an action**. Flash, shake, and boom go on the exact
impact frame (use `impacts_in_clip` from the analyzer, then confirm with frames). Never put effects on
random beats. Restraint is what gives an edit swag: use one or two signature moves per clip, executed
perfectly, and every edit still gets the Sun Custom Designs watermark (automatic).

All times below are on the **segment's** output timeline (`at` = seconds from the segment's start).

---

## 🏀 Basketball
**Look for:** dunks (especially posters), chase-down blocks, ankle-breakers, deep or logo threes, buzzer
beaters, no-look dimes, bench and crowd eruptions.

**Grade:** `punchy` (gyms), `teal_orange` (outdoor/streetball), `cinematic` (mixtapes).

| Move | Recipe |
|---|---|
| **Poster dunk** | Real speed through the takeoff → replay at 0.35x from the gather with `zoom: 1.4`, `flash` + `shake` + `boom` at the rim contact, `freeze: 0.5` on the hang, then cut to the bench reaction. Impact caption: "POSTERIZED" |
| **Ankle breaker** | Real speed → replay at 0.4x starting 1s before the crossover, `zoom_ramp` into the defender, `freeze: 0.7` on the defender falling + `stamp` caption "🔒 COOKED" (emoji in the TikTok caption only), `whoosh` into the finish |
| **Deep three / buzzer beater** | Start on the release; `freeze` at the top of the arc with a `top` caption "0.4 LEFT"; resume; `flash` + `boom` on the swish; end on the crowd |
| **Block** | Slow 0.3x on the contact, `rgb_split` + `shake`, `impact` caption "GET THAT OUT" |
| **Mixtape** | 8–12 clips of 1.5–3s cut **on the beat** (`find_beats.py`), best play on the drop, `whoosh` between clips, `cinematic` grade, name + class year hook ("2027 PG • 6'1") |

## 🏈 Football
**Look for:** long TD runs, one-handed or toe-tap catches, jukes and spin moves, big hits (legal ones),
pick-sixes, strip sacks, trick plays, sideline celebrations.

**Grade:** `teal_orange` (Friday night lights), `gritty` (hits/defense), `cold` (rain, snow, night games).

| Move | Recipe |
|---|---|
| **Long TD** | Snap at real speed → **speed ramp**: the middle of the run at `speed: 1.5`, the final cut/juke at 0.5x, the end zone at real speed. `top` caption with yardage ("85 YDS"), `freeze` on the stiff-arm or juke |
| **Big hit** | 2–3s of build-up → replay at 0.3x with `zoom: 1.5`, `flash` + `shake` (strength 1.4) + `boom` on contact, `bw` for the freeze. `impact` caption "WELCOME TO VARSITY" |
| **Circus catch** | Replay at 0.35x from ball-in-air, `zoom_ramp` onto the hands, `freeze: 0.6` on the catch with a `stamp` caption, then the sideline reaction |
| **Juke / spin** | Real → 0.4x replay with `zoom_ramp`, `whoosh` on the cut, caption on the defender "📍 HE'S STILL THERE" (emoji in the TikTok caption only) |
| **Hype intro** | Tunnel walk / smoke / stadium lights at 0.5x, `cinematic` grade, kinetic `words: true` caption "WE. DON'T. LOSE." on the beat |

Avoid glorifying dangerous or illegal hits (helmet-to-helmet). TikTok may restrict them, and they're
bad for the athlete's recruiting.

## 🥊 Boxing
**Look for:** knockdowns and KOs, clean counters, combos (3+ punches landing), slips/rolls into counters,
walk-offs, staredowns, ring walks, training-camp grind.

**Grade:** `gritty` (fight night), `mono` (dramatic replays), `cinematic` (ring walks).

| Move | Recipe |
|---|---|
| **KO / knockdown** | 2–3s at real speed → **triple replay**: (1) 0.5x wide, (2) 0.3x with `zoom: 1.5`, (3) 0.2x with `zoom: 1.8` + `bw`. On each replay, `flash` + `shake` + `boom` exactly on the landed punch. `freeze: 0.8` on the fall + `impact` caption "LIGHTS OUT" |
| **Combo** | 0.5x replay with `impact` captions counting each landed punch using `words: true` ("1 2 3 4"), timed to the analyzer's `impacts_in_clip`. A small `shake` on each |
| **Slick defense** | 0.4x on the slip with `zoom_ramp`, `rgb_split` on the miss, then real speed on the counter + `flash` |
| **Walk-off KO** | Freeze on the punch, unfreeze into the walk-off at real speed, `cinematic`, end on the walk (loops well) |
| **Training montage** | Heavy bag, pads, and road work cut on the beat, `gritty`, kinetic hook "4:30AM WHILE YOU SLEEP" |

---

## 🏟️ College football (CFB)
**Look for:** long TDs, pick-sixes, kick and punt return TDs, one-handed catches, blocked kicks,
goal-line stands, 4th-down conversions, upsets, and especially the **atmosphere**: the student section
erupting, the band hitting the fight song, the jump-around/sandstorm moments, field storming, and
traditions (tunnel runs, mascot entrances, the rivalry trophy).

**Grade:** `teal_orange` (Saturday afternoon), `cinematic` (night games, stadium lights), `gritty`
(trenches, rivalry games).

**Detection:** use `--sport college_football` (alias `cfb`). The band and student section keep the
crowd loud all game, so this profile ranks sudden **surges** over sheer loudness.

| Move | Recipe |
|---|---|
| **Upset / rivalry TD** | Score bug or a `top` caption with context ("UNRANKED vs #6 • 4TH QTR") → the play at real speed → 0.4x replay with `zoom_ramp` → cut to the student section at the surge with `flash` + `boom` → end on the band or the stands shaking |
| **Return TD** | Catch at real speed → middle of the return at `speed: 1.5` → `freeze: 0.5` + `stamp` "NOBODY'S CATCHING HIM" on the last cut → real speed into the end zone → `whoosh` cut to the sideline mob |
| **Pick-six** | Start on the QB's release, 0.35x replay on the jump with `zoom: 1.5`, `rgb_split` on the catch, then real speed for the run |
| **Atmosphere edit** ("this is college football") | 6–10 shots cut **on the beat**: tunnel run, band, students, a play, the surge, the fight song. Kinetic `words: true` caption "THIS. IS. SATURDAY." `cinematic` grade. These travel far with alumni and fans |
| **Field storm** | Final whistle at real speed → 0.5x as the first students hit the field → `bw` freeze on the crowd wave → color snaps back on a `boom` |
| **Gameday / NIL vlog** | Athlete POV (locker room, walkout, warmups) filmed by or with the athlete, `top` caption "GAMEDAY VS [RIVAL]", fast cuts, `punchy` grade |

## 🏀 College basketball (CBB / March Madness)
**Look for:** buzzer beaters, upsets (especially 12-over-5 and Cinderella runs), posters, chase-down
blocks, deep threes, the student section (cutouts, chants, the "airball" chant), court storming, the
bench mob after a big play, walk-on/senior-night moments, and Selection Sunday reactions.

**Grade:** `punchy` (arenas), `cinematic` (tournament runs), `mono` (the heartbreak or the final-shot
replay).

**Detection:** use `--sport college_basketball` (alias `cbb`). It ranks sudden surges, because the
student section is loud even during free throws.

| Move | Recipe |
|---|---|
| **Buzzer beater** | `top` caption with the clock ("0.8 LEFT • DOWN 2") → release at real speed → `freeze` at the top of the arc → swish with `flash` + `shake` + `boom` → court storm or bench mob at real speed → `bw` replay of the shot to end, which loops back to the start |
| **Cinderella / upset** | Hook "A 15 SEED DID THIS", 3–4 best plays from the run cut on the beat, final-horn reaction, kinetic "DANCE. MARCH. REPEAT." |
| **Poster in front of the student section** | Dunk at real speed → 0.35x replay with `zoom: 1.4` → `freeze` on the hang → `whoosh` cut to the student section going crazy (that reaction is what gets shared) |
| **Student section moments** | Chants, cutouts, the "you can't do that" chant, and the free-throw distraction. Short (6–10s), funny, caption-driven. Great for comments |
| **Senior night / walk-on bucket** | Emotional: `cinematic` grade, the bench reaction is the payoff, soft hook "HE WAITED 4 YEARS FOR THIS". These get huge shares |
| **Bracket-season content** | "Rate this bracket-buster 1–10", or a side-by-side of a mid-major star's mixtape. Post during the tournament window, when search and For You demand peaks |

## College-specific posting tips
- **Timing is everything:** post within an hour of the final whistle on gameday. Search and fan demand
  peak during Saturday games (CFB) and in March.
- **Hashtags:** the school + the rival + the conference + a format tag, e.g.
  `#[school]football #[rival] #secfootball #collegefootball` or `#marchmadness #[school]bball #collegehoops`.
- **Tag the school, athlete, and conference accounts** (only when the footage is yours to post). Reposts
  from official and athlete accounts are the biggest view multiplier in college sports.
- **Rivalries drive comments:** a hook that takes a (good-natured) side gets both fan bases commenting.

---

## Universal pro moves
- **Speed ramp:** split one action into 3 segments: 1.0x → 0.5x → 0.3x on the impact (or the reverse coming out).
- **Hit-stack:** `flash` + `shake` + `boom` together on one frame = the signature "impact" feel. Use it once or twice per clip.
- **Freeze + label:** freeze the frame, slam a `stamp` or `impact` caption, then unfreeze.
- **Beat sync:** run `find_beats.py` on the music. Make each segment's output length a whole number of beats, and set `music.start` so a drop lands on the payoff.
- **Whoosh transitions:** add `whoosh` at `at: 0` of the next segment whenever there's a jump cut.
- **B&W replay:** `bw` on the final slow-mo is cinematic and makes the color return hit harder.
- **Hook styles:** `box` (clean), `outline` (minimal), `stamp` (yellow label, the loudest).

## Font upgrade
Install a condensed heavy font (Anton, Bebas Neue, Oswald Bold, Impact) and set `"font": "Anton"` in
the plan. That's the single biggest upgrade to "pro" text. Check what's installed with `fc-list : family`.
