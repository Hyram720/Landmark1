# Running CeeDee's Routes: a 3-episode recreation series

**Concept:** a local receiver tries to run CeeDee Lamb's signature routes and catches. We film it like
an NFL broadcast and edit it like the real highlight. All the footage is original, so it qualifies for
TikTok Creator Rewards and can't get struck for NFL copyright. Every episode is in the **payout
format** (62–75s).

Why it works: CeeDee is one of the most searched receivers (search value), recreations are original
(originality), the fail → coaching → success arc holds viewers to the end (play duration), and "rate it
1–10 / better than CeeDee?" drives comments (engagement).

## The episodes
| # | Episode | The CeeDee trait it shows | Hook |
|---|---|---|---|
| 1 | **The slant** | A quick, deceptive release and a hard break inside, catching on the run | "HIGH SCHOOLER vs CEEDEE LAMB'S SLANT" |
| 2 | **The one-hander** | Snatching the ball outside his frame with one hand | "CAN HE MAKE CEEDEE'S ONE-HAND CATCH?" |
| 3 | **Catch + YAC** | Body control at the catch point, then turning upfield | "CEEDEE MAKES THIS LOOK EASY" |

The traits come from scouting write-ups of Lamb's game: his release and slant work, his quickness in
and out of breaks, and his catch radius away from his body ([Fantasy Footballers](https://www.thefantasyfootballers.com/articles/ceedee-lamb-possess-all-the-traits-you-want-in-a-no-1-wide-receiver),
[Sharp Football / SIS](https://www.sharpfootballanalysis.com/analysis/sis-football-rookie-handbook-preview-ceedee-lamb)).
Have the receiver study CeeDee's real routes on NFL.com or YouTube for technique. That's research,
not footage for the edit.

## Cast and permissions
- **Receiver:** ideally 18+ (simpler releases). For a minor, get a signed parent/guardian release
  before filming.
- **QB** who can throw a catchable slant, and a **DB** willing to get "cooked" on camera.
- Get a **video release** signed by everyone on camera (name, image, use on social and in paid
  content). Free templates are easy to find; keep the signed copies.
- **Field:** a school or park field with permission. Get end-zone and hash marks in the shot so it
  looks like real football.

## Shot list (episode 1; reuse the setup for 2 and 3)
Film at **60fps or higher** (smooth slow-mo) and 4K if possible. Lock exposure. Shoot horizontal on
cameras A, B, and E, and vertical on C, D, and F.

| File | Camera / angle | What to capture | Length |
|---|---|---|---|
| `footage/A_wide.mp4` | Tripod at midfield, high on the sideline (stand on bleachers), wide like the broadcast | Every rep: 2 failed attempts and 3–5 clean reps | One continuous recording |
| `footage/B_low_feet.mp4` | Low, near ground level, 5 yards off the line | The release footwork (3-step release, plant, break). Run it 3–4 times slowly, then at full speed | ~20s |
| `footage/C_phone_slowmo.mp4` | Phone in slow-mo (120/240fps), vertical, near where the ball is caught | The clean catch, tight: hands, ball, face | ~5s best take |
| `footage/D_talking_head.mp4` | Phone vertical, eye level, athlete to camera | "CeeDee's slant is the hardest route to guard in the league. Here's why... let's see if I can run it." (10–12s) | ~15s |
| `footage/E_endzone.mp4` | Tripod behind the end zone, looking down the route | The clean reps (the replay angle, with the hit-stack on the catch) | Continuous |
| `footage/F_reaction.mp4` | Handheld | Teammates reacting, the DB's face, a dap-up after the clean rep | ~10s |

Also record 10s of natural sound (cleats, ball pop, teammates hyping). It's great for the replay.

## The edit (episode 1, ~64s)
The render-ready plan is `ep1-slant.plan.json`. After filming, set the real `start`/`end` times for each
segment (the `_note` on each says what goes there), then render:
```bash
python3 plugins/tiktok-sports-editor/skills/tiktok-sports-editing/scripts/render_edit.py projects/ceedee-lamb/ep1-slant.plan.json
```
Or just run `/sports-clip projects/ceedee-lamb/footage football "episode 1, CeeDee slant recreation"`.

| Time | Beat | Re-hook |
|---|---|---|
| 0–3s | **Cold open:** the clean catch in slow-mo with a flash + glitch, plus the hook | Promise |
| 3–15s | **Setup:** the athlete explains why CeeDee's slant is so hard to guard | "Can a high schooler run it?" |
| 15–27s | **Attempts 1 & 2 fail:** "TOO SLOW", "ROUNDED IT" | Fails build tension |
| 27–41s | **Coaching:** slow-mo footwork, freeze on the plant step, "THE SECRET: 3-STEP RELEASE" | Viewer learns something |
| 41–54s | **Attempt 3, the clean rep:** real speed, then an end-zone replay at 0.35x with flash + shake + boom, "COOKED" | The payoff |
| 54–61s | **Reaction:** teammates, the DB's face, "CEEDEE WOULD APPROVE?" | Social proof |
| 61–64s | **Loop end:** the cold-open frame in B&W + "RATE THE ROUTE 1–10" | Comments + rewatch |

## Post package (episode 1)
- **Caption:** "Tried to run CeeDee Lamb's slant 🏈 Took 3 tries... rate the route 1–10 👇 Part 2: the one-hander"
- **Hashtags:** `#ceedeelamb #dallascowboys #wrdrills #footballtraining #routerunning`
- **Search keywords** (say them in the voiceover too): "CeeDee Lamb slant", "how to run a slant",
  "wide receiver release"
- **Cover:** the "COOKED" catch frame
- **Post:** during the NFL season, the evening after a Cowboys game when CeeDee had a big day (search
  spikes then). Reply to comments in the first hour, and pin the best "rate it" comment.
- **Series hook:** end every episode by teasing the next one, and post the next one 2–3 days later.
