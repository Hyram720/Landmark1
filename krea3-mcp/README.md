# Krea 3 Studio: MCP server + skills for Claude, ChatGPT and Grok

One MCP server that gives an AI assistant a full image studio built around **Krea 3** (fast, precise image editing), blended with **Higgsfield** and **Kie.ai** for extra image models and video. It ships with five **skills** that teach the assistant how to use it well.

| Works with | How |
|---|---|
| Claude Code, Claude Desktop, Cursor, Codex | local server (stdio), can read and save files on your computer |
| Claude.ai, ChatGPT, Grok (xAI API) | hosted server (HTTP), added as a custom connector by URL |

## Tools

| Tool | What it does |
|---|---|
| `krea3_edit` | Full-control Krea 3 edit or text-to-image: up to 8 references, thinking modes, regional edits, bounding boxes, hex colors |
| `generate_image` | Same interface for `krea`, `higgsfield` or `kie`, any model id via `model` |
| `compare_providers` | Same prompt on all configured providers in parallel, side by side |
| `animate_image` | Image to video on Higgsfield (Kling O3 by default) or Kie |
| `pet_portrait` | 13 preset styles (royal, admiral, astronaut, watercolor, holiday, memorial, 16-bit, anime...), 1-4 variants, optional second pet or owner |
| `product_mockup` | Artwork on t-shirt, hoodie, throw blanket, canvas, mug, phone case, tote, framed poster; one image per colorway |
| `ad_format_pack` | One hero image re-framed for Instagram, Stories/TikTok, Facebook, Pinterest, Etsy, banner, YouTube |
| `krea3_batch` | Up to 8 different Krea 3 edits at once |
| `get_job` | Status and results of any job on any provider |
| `upload_image` | Host an image once, reuse the URL everywhere |
| `estimate_cost` | Free offline Krea 3 price estimate for 1 to 1,000,000 edits |
| `list_providers` | Which keys are set, known models, all presets |

It also has 3 prompt templates (`pet_portrait`, `product_listing_set`, `model_shootout`) and a `krea3://presets` resource.

Every tool waits for the result, returns the image URL and shows the image inline. Locally you can also pass `image_paths` and `save_dir`.

## Skills

| Skill | Teaches |
|---|---|
| `krea3-image-editing` | Prompt structure, thinking modes, regional edits, bounding boxes, cost control |
| `pet-portrait-studio` | Photo checklist, styles, likeness check and fixes, print sizes, memorials |
| `product-mockups` | Mockups, colorways, packshots, a full 10-photo listing set |
| `ad-creative-studio` | Placements, A/B variants, text in ads, short video ads |
| `multi-provider-blending` | When to use Krea vs Higgsfield vs Kie, comparisons, still-to-video pipelines |

Each one is a standard `SKILL.md`. `npm run package:skills` builds:
- `dist/claude/*.zip`: upload to Claude.ai.
- `dist/instructions/all-skills.md`: all five combined, for ChatGPT and Grok.
- `dist/instructions/<skill>.md`: one skill each.

## Keys

Copy `.env.example`. Only `KREA_API_KEY` is required. Add Higgsfield and/or Kie to unlock their models.

| Variable | Where to get it |
|---|---|
| `KREA_API_KEY` | https://www.krea.ai/app/api |
| `HIGGSFIELD_API_KEY_ID`, `HIGGSFIELD_API_KEY_SECRET` | https://console.higgsfield.ai |
| `KIE_API_KEY` | https://kie.ai/api-key |
| `MCP_AUTH_TOKEN` | Hosted mode only: any long random string. Protects your credits. |

```bash
npm install
```

```bash
npm test
```

---

## Claude

### Claude Code

```bash
claude mcp add krea3-studio -e KREA_API_KEY=your_key -e KIE_API_KEY=your_key -- node /full/path/to/krea3-mcp/src/index.js
```

Skills: copy the folders into your personal or project skills folder.

```bash
cp -r skills/* ~/.claude/skills/
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart:

```json
{
  "mcpServers": {
    "krea3-studio": {
      "command": "node",
      "args": ["/full/path/to/krea3-mcp/src/index.js"],
      "env": {
        "KREA_API_KEY": "your_key",
        "HIGGSFIELD_API_KEY_ID": "",
        "HIGGSFIELD_API_KEY_SECRET": "",
        "KIE_API_KEY": ""
      }
    }
  }
}
```

### Claude.ai (web and mobile)

1. Host the server (see **Hosting** below).
2. Add a custom connector under Settings > Connectors with the URL `https://YOUR-HOST/mcp/YOUR_MCP_AUTH_TOKEN`.
3. Upload each `dist/claude/*.zip` under Settings > Capabilities > Skills.

