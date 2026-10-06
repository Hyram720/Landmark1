---
description: Find basketball, football, boxing, college football, or college basketball clips worth editing, from your footage or safe sources
argument-hint: <sport> [folder to scan] [what you want, e.g. "knockouts", "dunks", "big hits"]
---

Use the `tiktok-sports-editing` skill and `references/clip-sourcing.md` to find clips for: $ARGUMENTS

1. If a folder is given (or ask whether they have one), scan it with
   `analyze_footage.py <folder> --sport <sport> --top 12`, then confirm the best moments by viewing
   frames. The `highlight-scout` agent can do this for large libraries.
2. Search free-to-use sources (Pexels, Pixabay, Wikimedia Commons, YouTube Creative Commons) for the
   sport and the moment type. List the best 5–10 results with link, license, length, and what they'd be
   good for (highlight, B-roll, intro, transition).
3. Offer to download the picks with `fetch_clip.py` so the license and credit are logged.
4. Suggest 2–3 people to ask for footage (local teams, gyms, videographers, promoters; for college:
   athletes via NIL, the school's creative/video team, student media, and the SID) and draft the DM.
5. If they ask for NBA/NFL/NCAA/March Madness/PPV broadcast clips, explain why reposting them gets muted or struck,
   and offer the transformative formats from `clip-sourcing.md` instead.

End with a ranked shortlist and a recommendation for which clip to edit first with `/sports-clip`.
