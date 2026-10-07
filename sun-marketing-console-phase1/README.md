# Sun Marketing Console — patch series (Phase 1, 1b, 2 part 1, 3 part 1)

The Sun Marketing Console code lives in **`Hyram720/sun-marketing-console`**. This session could read that repository but did not have permission to push to it, so the Phase 1 work is delivered here as a `git am`-ready patch series. It applies cleanly on top of `767753c` ("Add no-cost Opportunity Radar qualification (#50)"); the resulting tree was verified to be identical to the tested working copy.

| Patch | Contents |
|---|---|
| `0001-Phase-1-multi-tenant-core-CRM-and-AI-Command-Center-.patch` | Migration, SQL security tests, tenant framework, CRM, AI operator, API routes, UI pages, unit tests |
| `0002-Add-architecture-roadmap-schema-API-security-and-imp.patch` | `docs/architecture/*` (the same six documents are also in this repository's [`docs/architecture/`](../docs/architecture/MASTER_ARCHITECTURE.md)) |
| `0003-Phase-1b-hardening-SSRF-pinning-rate-limits-roles-wo.patch` | Security hardening (SSRF connect-time pinning, shared rate limits, settings roles and allow-list, scoped agent-worker token, HSTS), the follow-up scheduler fix, GitHub Actions CI, docs status update |
| `0004-Phase-2-part-1-communications-foundation-and-unified.patch` | Phase 2 messaging: provider accounts (Telnyx, Twilio, Resend), compliance gate, unified inbox with scheduling, verified webhooks with STOP/START, AI messaging tools, Conversations and Channels pages |
| `0005-Phase-3-part-1-reputation-calendars-automations-dele.patch` | Phase 3: Reputation (reviews, reply drafts, health score, non-gated review requests), Calendars (round robin, public booking, reminders, reschedule/cancel links), Automations (event-triggered versioned workflows, templates, AI drafting, run logs), AI tools for all three, and deleting CRM contacts |

## Apply

```bash
git clone https://github.com/Hyram720/sun-marketing-console
cd sun-marketing-console
git checkout -b claude/happy-wright-tyr5b2 767753c
git am /path/to/Landmark1/sun-marketing-console-phase1/patches/*.patch
npm install
npm run typecheck && npm test && npm run build
npm run test:db      # optional: needs local PostgreSQL 15+
git push -u origin claude/happy-wright-tyr5b2   # then open a PR
```

If `main` has moved past `767753c`, run `git rebase main` after `git am`.

## Verified in this session

- `tsc --noEmit`: clean
- `vitest`: 156/156 passing (Phase 3: time zones and DST, availability with buffers/notice/limits, round robin, health score, CSV import, workflow validation and matching, the automation engine with quiet-hour retries, stop conditions and leases, booking conflicts, safe contact matching for online bookings). Before Phase 3: 128/128 (Phase 1 logic and operator engine; network guard; compliance gate incl. quiet hours across time zones; Telnyx/Twilio signature verification; send, failover, scheduling and dispatch re-checks; inbound STOP and replay handling; AI messages still gated after approval)
- SQL security suite: 134/134 passing (Phase 3 adds 49: event outbox integrity, bulk-import suppression, review immutability and no-gating responses, double-booking prevention, appointment status rules, manager-only activation of immutable workflow versions, run controls, contact deletion keeping opt-outs). Previously 85/85 on PostgreSQL 16 with a Supabase stand-in (Phase 1 plus credential column privacy, number ownership, message status machine, forged inbound/receipts, opt-out functions, webhook idempotency)
- `next build`: succeeds (the pre-existing `middleware` → `proxy` deprecation warning remains)
- Against a running production build: worker token reaches only its endpoints (wrong token → 401, with a clear error in the real worker script); scheduler endpoint accepts only `AUTOMATION_SECRET`
- Browser smoke test (Chromium, desktop and mobile): passcode login; tenant pages show the team-sign-in state; tenant APIs return 401 without a user session; cross-site POSTs are rejected; signed-in screens rendered with fixture API data and no page errors

Deploy notes for patch 0005: apply the Phase 3 migration (enables `btree_gist`); no new environment variables. The scheduler now also calls `/api/jobs/tick` (IMPLEMENTATION_PLAN §2c). Reputation, Calendars, Automations, the public booking/review/appointment pages and contact deletion were checked in Chromium with fixture data at desktop and phone widths, with no page errors and no horizontal scrolling.

Deploy notes for patch 0004: apply the Phase 2 migration and set `APP_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `PUBLIC_APP_URL` (IMPLEMENTATION_PLAN §2b). Inbox and Channels screens were checked in Chromium with fixture data at desktop and phone widths.

**Not yet verified:** the signed-in flows and real provider sending against the live Supabase project and Telnyx/Twilio/Resend accounts, because the migrations have not been applied and no provider credentials were used. Follow `docs/architecture/IMPLEMENTATION_PLAN.md` §2 to deploy.

Deploy notes for patch 0003: set `AGENT_WORKER_TOKEN` on the host and `SUN_WORKER_TOKEN` in the worker's `.env.local` (then remove the passcode from it). The follow-up scheduler will start running for the first time (production currently has no queued follow-ups). The CI workflow needs no secrets.

Before deploying, read **SECURITY_PLAN S1**: the production `app_secret_ok()` function embeds the shared database secret as a literal, and it should be rotated (runbook in IMPLEMENTATION_PLAN §6).
