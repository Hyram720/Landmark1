# Universal AI Bridge: Claude, ChatGPT and Grok

One shared MCP server ("Recall") that Claude, ChatGPT and Grok all connect to, so they read and update the same project memory, task board and history. Status as of 2026-10-22.

## 1. Infrastructure audit (read-only)

**Railway** (account hyram720, workspace "hyram720's Projects"): 22 projects.

| Project | What's there | Relevant to the bridge |
|---|---|---|
| `recall` | Empty service, created 2026-10-22, no source, no deploys | **Reused: this is now the bridge's home** |
| `custom-pet-portrait-studio` | `web` from Landmark1 `main`, volume `orders-data` | No (live store, untouched) |
| `ledger-credit` | `ledger` from `claude/great-fermi-6rtocl`, volume | No |
| `watchdrop`, `gamedrop`, `shipcheck` | One service each from `claude/nifty-dijkstra-mokj91`, volumes | No |
| `playtest-triage` | One service, no source attached | No |
| `honest-reflection`, `independent-determination`, `thorough-charm`, `unique-victory` | `Landmark-Agency` from `Hyram720/Landmark-Agency` (four copies) | No (possible duplicates to clean up) |
| `suntree-license-webhook` | Bun function, 1 staged change | No |
| `kiyomi-telegram-bot` | Last deploy FAILED (July) | No |
| `telegram-voice-bot-pipecat` | Service staged for delete | No |
| `generous-balance`, `pure-freedom` | Only staged, never-applied services (Postgres/Redis/bucket in `pure-freedom`) | No |
| `zestful-reverence`, `respectful-purpose`, `diplomatic-connection`, `resourceful-alignment`, `terrific-harmony`, `vivacious-passion` | Empty | No |

**Supabase**: 11 projects; 3 active (`sunsite-hub`, `LegacyReady`, `resale-intelligence`). All are product databases (CRM, leads, legacy planning, resale). None holds MCP, memory or sync tables. Nothing was changed in them.

**GitHub** (`Hyram720/Landmark1`): branch `claude/admiring-mccarthy-1meogn` already contained **Recall** (`plugins/recall`), an MCP server built in an earlier session as a shared memory and task board for Claude, ChatGPT and Grok, with Claude Code hooks, a dashboard and 14 passing tests. It had never been deployed.

## 2. Reused vs. added

Reused as is: Recall's MCP endpoint (Streamable HTTP, JSON responses), the task board (claim, handoff, waiting-on-user), the activity feed, full-text search, session summaries, the Claude Code hooks, the dashboard, secret redaction, the Dockerfile, and the empty `recall` Railway project.

Added in this round (`plugins/recall`):

- **Project registry**: description, repository, stack, status, docs, goal, last updated, and a version per project (`get_project`, `update_project`).
- **Conflict detection**: projects and tasks carry versions; writes with a stale `expected_version` are refused with a conflict instead of overwriting.
- **Change history**: `project_history` (decisions, registry and task changes, handoffs, code changes, signed).
- **Per-assistant keys** (`RECALL_AGENT_TOKENS`): each assistant has its own key; writes are signed with the key's identity, so one assistant can't post as another; `:read` keys can only read; only the owner key opens the dashboard. Any single key can be revoked on its own.
- **Audit log**: every tool call on the server (who, tool, project, ok or failed); `audit_log` tool.
- **Ops**: `/health` checks the database; one access-log line per request on stdout (keys never logged); graceful shutdown.
- `scripts/verify-deployment.mjs`: runs Tests 1–4 against a live URL.

**Storage decision:** SQLite on a Railway volume, not Supabase. The bridge needs one small database that lives next to the server. Your Supabase projects are production databases for other products (and 8 of 11 are paused), so adding tables there would mix concerns and touch production. The code keeps storage behind one `Store` class if you want Postgres/Supabase later.

## 3. Architecture

```
 Claude (claude.ai / desktop) ──key in URL──┐
 ChatGPT (developer mode)     ──key in URL──┤
 Grok (grok.com connector)    ──key in URL──┼──► Recall MCP server (Railway, HTTPS)
 Grok (xAI API)               ──Bearer key──┤       ├─ key → identity, read/write check
 Claude Code (plugin + hooks) ──Bearer key──┘       ├─ tools: registry, tasks, history, search, audit
                                                    └─ SQLite on Railway volume /data
 You ──owner key──► dashboard (board, live feed, post on behalf of read-only assistants)
```

