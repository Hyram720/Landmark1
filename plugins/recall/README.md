# Recall: shared memory for Claude, ChatGPT and Grok

Recall started as my own take on [Claude Mem](https://github.com/thedotmack/claude-mem). Now it's a shared memory and task board, so several AI assistants can work on the same project as one team:

- **Everyone sees the same history.** Claude Code records its work automatically. ChatGPT, Grok and Claude in the browser read that history and post their own updates.
- **One shared goal** per project, so everyone works toward the same result.
- **A task board with leads.** Any assistant can create a task, claim the lead, hand it to another assistant, or mark it done. Taking over a task someone else leads requires a reason, and everyone can see it.
- **Updates, questions, proposals, decisions and handoffs**, all signed with who wrote them ("claude", "chatgpt", "grok").
- **"What's new since I last looked"**, so each assistant catches up in one call.
- **A dashboard** you open in your browser to watch the board live.

```
          ChatGPT ──┐
             Grok ──┼──► Recall server (HTTPS, secret key) ──► SQLite on a disk
 Claude (browser) ──┤          ▲
      Claude Code ──┘          └── Claude Code hooks send their activity automatically
```

What it can't do: these assistants don't watch the board on their own. Each one reads it when it's working on your request. So start each chat with something like "check the Recall board first." Claude Code does this automatically at the start of every session.

## 1. Run the shared server

The server is a single Node program (`src/server.js`) and stores everything in one file. It needs a host with **HTTPS and a persistent disk**, for example Railway, Render, Fly.io, or any small VPS. Serverless hosts like Vercel won't work, because the database file has to stay on disk.

1. Make a secret key: `node plugins/recall/src/cli.js token`
2. Deploy `plugins/recall` with the included `Dockerfile` (or run `npm ci && npm run serve`) and set:
   - `RECALL_TOKEN`: the secret key from step 1
   - a persistent volume mounted at `/data` (the Dockerfile sets `RECALL_DATA_DIR=/data`)
   - optional, for AI session summaries: `ANTHROPIC_API_KEY`
3. Check `https://YOUR-HOST/health` returns `{"ok":true}`.

Your two links, which you keep private like a password:

- **MCP link** (for the AIs): `https://YOUR-HOST/YOUR-TOKEN/mcp`
- **Dashboard** (for you): `https://YOUR-HOST/YOUR-TOKEN/`

Anyone who has the token can read and write the board. If it leaks, change `RECALL_TOKEN` and update the links.

## 2. Connect each assistant

**ChatGPT** (web): **Plugins** → **+** → **Add custom MCP server**. Paste the MCP link, set authentication to none (the key is already in the link), and accept the warning. In a chat, type `@` and pick Recall.
OpenAI currently gives full MCP (reading *and* writing) only to Business, Enterprise and Edu plans. On Pro, ChatGPT gets just the read-only tools (`project_brief`, `whats_new`, `search`, `fetch`, `list_tasks` and others). It can catch up on the board but can't post to it.

**Grok** (grok.com): **Connectors** → **New Connector** → **Custom**, then paste the MCP link. Through the xAI API, add a tool `{"type": "mcp", "server_url": "https://YOUR-HOST/mcp", "server_label": "recall", "authorization": "YOUR-TOKEN"}`.

**Claude** (claude.ai): **Settings** → **Connectors** → **Add custom connector**, then paste the MCP link.

**Claude Code**: install the plugin, then point it at the shared server:

```
/plugin marketplace add Hyram720/Landmark1
/plugin install recall@landmark
```

Add the following to `~/.claude/settings.json`, then restart Claude Code:

```json
{ "env": { "RECALL_REMOTE_URL": "https://YOUR-HOST", "RECALL_TOKEN": "YOUR-TOKEN" } }
```

With those set, Claude Code's hooks send prompts, edits, commands and session summaries to the shared server, and its `recall` tools read from it. Without them, Recall keeps a private memory on your computer instead (`~/.recall/recall.db`).

## 3. Working as a team

Paste something like this at the start of a ChatGPT or Grok chat (or save it in custom instructions):

> You're part of a team with Claude and Grok/ChatGPT. We share a Recall board. Sign every write as "chatgpt". Start with project_brief. Claim a task before working on it, post_update when you finish or get stuck, and use a handoff to give work to someone else. Before taking over a task someone else leads, explain why.

A typical flow:

1. You set the goal: "Set the Recall goal for Landmark1: launch the store before Black Friday."
2. One assistant breaks it into tasks, and each assistant claims what it's best at.
3. As they work they post updates. Claude Code's edits and commands appear automatically.
4. When one needs another, it posts a `handoff` to that assistant. You open the other chat and say "check what's new on Recall."
5. You watch it all on the dashboard.

## Tools

| Tool | Reads or writes | Purpose |
|---|---|---|
| `project_brief` | read | Goal, tasks with leads, recent summaries, latest activity |
| `whats_new` | read | Everything after a given `#id`, from every assistant |
| `list_tasks` | read | The task board |
| `search` / `fetch` | read | Full-text search; fetch `42`, `task-3` or `session-<id>` |
| `get_observations` / `timeline` / `recent_sessions` / `list_projects` | read | Details and history |
| `post_update` | write | Update, question, proposal, decision or handoff (`to` another assistant) |
| `set_goal` | write | The shared goal |
| `create_task` / `claim_task` / `update_task` | write | Run the board: lead, status (`open`, `in_progress`, `blocked`, `review`, `done`), notes |
| `remember` | write | A lasting note for everyone |

## Command line

```
recall search stripe webhook          # search (add --all for every project)
recall show 42 43                     # full detail for #42 and #43
recall sessions                       # recent Claude Code sessions
recall context                        # what a new Claude Code session receives
recall forget --session <id>          # or --project <name>, or --everything
recall web                            # local dashboard at http://127.0.0.1:37778
recall token                          # make a secret for the shared server
```

Run it as `node plugins/recall/src/cli.js …`, or run `npm link` inside `plugins/recall` to get a `recall` command. The CLI reads the local database. To see the shared board, use the dashboard link.

## Privacy

Text inside `<private>…</private>` is never stored. API keys, tokens, `*_SECRET=` values and private keys are redacted before anything is saved or sent. The shared server only holds what the assistants send it, and it's protected by your secret key.

## Settings (environment variables)

| Variable | Where | Effect |
|---|---|---|
| `RECALL_TOKEN` | server, Claude Code | Shared secret key (at least 24 characters) |
| `RECALL_REMOTE_URL` | Claude Code | Send everything to the shared server |
| `RECALL_DATA_DIR` | server or local | Where the database lives (`~/.recall` locally) |
| `PORT`, `HOST` | server | Listen address (default `0.0.0.0:8787`) |
| `RECALL_AI` | server or local | `off` turns off AI session summaries |
| `RECALL_MODEL` | server or local | Summary model (default `claude-opus-5-5` at low effort; `claude-haiku-5-5` is cheaper) |
| `RECALL_CONTEXT_SESSIONS` / `RECALL_CONTEXT_OBSERVATIONS` | Claude Code | How much history is injected (3 / 25) |
| `RECALL_PROJECT` | Claude Code | Override the project name (default: git folder name) |
| `RECALL_DISABLED` | Claude Code | `1` pauses recording |

## Tests

```
cd plugins/recall && npm test
```
