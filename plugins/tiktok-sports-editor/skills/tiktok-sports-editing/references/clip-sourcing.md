# Finding basketball, football and boxing clips

Look in this order. The higher up the list, the safer the clip is to post and monetize.

## 1. The user's own footage library (best)
Game film, phone footage, Hudl/GameChanger exports, gym and sparring sessions, and team camera angles.
Run the sport-tuned detector across whole folders:

```bash
python3 scripts/analyze_footage.py ~/Footage/hoops --sport basketball --top 10 --out hoops.json
python3 scripts/analyze_footage.py fight_night/ sparring/ --sport boxing --top 10 --out boxing.json
```

Then confirm every candidate by viewing frames before editing.

**Getting more of it:** offer local high school or AAU teams, boxing gyms, and youth leagues free edits in
exchange for footage access and a tag. This is the most reliable long-term clip pipeline, and it builds a
client list.

## 2. Free-to-use stock (safe; good for B-roll, intros, and training content)
Search with the web tools, then download the **direct file link** with `fetch_clip.py`:

| Source | Search URL pattern | License flag |
|---|---|---|
| Pexels | `https://www.pexels.com/search/videos/<boxing|basketball|american football>/` | `pexels` |
| Pixabay | `https://pixabay.com/videos/search/<boxing>/` | `pixabay` |
| Wikimedia Commons | `https://commons.wikimedia.org/w/index.php?search=<boxing>&title=Special:MediaSearch&type=video` | check the file page: `cc0`, `cc-by`, or `cc-by-sa` |
| YouTube (Creative Commons filter) | Search → Filters → Features → *Creative Commons* | `cc-by`. Credit the creator; only ever download through YouTube's own tools or with the creator's permission |

Useful search terms:
- **Basketball:** "basketball dunk slow motion", "streetball", "basketball crossover", "hoop training"
- **Football:** "american football tackle", "football catch slow motion", "football training drill", "stadium crowd"
- **Boxing:** "boxing sparring", "heavy bag", "boxer shadow boxing", "boxing gym", "boxing ring lights"

Stock is mostly staged action, so it works best for intros, transitions, hype-montage filler, and
training-motivation edits, not "real game" highlights.

## 3. Permission from creators and rights holders
- DM local photographers and videographers, school media teams, and boxing promoters for their clips,
  offering credit and a tag. Save the permission message and log it with `--license permission`.
- Many promotions and leagues run creator or partner programs that license highlights to approved
  accounts. Apply rather than reposting.
- Paid editorial licensing (e.g. Getty/Shutterstock editorial video) is the clean route for
  pro-level moments when there's a budget: `--license licensed`.

## 4. Pro and college broadcast clips (NBA, NFL, NCAA, boxing PPV)
These are owned by leagues and networks and are actively enforced: expect muted audio, takedowns,
strikes, and demonetization. **Don't download or repost them**, and never try to disguise them to
dodge detection. Transformative formats that build views without reposting the broadcast:
- **Breakdown/analysis** of a play using a drawn diagram, a re-enactment, or your own footage of the move
- **Reaction/commentary** filmed by the creator (green-screen over a *still image* or a news headline)
- **Recreations:** have a local athlete recreate the famous move and edit it like the original
- **Stats/story edits:** photos you have rights to plus text, voiceover, and kinetic captions

## Logging
`fetch_clip.py` writes `CREDITS.json` next to downloads. Before posting, read it and put any required
credit (`🎥 @creator`) in the TikTok caption.
