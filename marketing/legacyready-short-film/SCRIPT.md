# The Shoebox — 60-second animated short for LegacyReady Family

**Logline:** A girl finds an unnamed photo in Grandma's attic, and together they search for the ancestor before his story fades.

**Runtime:** 60.0 s · 1920×1080 · 24 fps · 8 shots with 0.5 s dissolves · captions burned in.
**Cost:** $0.00. It was drawn and rendered locally with Sun Ad Studio MCP v0.4.1; no paid render APIs were used.

## Characters

| Character | Look |
|---|---|
| **Maya** (10) | Two big hair puffs, bright yellow shirt, blue jeans |
| **Grandma Rose** | Silver bun, round gold glasses, teal cardigan, pearls |
| **Elijah Carter** | The ancestor in the photo: hat, long coat, beside his wagon (sepia, then colour) |

## Shot list

| # | Time | Shot / camera move | Picture | Caption |
|---|---|---|---|---|
| 1 | 0:00–0:07.5 | Attic wide · crane reveal | A shaft of window light; Maya lifts a sepia photo out of an open shoebox. | Maya: "Grandma… who's this?" |
| 2 | 0:07–0:15 | Medium close-up · push in | Grandma Rose squints at the photo; thought bubble: *Elijah? Eli?… Ezra? Born 18…?* | Grandma Rose: "That's your great-great-grandpa…" / "Elijah? Or was it Eli?" |
| 3 | 0:14.5–0:22 | Insert · dolly zoom | One edge of the photo fades; the letters of his name drift away like dust. | When nobody writes it down… / …the story starts to fade. |
| 4 | 0:21.5–0:30 | Over the shoulder | A glowing tablet showing LegacyReady ancestry search: Elijah Carter · Charleston, SC · 1870–1920 · Newspapers. | Maya: "Let's search for him." / "Name, place, years… Charleston, 1870 to 1920." |
| 5 | 0:29.5–0:38 | Wide · parallax glide | A newspaper clipping (Source: Library of Congress), a photo and a land-patent map (Source: BLM land records) rise from the tablet; a "✓ Saved with source" badge. | Grandma Rose: "That's his land!" / Maya: "It's a lead. Let's save it with the source." |
| 6 | 0:37.5–0:45.5 | Tracking shot | String lights become a timeline: 1868 Born · 1889 Land patent · 1891 Married Hattie · 1902 Moved north; badge: "Private · only you see it". | Relatives, milestones, sources, and stories… / …saved together in one private place. |
| 7 | 0:45–0:52.5 | Wide · pull back | Family dinner under Elijah's portrait, now in colour; a booklet: *The Story of Elijah Carter*. | Maya: "Now everyone knows who he was." / Grandma Rose: "And nobody has to guess again." |
| 8 | 0:52–1:00 | Title card · locked off | **LegacyReady Family** · Search for your ancestors. Preserve your family's story. · *Start free — no credit card* · legacyreadyfamily.com · *Dramatization. Characters, names, and records shown are fictional.* | — |

## Claims check

Every product beat matches what legacyreadyfamily.com says today:
- **Search sources:** Library of Congress newspapers, photographs and maps, plus BLM land records.
- **Saving:** finds are saved with citations, alongside relatives, a timeline and stories.
- **Privacy:** private, so only the member sees their family history.
- **Price:** a free account, with no credit card required.

The script also follows the site's own guidance: a match is called **"a lead"** (the site says a matching record is a research lead, not proof). It also stays within the marketing rules:
- no income claims;
- no testimonials;
- no third-party genealogy brands named;
- the people and records are fictional and labelled as such.

## Rebuild

```bash
python3 marketing/legacyready-short-film/build.py /tmp/shoebox-work /tmp/the_shoebox_legacyready_60s.mp4
```

`scenes.py` draws the eight keyframes. `build.py` then does the rest:
- saves the film with `create_short_film`;
- writes captions timed to each shot;
- renders the camera moves with `assemble_video_clips(full_resolution=True)`.

## Not included yet

- **Voice and music:** the film is silent, and the dialogue is in captions. The `.srt` beside the MP4 doubles as a voiceover script.
- **Fully animated characters:** the characters are illustrated keyframes moved by camera motion. They don't walk or lip-sync. That needs a paid video model such as Higgsfield, which would need Fred's spend approval under the $0.00 rule.

## 3D animated version (Higgsfield)

A fully animated 3D version of the same script, made on 2026-10-25 with Fred's approval of a credit spend.

- **Watch / download:** https://d2ol7oe51mr4n9.cloudfront.net/user_391qpEAynVndVvvLA4RZWiHERjU/39f7bd2d-9867-4d5f-9ee7-72e7db6fabb2.mp4 (also in the Higgsfield library). 60.0 s, 1280×720, spoken dialogue plus music and effects, captions burned in.
- **How it was made:**
  - 7 keyframes from Seedream 5.0 Flash; Maya and Grandma Rose are kept consistent by using the first image as a reference.
  - Each keyframe was animated into an 8-second shot with sound by Google Veo 3.1 Lite.
  - The shots were joined in Higgsfield's sandbox with a 4-second end card; the captions are timed to the speech, checked by transcribing the audio.
- **Cost:** 88 Higgsfield credits, against an approved limit of 125.
  - Keyframes, including one redo: 4 credits.
  - Seven shots at 12 credits each: 84 credits.
  - Kling v3.0, the first choice, needs a paid Higgsfield plan, so Veo 3.1 Lite was used instead.
- **Scene 2:** redone so Grandma Rose holds the photo facing herself (Fred's feedback).
