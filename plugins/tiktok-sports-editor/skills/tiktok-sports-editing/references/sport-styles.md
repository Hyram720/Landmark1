# Pro editing recipes: basketball, football, boxing

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
