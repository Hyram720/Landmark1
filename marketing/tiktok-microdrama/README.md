# AI Micro-Drama TikTok Channel — Research & Playbook

Research date: 2 Nov 2026
Source video: **"Micro Dramas Made $11B. Make One a Day With Claude (Full Workflow)"** by Andy Lo
https://www.youtube.com/watch?v=nkv2LINrwxE (published 31 Oct 2026, 11:53 long; about 5.7K views and 126 likes when checked)

---

## 1. The channel: Andy Lo (@andylokcl)

| | |
|---|---|
| Handle | https://www.youtube.com/@andylokcl |
| Subscribers | ~95.2K |
| Videos | 351 |
| Who | Co-founder of Proxa, an AI automation agency. Sells "AndyNoCode" (Skool community: free tier, AI Video Lab, Premium) |
| Format | 8–15 min tutorials: his own cloned voice plus real footage of him, lip-synced with AI. Every prompt is shown on screen so you can pause and copy it |
| Business model | YouTube → free community → paid "workflow pack" (prompts, skills, templates) → premium/1-on-1. Affiliate links (HeyGen, n8n, Apify) |

### What does well on his channel (last ~5 months)

| Views | Video | What it tells you |
|---|---|---|
| 70K | Claude Opus 5.5 Is Insane for Educational Animations | "Model X is insane for Y" titles get the most views |
| 56K | The Only Claude Code Real Estate Ad Workflow You Need | Niche + "the only … you need" |
| 51K | How I Automated UGC Ad Creation With Claude and Higgsfield | Automating content that makes money |
| 42K | Everything Claude Code + Remotion Can Do in 2026 | Complete breakdown of one tool |
| 39K | Remotion vs HyperFrames | Head-to-head comparisons |
| 22K | 9 Insane Claude Opus 5.5 Prompts [FREE] | Lists plus "free" |
| 20K | Automated 30 Days of AI Influencer TikToks With One Prompt | **Closest to your goal:** batch TikTok content |
| 5.6K | Micro Dramas Made $11B… (this video) | Only 1–2 days old when checked, so it is still growing |

Low performers (<1K–2K views) were general news and reviews (Meta Muse, a Lofi factory). **Takeaway:** his audience wants a *workflow that ends in money or content they can post*, not news.

### What the comments say (useful to you)
Only 4 comments so far. Two complained that the skill costs money and the video tools are expensive, and one said "every mouth is the same in these animations." That gives you two openings:
1. **Free or cheap is a selling point.** Anyone who shows the whole workflow for free, or proves it costs under $3 an episode, has a hook.
2. **Viewers notice AI flaws** (same-looking mouths and faces). Character consistency and lip-sync quality are what keep people watching.

---

## 2. What the video teaches (the full workflow)

### The market (as Andy cites it)
- One AI-made drama got **100M views in 12 hours** (source: Xinhua).
- Vertical micro-dramas made **about $11B last year** (source: Omdia).
- On apps like **ReelShort**, the first episodes are free. At the cliffhanger the next one is locked and you pay to keep watching.
- **TikTok now has a dedicated Short Drama tab.** One free show there has 150M+ views.
- US viewers now spend **about 36 min a day in short-drama apps vs 25 min on Netflix**.
- **The catch:** about 220K AI dramas came out on Douyin in the first half of the year, and **fewer than 1 in 200 passed 100M views**. Making a drama is easy now. Making one people want to watch is the hard part.
- Sophia Xing (Plot Party studio): people won't become fans of AI *actors*, but they will follow AI *characters* if the story is good.

### The core rule
> Images cost cents and video costs dollars, **so never make any video until the storyboard is right.**

### Part 1: The idea
1. Open the Claude app, go to the **Code** tab, and make **one folder per show** so Claude can find everything again each day.
2. Start with a small idea and **have Claude ask you questions first**: genre, tone, places, audience, and episode length. Your answers are your taste, and that is what makes the show yours.
3. No idea yet? Look at the **TikTok Short Drama tab**. It sorts shows by genre (revenge, secret identity, second chance), so you can see what is popular now.
4. Claude saves your answers as a **show brief** and plans a **5-episode season**. Each episode opens with a hook and ends on a cliffhanger. Then it writes Episode 1 as a shot-by-shot script.

