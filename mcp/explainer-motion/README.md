# Explainer Motion MCP

An MCP server that gives Claude a motion-graphics studio for YouTube explainer videos. It turns your voiceover into animated 1920×1080 boards (charts, diagrams, comparisons and kinetic type) that are synced word by word and rendered frame-exact to MP4.

It packages the workflow from Sirio's video *How to Make YouTube Explainer Videos With Claude* and the 74 boards from his MIT-licensed repo [sirioberati/YouTube-AI-Motion-Graphics](https://github.com/sirioberati/YouTube-AI-Motion-Graphics). It runs as a server, so customers connect to it instead of downloading the files.

## What Claude gets

| Tool | What it does |
|---|---|
| `search_boards` | Finds the board for a spoken line ("X vs Y and the winner is" → Versus cards) |
| `match_script` | Suggests boards for every line of a script at once |
| `list_boards` / `get_board` | Lists the 74 board templates and returns a template's HTML to adapt |
| `get_guide` | Design system: tokens, layout, motion, charts, components, brief and sync rules |
| `get_checks` / `add_check` | Your DO/DON'T rules. Every correction is saved so it isn't repeated |
| `save_board` | Writes a new or adapted board into the work folder |
| `preview_frame` | Returns a PNG of any board at any second so Claude can check it |
| `transcribe` | Word-level timestamps with faster-whisper |
| `write_timeline` | Validates and saves which board plays when (flags overlaps, gaps and boards that stay up too long) |
| `render_video` / `render_status` | Background, frame-exact MP4 render with your voice; resumable MKV parts and a frame-count check |

Prompts: `explainer_video` (voiceover → finished video) and `restyle_library` (rebuild the boards in your own style from your references).

## Install

You need Python 3.10+, FFmpeg and Chromium (via Playwright).

```bash
cd mcp/explainer-motion
python3 -m venv .venv
.venv/bin/pip install -e ".[whisper]"
.venv/bin/playwright install chromium
```

Connect it to Claude Code (run from your video project folder):

```bash
claude mcp add explainer-motion -e EXPLAINER_WORKDIR="$PWD" -- /path/to/Landmark1/mcp/explainer-motion/.venv/bin/explainer-motion
```

Or in Claude Desktop's `claude_desktop_config.json`:

```json
{ "mcpServers": { "explainer-motion": {
  "command": "/path/to/Landmark1/mcp/explainer-motion/.venv/bin/explainer-motion",
  "env": { "EXPLAINER_WORKDIR": "/path/to/my-video" } } } }
```

Then ask: *"Use the explainer_video prompt on voice.wav."*

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `EXPLAINER_WORKDIR` | current folder | The only folder the tools read audio from and write boards, timelines and videos to |
| `EXPLAINER_LIBRARY` | `./library` | Board library. Point it at your restyled copy to make the look yours |
| `EXPLAINER_CHECKS` | `<library>/checks.md` | Rules file that `add_check` writes to |
| `EXPLAINER_CHROMIUM` | Playwright's browser | Path to a Chrome/Chromium binary |
| `EXPLAINER_MCP_TOKENS` | (none) | Comma-separated bearer tokens for HTTP mode |

## Selling access (hosted mode)

```bash
EXPLAINER_MCP_TOKENS="tok_customer1,tok_customer2" explainer-motion --http --host 0.0.0.0 --port 8000
```

Customers add `https://your-host/mcp` as a remote MCP server and send `Authorization: Bearer <their token>`. Requests without a valid token get a 401. Before charging money for this, put it behind HTTPS and give each customer their own `EXPLAINER_WORKDIR`, because one process shares a single work folder. Rendering uses a lot of CPU, so size the server for it, or have customers run renders locally.

## Make it yours

The boards ship in a plain "Clean minimal" theme on purpose. Run the `restyle_library` prompt with your references folder, or edit `library/skills/explainer-board-system/references/tokens.md` and `assets/brand.css`. Keep your restyled library in its own folder and point `EXPLAINER_LIBRARY` at it. That library is what you're selling.

## Tests

```bash
.venv/bin/pip install -e ".[test]"
EXPLAINER_CHROMIUM=$(which chromium) .venv/bin/pytest -q tests
```

## Credits

The board library, design system, skills and prompts in `library/` are © 2026 TEIN AI (Sirio Berati), MIT License (`library/LICENSE`). The renderer in `explainer_motion/render.py` is adapted from that repo's `tools/export.py`.
