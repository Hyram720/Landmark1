---
name: episode
description: Make the next episode of the micro-drama show in this folder. Use when the user says "make episode N" or asks for a new episode, storyboard, or shots.
---

# Make an episode

## Before writing anything, read:
- `show-brief.md` (genre, tone, audience, film look, episode length)
- `season-outline.md` (what this episode must do)
- `show-notes.md` (what has happened, who knows what, who owns which prop)
- `story-rules.md`
- every file in `sheets/` (reference images for characters, places and props)

## Step 1: Script
Write the episode as a shot-by-shot script for **about 13 shots of 5 seconds each** (60–90 s total).
Each shot has exactly **one action, at most one line of dialogue, and a length**.
Open on the strongest, most "why?" moment. End on a cliffhanger.

## Step 2: Story check
Check the script against `story-rules.md`. Show a table of beats × rules (✅/❌ plus a note).
Rewrite only the beats that fail, then show the table again.

## Step 3: Storyboard (images only, no video yet)
- Draw one vertical 9:16 image per shot, using the reference sheets for every person, place and prop in it.
- Give the **previous shot's image** as an extra reference so people and props stay in place.
- Put the film look from `show-brief.md` in every image prompt.
- Put everything on one page, `episodes/epNN/storyboard.html`, with image, camera move, action and line for each shot.
- Check every face against its sheet. Redraw only the images that are off.

### ⛔ CHECKPOINT 1: Stop. Ask the user to approve the storyboard. Don't continue until they say yes.

## Step 4: Shot plan and price
For each shot, write the video prompt in this format:

```
[Film look]. One continuous take, no cuts, 5 seconds.
In frame: <NAME A> and <NAME B>, and no one else.
Camera: <one movement, e.g. slow push-in>.
Action: <one action>.
Dialogue: <NAME A> says "<exact line>", spoken in English exactly as written.
```

Use the approved storyboard image as the starting frame (image-to-video).
Show a table: shot, model, resolution, seconds, and cost, plus the **total price**.

### ⛔ CHECKPOINT 2: Stop. Show the total price and wait for the user to approve before making any video.

## Step 5: Make the shots
- Read the API key from the settings or env file. Never print it or put it in the chat.
- Make each shot. If only part of a shot is wrong, remake **just that part** as a short new clip, not the whole scene.

## Step 6: Edit
- Cut in storyboard order to 9:16 (1080×1920).
- Show a name card the first time each character appears.
- Burn in captions **above the bottom 20%** of the frame (TikTok's buttons cover it).
- Freeze the last frame in black and white and add "Part N+1 →".
- Save to `episodes/epNN/final.mp4`.
- List the sound effects or music the user should add by hand.

## Step 7: Wrap up
- Update `show-notes.md`: what happened, who now knows what, and prop owners.
- Write the TikTok caption: `EP N | <Show Name> <hook line> #shortdrama #aidrama #minidrama #<genre>`.
- Remind the user to **turn on TikTok's AI-generated content label** and add the post to the show playlist.
