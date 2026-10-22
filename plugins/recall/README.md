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

1. Make one secret key for you and one per assistant: run `node plugins/recall/src/cli.js token` once for each.
2. Deploy `plugins/recall` with the included `Dockerfile` (or run `npm ci && npm run serve`) and set:
   - `RECALL_TOKEN`: your owner key (full access, and the only key that opens the dashboard)
   - `RECALL_AGENT_TOKENS`: one key per assistant, e.g. `claude=KEY1,claude-code=KEY2,chatgpt=KEY3,grok=KEY4`. Add `:read` after a name (`chatgpt:read=KEY3`) to make that key read-only.
   - a persistent volume mounted at `/data` (the Dockerfile sets `RECALL_DATA_DIR=/data`)
   - optional, for AI session summaries: `ANTHROPIC_API_KEY` (otherwise set `RECALL_AI=off`)
3. Check `https://YOUR-HOST/health` returns `{"ok":true}`.
4. Run the cross-assistant checks: `RECALL_URL=https://YOUR-HOST RECALL_KEY_CLAUDE=… RECALL_KEY_CHATGPT=… RECALL_KEY_GROK=… node plugins/recall/scripts/verify-deployment.mjs`

Your links, which you keep private like passwords:

- **MCP link** for each assistant: `https://YOUR-HOST/THAT-ASSISTANTS-KEY/mcp`
- **Dashboard** (for you): `https://YOUR-HOST/YOUR-OWNER-KEY/`

An assistant key can only reach `/mcp` (and `/hook` for Claude Code). Everything it writes is signed with its own name, whatever name it claims, so one assistant can't post as another. If a key leaks, replace just that key in `RECALL_AGENT_TOKENS`.

## 2. Connect each assistant

**ChatGPT** (web, paid plans): turn on **Settings** → **Security and login** → **Developer mode**, then go to chatgpt.com/plugins → **+** → add a custom MCP server. Paste ChatGPT's MCP link, set authentication to none (the key is already in the link), and accept the warning. In a chat, type `@` and pick Recall. Developer mode gives read *and* write tools. On Business/Enterprise workspaces an admin must allow developer mode first. If your plan only shows the read-only tools (`project_brief`, `get_project`, `whats_new`, …), ask ChatGPT to end each reply with a short "For the board:" note and paste it into the dashboard's **Post an update** box with **chatgpt** selected.

**Grok** (grok.com, paid accounts): **grok.com/connectors** → **New Connector** → **Custom**, then paste Grok's MCP link. Through the xAI API (Responses API), add a tool `{"type": "mcp", "server_url": "https://YOUR-HOST/mcp", "server_label": "recall", "authorization": "GROKS-KEY"}`; xAI sends that as the Authorization header.

**Claude** (claude.ai or the desktop app): **Settings** → **Connectors** → **Add custom connector**, then paste Claude's MCP link.

**Claude Code**: install the plugin, then point it at the shared server:

```
/plugin marketplace add Hyram720/Landmark1
/plugin install recall@landmark
```

Add the following to `~/.claude/settings.json`, then restart Claude Code:

```json
{ "env": { "RECALL_REMOTE_URL": "https://YOUR-HOST", "RECALL_TOKEN": "CLAUDE-CODES-KEY" } }
```

With those set, Claude Code's hooks send prompts, edits, commands and session summaries to the shared server, and its `recall` tools read from it. Without them, Recall keeps a private memory on your computer instead (`~/.recall/recall.db`).

## 3. Working as a team

Paste something like this at the start of a ChatGPT or Grok chat (or save it in custom instructions):

For ChatGPT Pro (read-only), use this instead:

> You're part of a team with Claude and Grok. We share a Recall board you can read but not write. Start with project_brief and check whats_new before answering. End each reply with a short "For the board:" note (what you did or propose, and for which task), which I'll post for you.

For assistants that can write:

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
| `get_project` | read | Registry record: description, repo, stack, status, docs, goal, version, outstanding and completed tasks, decisions |
| `update_project` | write | Change registry fields; pass `expected_version` so a stale write is refused instead of overwriting |
| `project_history` | read | Change history: decisions, registry and task changes, handoffs, code changes, with who made each |
| `audit_log` | read | Every tool call on the shared server: who, what, when, success or failure |
| `whats_new` | read | Everything after a given `#id`, from every assistant |
| `list_tasks` | read | The task board |
| `search` / `fetch` | read | Full-text search; fetch `42`, `task-3` or `session-<id>` |
| `get_observations` / `timeline` / `recent_sessions` / `list_projects` | read | Details and history |
| `post_update` | write | Update, question, proposal, decision or handoff (`to` another assistant) |
| `set_goal` | write | The shared goal |
| `create_task` / `claim_task` / `update_task` | write | Run the board: lead, status (`open`, `in_progress`, `waiting_on_user`, `blocked`, `review`, `done`), notes. `expected_version` refuses stale writes |

### Conflicts

Projects and tasks carry a version number that goes up with every change. Read it (`get_project`, `list_tasks`), then pass it back as `expected_version` when you write. If another assistant changed the record in between, the write is refused with "Conflict: … is at version N", and the assistant re-reads, merges and retries. Nothing is silently overwritten.
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
| `RECALL_TOKEN` | server, Claude Code | Server: the owner key. Claude Code: the key it uses (its own `claude-code` key). At least 24 characters |
| `RECALL_AGENT_TOKENS` | server | Per-assistant keys, `name=key` or `name:read=key`, comma separated |
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