### Part 2: The 5 story rules (Claude checks every episode against them)
1. **Question first.** Open on a moment that makes people ask "why?" and hold back the answer.
2. **Make us care.** Early on, show the lead doing something good or fair and being punished for it.
3. **The viewer knows more.** Show a danger the character can't see. A bomb you see under the table holds people for minutes. A hidden one only gives a few seconds of shock.
4. **Every beat changes direction.** Each moment turns things good→bad or bad→good. Link beats with "but" or "so," never "then."
5. **Payoff, then reopen.** Give people the win they hoped for, then raise a bigger question and stop. That is where Chinese studios usually put the paywall.

Claude shows a pass/fail table for each beat and rewrites only the parts that fail. **Spend most of your time on Episode 1**, because that is where you win or lose the viewer.

### Part 3: Production setup (done once per show)
- **One film look in every prompt.** Andy's look: early-2000s film, warm golden window light, soft greens.
- **Reference sheets** for every person, place and prop. *If something appears twice, it gets its own sheet.*
  - Character sheet: front view, back view, and a face close-up on plain grey. Hide the face in the full-body shot so the video model only ever sees one face.
  - Give every character **one detail nobody else has** (a red ribbon, a gold key necklace).
  - Places stay empty. Important props get their own close-up.
- He makes images with **Codex** (included in his ChatGPT plan, so no extra cost). The **fal** key is for video only and lives in a settings file, never in the chat.
- **An "episode" skill:** an instruction file Claude reads every time. It holds the story check, shot rules, prompt format, and **two checkpoints**: wait for storyboard approval, then show the price and wait for approval before any video.
- **A show-notes file:** what has happened, who knows what, and who owns which prop. Claude reads it before each episode and updates it after, so even by Episode 9 it remembers who knows the secret.

### The daily loop ("Make episode N")
1. **Script → shot list:** 13 shots, each with one action, one line and a length.
2. **Storyboard:** one image per shot built from the sheets, all on one page like a film studio board (image, camera move, action, line). **This is the most important review of the day.** Fixing an image is free; fixing a video costs money.
3. **Shots:** each approved image becomes a **5-second shot with one movement**, prompted as *one continuous take, no cuts* so the model doesn't add its own cuts.
4. **Price check:** Claude shows the plan and cost first. 13 shots at 720p cost **about $2.81**.
5. **Edit:** cut to the storyboard, show each character's name the first time they appear, place captions above TikTok's buttons for people watching on mute, freeze the last frame in black and white, update show notes, and list the few sound effects to add by hand.
6. **Post:** put the episode number in the post and turn on the **AI-generated label**.

### Models and cost (fal list prices, 30 Oct 2026)
- **FLUX 3 Max** image-to-video with lip-synced dialogue: about **$0.0425/sec at 720p**. That is a **sale price that ends 7 Nov 2026**.
- **Seedance 2.5** (on fal or Dreamina) cost about **6.5× more** and rejected his face sheets. Starting from the storyboard image worked.
- **Budget tip:** use the best model you can afford on Episode 1 to hook people, then a cheaper model for later episodes. Keep the same sheets and film look so the switch is hard to notice.

### 5 production rules for a real-show look
1. **Plan first, one event per shot.** He tried four story moments per 12-second clip and the model chose its own cuts.
2. **Name everyone in the shot and add "and no one else,"** or a stranger may walk in.
3. **Write the lines exactly and add "spoken in English exactly as written."**
4. **Give Claude the previous image as a reference** when it draws the next, so people and props stay in place.
5. **Fix only what's broken.** If 2 seconds are wrong, remake just those 2 seconds.

### Making money (from the video)
1. **Grow free:** post to TikTok, Shorts and Reels in a **playlist**, with every episode pointing to the next.
2. **Sell the next episode:** **TikTok Series** lets creators with **10K+ followers** put videos behind a paywall at a price they choose.
3. **Make branded series:** Crocs × ReelShort did a 5-episode drama and reported **7.8M views in 3 weeks**. With this workflow you can show a brand the full storyboard before they pay for a single shot.

