# Recall: long-term memory for Claude Code

Recall is my own take on [Claude Mem](https://github.com/thedotmack/claude-mem). It's a Claude Code plugin that remembers what happened in earlier sessions on a project and gives Claude that history when a new session starts.

- **Captures automatically.** Hooks record your prompts and every tool Claude uses (edits, commands, searches, web lookups, task lists) as short observations.
- **Summarizes each session.** A free summary is written after every turn. When the session ends, an optional AI summary replaces it with a tighter one: what was asked, what got done, what was learned, and what's next.
- **Brings it back.** At the start of each session, the last few session summaries and recent activity for that project are added to Claude's context.
- **Searchable.** An MCP server gives Claude `search`, `timeline`, `get_observations`, `recent_sessions`, `session_summary` and `remember` tools. You get a CLI and a local web viewer.
- **Private by default.** Everything stays in a local SQLite file. Text inside `<private>…</private>` is never stored, and common secrets (API keys, tokens, `*_SECRET=` values, private keys) are redacted before saving.
- **No setup to run.** It uses Node's built-in `node:sqlite` with FTS5 full-text search. The only dependency is the Anthropic SDK, and you only need it for the optional AI summaries.

## Install

Requirements: Node.js 22.13 or newer, and Claude Code.

From Claude Code:

```
/plugin marketplace add Hyram720/Landmark1
/plugin install recall@landmark
```

Then restart Claude Code. Memory begins with your next session.

Optional, for AI summaries: install the SDK in the plugin folder and make Anthropic credentials available (`ANTHROPIC_API_KEY` or an `ant auth login` profile):

```
cd ~/.claude/plugins/marketplaces/landmark/plugins/recall && npm install
```

Without it, Recall still works and keeps the free summaries.

## How it works

```
SessionStart     → inject recent summaries + activity for this project
UserPromptSubmit → store the prompt
PostToolUse      → store a compact observation (title, detail, files)
Stop             → refresh the free summary for this session
SessionEnd       → mark the session ended; start the AI summary in the background
```

Data lives in `~/.recall/recall.db`. A *project* is the git root of the working directory, and memory is scoped per project. File reads and searches are stored and searchable, but they aren't injected, so the start-of-session context stays short.

## Command line

```
node plugins/recall/src/cli.js help
recall search stripe webhook          # search this project (add --all for every project)
recall show 42 43                     # full detail for observations #42 and #43
recall timeline 42                    # what happened around #42
recall sessions                       # recent sessions with summaries
recall context                        # preview what a new session will receive
recall summarize <session-id>         # run the AI summary now
recall forget --session <id>          # or --project <name>, or --everything
recall web                            # browse at http://127.0.0.1:37778
```

(`npm link` inside `plugins/recall` puts `recall` on your PATH.)

## Settings (environment variables)

| Variable | Default | Effect |
|---|---|---|
| `RECALL_DATA_DIR` | `~/.recall` | Where the database and log live |
| `RECALL_CONTEXT_SESSIONS` | `3` | Session summaries injected at start |
| `RECALL_CONTEXT_OBSERVATIONS` | `25` | Recent activity lines injected at start |
| `RECALL_AI` | on | Set to `off` to skip AI summaries |
| `RECALL_MODEL` | `claude-opus-5-5` | Model for AI summaries (runs at low effort). `claude-haiku-5-5` costs much less |
| `RECALL_PROJECT` | git root name | Override the project name |
| `RECALL_DISABLED` | unset | Set to `1` to pause all recording |

Errors go to `~/.recall/recall.log`. Hooks never block or break a session. If something fails, the hook logs it and exits cleanly.

## Differences from Claude Mem

- It has no background worker service or Chroma vector database. Search uses SQLite FTS5, with stemming and prefix matching.
- Observations are condensed by rules as they're recorded, so there's no AI call per tool use. Claude is called only once per session, for the summary.
- It runs on plain Node with nothing to build.

## Tests

```
cd plugins/recall && npm test
```