## ChatGPT

1. Host the server.
2. Turn on developer mode (Settings > Apps & Connectors > Advanced), then create a connector.
   - URL: `https://YOUR-HOST/mcp/YOUR_MCP_AUTH_TOKEN`
   - Authentication: none. The token in the URL protects it.
3. Teach it the skills: in a Project or a custom GPT, upload `dist/instructions/all-skills.md` as a file. Add one line to the instructions: "Follow all-skills.md when using the krea3-studio tools."
4. **Codex CLI:** add the server to `~/.codex/config.toml`, then copy `skills/*` into `~/.codex/skills/`.

```toml
[mcp_servers.krea3-studio]
command = "node"
args = ["/full/path/to/krea3-mcp/src/index.js"]
env = { KREA_API_KEY = "your_key" }
```

## Grok

**grok.com:**
1. Open grok.com/connectors > New Connector > Custom.
2. Enter `https://YOUR-HOST/mcp/YOUR_MCP_AUTH_TOKEN`. On Business and Enterprise plans, an admin adds it in the xAI console first.
3. Teach it the skills: upload `dist/instructions/all-skills.md` to a Grok Project as a file or its instructions.

**Grok Build (CLI):** add the hosted server, or run it locally over stdio.

```bash
grok mcp add --transport http krea3-studio https://YOUR-HOST/mcp/YOUR_MCP_AUTH_TOKEN
```

**xAI API:** pass the server as a remote MCP tool on `POST https://api.x.ai/v1/responses`. Put the skill text in the system message:

```json
{
  "model": "YOUR_GROK_MODEL",
  "input": [
    { "role": "system", "content": "<contents of dist/instructions/all-skills.md>" },
    { "role": "user", "content": "Make my dog a royal portrait: https://example.com/dog.jpg" }
  ],
  "tools": [
    { "type": "mcp", "server_label": "krea3-studio", "server_url": "https://YOUR-HOST/mcp", "authorization": "YOUR_MCP_AUTH_TOKEN" }
  ]
}
```

The server accepts `Authorization: Bearer <token>`, `?key=<token>`, or `/mcp/<token>`. Use whichever form your Grok client supports.

---

## Hosting (for Claude.ai, ChatGPT and Grok)

Any Node 20+ host works: Railway, Render, Fly.io or a VPS.

- Root directory: `krea3-mcp`
- Start command: `npm run http` (listens on `PORT`, default 8787)
- Environment: your API keys plus `MCP_AUTH_TOKEN`
- Check: `https://YOUR-HOST/health` shows which providers are configured

The hosted server is stateless (Streamable HTTP, JSON responses). Local-file options (`image_paths`, `save_dir`, upload by path) are switched off in hosted mode. Users send image URLs or attachments instead.

> Keep `MCP_AUTH_TOKEN` secret. Anyone with the full URL can spend your Krea, Higgsfield and Kie credits.

## Costs

- **Krea 3:** $0.03 (1K) or $0.06 (2K) per image.
  - Each reference image adds $0.02 (about 1 megapixel) or $0.07 (2K and larger).
  - `high` mode adds $0.02; `ultra` adds $0.20 (Max plan only).
  - `estimate_cost` does the math.
- **Higgsfield and Kie:** credits per model; video is usually priced per second. Check their dashboards before big batches.

## Notes

- Krea also runs its own general MCP server at `https://api.krea.ai/mcp` (OAuth sign-in, all Krea models). This server is the Krea 3-focused studio: API-key auth, presets, comparisons, Higgsfield and Kie blending, and inline results. The skills work with either.
- Model endpoints were checked against each provider's docs on 2026-11-02:
  - Krea: `/generate/image/krea/krea-3`
  - Higgsfield: Soul 2, Qwen Image 3 edit, Kling O3 and Omni image-reference
  - Kie: `nano-banana-pro`, `google/nano-banana`
  - Any other documented model works through `model` plus `extra`.
- `npm test` runs end-to-end tests against fake versions of all three APIs, over both stdio and HTTP. No keys or credits needed.