---

## 3. Your TikTok channel plan

### Positioning: pick one of two lanes
| Lane | What you post | Who it's for | Money |
|---|---|---|---|
| **A. The drama channel** (recommended) | A daily AI micro-drama series, 60–90 s episodes | Drama viewers (huge audience) | TikTok Series paywall at 10K followers, Creator Rewards, brand series |
| **B. The "how I make it" channel** (Andy's model) | Behind-the-scenes clips showing how each episode is made | Creators and AI hobbyists | Sell your own workflow pack or templates, affiliate links |

**Best of both:** run Lane A as the main account. Every 5th post, or on a second account, post a "how this episode cost $2.81" clip (Lane B). Andy's own numbers show that workflow and cost reveals are what pull views in the creator crowd.

### Genre choice
Start with what the TikTok Short Drama tab already shows is popular:
- **Revenge / underdog** (the cleaner falsely accused, which is Andy's example)
- **Secret identity** (the billionaire heir working as a waiter)
- **Second chance** (rebirth or time-reset)

Tip: pick a genre that **fits your brand.** For example, a pet-themed or small-business revenge story could feature your products as props, which turns into the branded-series angle later.

### Episode format (TikTok-optimized)
- **Length:** 60–90 s (about 13 shots × 5 s)
- **0–2 s:** the "question first" hook. Start on the most shocking line, not the setup.
- **Captions** above the bottom ~20% of the frame (TikTok's buttons cover it)
- **Name card** the first time each character appears
- **Last frame:** freeze in black and white with "Part N+1 → [follow]"
- **Post caption:** `EP 3 | [Show Name] 🔥 #shortdrama #aidrama #minidrama #[genre]`
- **Always turn on the AI-generated content label** (TikTok requires it for realistic AI content)
- Put every episode in a **TikTok Playlist** named after the show, and pin Episode 1

### Posting cadence
- **Week 0 (setup):** brief, season outline, look, reference sheets, episode skill (one-time work, about 1 day)
- **Daily:** one episode (about 1–2 hours of your review time plus ~$3 of video)
- **Season = 5 episodes.** Look at the numbers after each season: Ep 1 → Ep 2 retention, follows per episode, and comments asking for the next part.

### Budget
| Item | Cost |
|---|---|
| Claude (Pro/Max) | your existing plan |
| Images (Codex on a ChatGPT plan, or any image model) | $0 extra if you already pay |
| Video, FLUX 3 Max at 720p | about $3 per episode at sale price (check after 7 Nov 2026) |
| **A 5-episode season** | **about $15–25** |

### Growth milestones
1. **0 → 1K followers:** daily episodes, reply to comments with the next episode
2. **1K → 10K:** cross-post the same episodes to YouTube Shorts and Reels, and post behind-the-scenes clips
3. **10K+:** turn on **TikTok Series** and paywall Episodes 4–5 at the "payoff, then reopen" cliffhanger
4. **Proof of traction:** pitch brands a 5-episode branded series, using a storyboard as the pitch deck

---

## 4. Starter kit in this folder

| File | What it is |
|---|---|
| `story-rules.md` | The 5 story rules, written as a checklist Claude can run |
| `.claude/skills/episode/SKILL.md` | The daily "Make episode N" skill with both approval checkpoints |
| `templates/show-brief.md` | Fill-in template for the show brief |
| `templates/show-notes.md` | Running memory: who knows what, who owns which prop |
| `templates/character-sheet-prompt.md` | Prompt template for reference sheets |
| `templates/kickoff-prompt.md` | The first prompt to paste into Claude to start a new show |

**How to use:** copy this folder into its own project folder, open it in the Claude app's **Code** tab, paste `templates/kickoff-prompt.md`, and answer Claude's questions. After setup, every day you just type **"Make episode N."**

> These files are my own write-up based on what the video describes. They are not Andy's paid workflow pack. His full pack is in the AndyNoCode community (https://www.andynocode.com).
