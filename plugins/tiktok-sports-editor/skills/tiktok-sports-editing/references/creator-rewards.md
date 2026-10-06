# Payout format: TikTok Creator Rewards (the default)

Every edit defaults to the format that earns from TikTok's Creator Rewards Program. Only make a shorter
clip when the user asks for one, and say plainly that it won't earn.

## The gate: what gets paid at all
| Requirement | What it means for the edit |
|---|---|
| **Longer than 1 minute** | Target **62–75s**. Never 59–60s: some sources say "longer than", others "at least". `render_edit.py` reports `creator_rewards_length_ok` |
| **Original content** | The user's own footage, recreations, or licensed footage, plus a real edit and ideally a voiceover. Reposts, Duets, Stitches, other creators' clips, and NFL/NBA/NCAA broadcast footage don't qualify (and risk strikes) |
| **Qualified views** | From the For You feed, **watched more than 5 seconds**, by real users. The first 5 seconds decide whether a view counts at all |
| **Account** | 18+, eligible country (US included), **10,000 followers and 100,000 views in the last 30 days** |

## What raises pay per view (the RPM factors)
TikTok weighs four things. Each maps to edit decisions:

1. **Play duration (retention).** Keep people watching to the end.
   - Hook in the first 2s, and something visibly happening by 5s (the qualified-view line).
   - **Re-hook every 8–12s:** countdown labels (#5 → #1), "wait for #1", a new angle, a speed ramp.
   - Save the best moment for last, and tease it in the cold open.
   - End on the payoff, with no outro, so the replay loops.
2. **Originality.** Own footage, recreations, breakdowns, and voiceover commentary all count as original.
   Auto-generated compilations of other people's clips don't.
3. **Search value.** TikTok search reads on-screen text, captions, and speech. Use specific searchable
   phrases: a player's name, a move ("how to run a slant"), a team, an event ("Week 14 highlights").
   Put the main keyword in the hook text, the caption, and the voiceover.
4. **Engagement.** Comments, shares, and follows: end with a question ("Rate the route 1–10"),
   debate bait ("Better than the original?"), and series hooks ("Part 2 tomorrow").

Audience location matters too: US viewers pay the most, so US-centric topics (NFL, college sports) help.

## The 60-second sports structures
| Structure | Best for | Shape |
|---|---|---|
| **Countdown** (default for highlights) | Several plays from one game, a fight card, a season | Cold open tease of #1 (3s) → #5 … #2 (play + slow-mo replay each, ~11s) → #1 with freeze + B&W. `draft_plan.py` builds this automatically |
| **Breakdown** | One great play, technique | Hook + the play (8s) → voiceover breakdown with freeze frames and zooms (40s) → full replay (8s) → question |
| **Recreation / challenge** | Pro moves recreated by a local athlete | Challenge hook → attempts and fails (fast) → coaching beat → the clean rep at full speed + replay → side-by-side reaction |
| **Story** | A player's journey, a comeback, senior night | Hook with the ending → back to the start → 3 beats → payoff → question |

## Growing to eligibility (10k followers / 100k views)
Before the account qualifies, post the 60s format anyway: it builds the habit and the back catalog.
Add 15–30s teasers of the same moments to grow reach. They don't earn but they funnel viewers to the
long versions. Post consistently (1–2 a day) and reply to comments in the first hour.
