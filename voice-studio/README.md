# Sun Voice Studio

A personal voice studio that runs on your own computer. It does four jobs:

1. **Live voice agents**: talk out loud, in real time, with AI agents powered by Phonic-1 (a speech-to-speech model). You can interrupt them like a real phone call. Embed one in Sun Marketing Console as a "talk to us" widget.
2. **Bot voices**: Sun Marketing Console bots ask the studio for speech and get audio back.
3. **Reader**: opens books and documents (EPUB, PDF, TXT, HTML) and reads them aloud. It highlights each paragraph as it goes and saves your place.
4. **Narration**: turns a script into one voice-over file plus a matching captions file (SRT) for your video editor.

## Set up (one time, about 5 minutes)

You need [Node.js 20 or newer](https://nodejs.org).

```bash
cd voice-studio
```

```bash
npm install
```

```bash
cp .env.example .env
```

Open `.env` and paste your OpenAI key after `OPENAI_API_KEY=`. Then start it:

```bash
npm start
```

Open **http://localhost:5055** in your browser.

With no key, the studio runs in **test mode**: every screen works, but it plays tones instead of speech. The Reader can also use your computer's built-in voices for free, offline, with no key at all.

## Live voice agents (Phonic-1)

1. Sign up at [phonic.ai](https://phonic.ai) and create an API key.
2. Add it to `.env` as `PHONIC_API_KEY=...` and restart (`npm start`).
3. Open the **Live Agent** tab, pick an agent, click **Start talking** and allow the microphone.

Three agents are set up to start: **Sun Marketing Receptionist**, **Sales Follow-up** and **Practice Partner**. Edit their voice (39 to choose from, including Southern, British and Spanish accents), greeting, response timing and personality in the same tab.

Headphones give the most natural conversation. Without them, the agent can hear itself through your speakers.

**Put an agent on another page:** each agent has a ready-made embed code (in the Live Agent tab, under "Put this agent on another page"). It's a small page at `/talk.html?agent=<agent id>`.

Your Phonic key stays on your computer: the browser only ever gets a short-lived pass (a session token) for each call.

## What it costs

Studio voices use OpenAI's speech model, which costs roughly **$0.015 per 1,000 characters** (check current pricing). For scale:
- A 300-page novel is about 600,000 characters, so roughly $9 to read the whole book once
- A 60-second video narration is about 900 characters, so about 1–2 cents
- A bot greeting is a fraction of a cent, and **repeats are free** because the studio saves every clip and reuses it whenever the same text and voice come up again

The free "computer voices" in the Reader cost nothing.

Live agent calls are billed by Phonic per minute of conversation, from about **$0.07 a minute** according to their docs (check current pricing), so a 5-minute practice call is about 35¢.

## Voices

The **Voices** tab is where you make named voices: pick a base voice, a speed, and "delivery notes" that describe how it should sound, like "friendly Southern accent, relaxed, smiles while talking". Four voices are set up to start: Narrator, Support Bot, Sales Bot and Book Reader. Each voice has an **ID**, which is what your bots use.

## Connecting Sun Marketing Console bots

The **Bot API** tab inside the app shows copy-paste examples with your real voice IDs. The short version:

```
GET  http://localhost:5055/api/tts?profile=support-bot&text=Hello!
```

The reply is an MP3. Or `POST /api/tts` with JSON `{ "profile": "support-bot", "text": "Hello!" }`. Add `"json": 1` to get back a link to the audio instead of the audio itself.

If the console runs on a different machine than the studio, set `VOICE_API_KEY` in `.env` and send it as the `x-api-key` header.

## Narration script format

```
Narrator: Every great brand starts with a story.
Sales Bot: And ours starts today!

Thanks for watching.
```

- Each line becomes one caption.
- Start a line with a voice name and a colon to switch voices. Lines without a name use the default voice.
- A blank line adds a longer pause.

## Files

- `data/audio/`: every clip made (safe to delete to free space)
- `data/profiles.json`: your voices
- `data/history.json`: recent clips list

Run `npm test` to check everything works (uses test mode, costs nothing).