No assistant shares private reasoning; only what each one deliberately writes (and Claude Code's tool activity) is stored.

## 4. Railway deployment status

Configured on project `recall`, service `recall`, environment `production`:

- Source: `Hyram720/Landmark1`, branch `claude/sharp-pasteur-2ys7w8`, root `/plugins/recall`, Dockerfile build, redeploys on changes under `/plugins/recall`
- Volume `recall-data` mounted at `/data`
- Variables: `RECALL_TOKEN`, `RECALL_AGENT_TOKENS` (claude, claude-code, chatgpt, grok), `RECALL_AI=off`, `PORT=8787`
- Health check `/health`, restart on failure
- Public HTTPS domain: `https://recall-production-b649.up.railway.app`

**Live.** Deployment `1930a948` (commit `ee51071`) reached SUCCESS on 2026-10-22 20:50 UTC, in us-east4, during Railway's ongoing outage (status.railway.com still lists Hobby builds as limited). Verified:

- Deploy log: volume mounted, `Recall server listening on http://0.0.0.0:8787`, `Assistant keys: claude, claude-code, chatgpt, grok`
- External HTTPS check: `GET /health` → 200 `{"ok":true}`
- External HTTPS check: `GET /mcp` without a key → 401 `{"error":"unauthorized"}`

Earlier attempts: the first build failed because Railway rejects the Dockerfile `VOLUME` instruction (fixed in `50cfad5`); the second was stuck by the outage ("failed to fetch snapshot") and was replaced.

## 5. Connecting each assistant

The keys are in Railway: project **recall** → service **recall** → **Variables** → `RECALL_AGENT_TOKENS` (format `name=key,...`). Use each assistant's own key. Keep these links private.

- **Claude** (claude.ai or desktop): Settings → Connectors → Add custom connector → `https://recall-production-b649.up.railway.app/<claude key>/mcp`.
- **ChatGPT** (paid plan): Settings → Security and login → Developer mode on → chatgpt.com/plugins → + → custom MCP server → `https://recall-production-b649.up.railway.app/<chatgpt key>/mcp`, authentication none. Pick it with `@` in a chat. Business/Enterprise need an admin to allow developer mode. If only read tools appear, use the dashboard's "Post an update" box for its notes.
- **Grok** (grok.com, paid): grok.com/connectors → New Connector → Custom → `https://recall-production-b649.up.railway.app/<grok key>/mcp`. **xAI API:** tool `{"type":"mcp","server_url":"https://recall-production-b649.up.railway.app/mcp","server_label":"recall","authorization":"<grok key>"}`.
- **Claude Code**: `/plugin marketplace add Hyram720/Landmark1` (once this branch is merged), `/plugin install recall@landmark`, then in `~/.claude/settings.json`: `{"env":{"RECALL_REMOTE_URL":"https://recall-production-b649.up.railway.app","RECALL_TOKEN":"<claude-code key>"}}`.
- **Dashboard** (you): `https://recall-production-b649.up.railway.app/<RECALL_TOKEN>/`.

Opening line for any chat: "Check the Recall board first: call project_brief (and get_project) for <project>. Claim a task before working on it, pass expected_version when you change a record, and post_update when you finish or hand off."

## 6. Test results

| Test | Local run, same commit (HTTP, separate keys, each platform's auth style) | Live on Railway |
|---|---|---|
| Health | PASS | **PASS** (external HTTPS, 200 `{"ok":true}`) |
| Unauthenticated request refused | PASS | **PASS** (external HTTPS, 401) |
| All three connect (initialize, tools/list) | PASS | Not run* |
| TEST 1: Claude updates project record, ChatGPT retrieves it | PASS | Not run* |
| TEST 2: Grok updates a task, Claude retrieves it (stale write refused) | PASS | Not run* |
| TEST 3: ChatGPT retrieves development history | PASS | Not run* |
| TEST 4: all three see identical status, version and board | PASS | Not run* |
| A key can't sign as another assistant | PASS | Not run* |
| Unit/integration suite (`npm test`) | 21/21 PASS | n/a |

\* Authenticated calls to the live server couldn't be sent from the build environment: its network policy blocks `*.up.railway.app`, and sending keys through a third-party fetcher would leak them. Run the script below from your machine, or allow the domain in the cloud environment's network settings and ask Claude to run it.

The local runs exercise the server exactly as deployed, through HTTP with per-assistant keys, but the "ChatGPT", "Grok" and "Claude" callers are scripted clients using those assistants' keys, not the real apps. Proof that the real apps connect comes when you add the connectors (section 5).

To run the live check once the deploy is up:

```
RECALL_URL=https://recall-production-b649.up.railway.app \
RECALL_KEY_CLAUDE=… RECALL_KEY_CHATGPT=… RECALL_KEY_GROK=… \
node plugins/recall/scripts/verify-deployment.mjs
```

## 7. What still needs you

1. **Run the live test** (section 6), or allow `recall-production-b649.up.railway.app` in this cloud environment's network settings so Claude can run it. Railway is still in an outage, so later redeploys may be slow until it is resolved.
2. **Railway security incident:** Railway recommends rotating every secret stored in Railway variables (Stripe, OpenAI, Anthropic, Resend, Printful, database URLs, …) on your other services, and checking those providers for unexpected usage. See blog.railway.com/p/security-disclosure-wednesday-october-21st. Not done here (credential rotation needs your approval).
3. **Add the connectors** in Claude, ChatGPT and Grok (section 5). Those steps need your logins.
4. **Merge this branch** into `main` if you want the Claude Code plugin install to work from the marketplace. Railway currently deploys from the branch.
5. Optional: set `ANTHROPIC_API_KEY` and remove `RECALL_AI=off` for AI-written session summaries.
