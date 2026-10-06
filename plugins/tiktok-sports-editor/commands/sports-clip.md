---
description: Edit sports footage (basketball, football, boxing, college football, college basketball, ...) into a pro-style TikTok clip
argument-hint: <video-or-folder> [sport] [angle, e.g. "#23's dunk" or "the KO in round 3"]
---

Use the `tiktok-sports-editing` skill to edit this footage into a TikTok clip with pro-editor style, in
the default **payout format**: 62–75 seconds and eligible for Creator Rewards (see
`references/creator-rewards.md`), unless a shorter length is requested.

Footage, sport, and angle: $ARGUMENTS

If the footage path is missing, ask for it. Infer the sport from the request or the frames if it isn't
given. Use `college_football` / `college_basketball` for NCAA-level games (band, student section, college
courts and fields). Follow the skill workflow end to end:
1. Run `analyze_footage.py` with the right `--sport` and confirm the moments by viewing frames.
2. For multi-moment footage, draft the 60s countdown with `draft_plan.py`, then pick the matching recipe in `references/sport-styles.md` and design the edit: hook, payoff, replay,
   and impact effects placed exactly on the hit frame.
3. Render (the Sun Custom Designs watermark is applied automatically), then verify the output frames.
4. Finish with the post package: hook variations, caption, hashtags, cover, and posting window.
