# Sun Marketing Console — patch series (Phase 1, 1b, 2 part 1, 3 part 1, 4 part 1, 5 part 1, 6)

The Sun Marketing Console code lives in **`Hyram720/sun-marketing-console`**. This session could read that repository but did not have permission to push to it, so the Phase 1 work is delivered here as a `git am`-ready patch series. It applies cleanly on top of `767753c` ("Add no-cost Opportunity Radar qualification (#50)"); the resulting tree was verified to be identical to the tested working copy.

| Patch | Contents |
|---|---|
| `0001-Phase-1-multi-tenant-core-CRM-and-AI-Command-Center-.patch` | Migration, SQL security tests, tenant framework, CRM, AI operator, API routes, UI pages, unit tests |
| `0002-Add-architecture-roadmap-schema-API-security-and-imp.patch` | `docs/architecture/*` (the same six documents are also in this repository's [`docs/architecture/`](../docs/architecture/MASTER_ARCHITECTURE.md)) |
| `0003-Phase-1b-hardening-SSRF-pinning-rate-limits-roles-wo.patch` | Security hardening (SSRF connect-time pinning, shared rate limits, settings roles and allow-list, scoped agent-worker token, HSTS), the follow-up scheduler fix, GitHub Actions CI, docs status update |
| `0004-Phase-2-part-1-communications-foundation-and-unified.patch` | Phase 2 messaging: provider accounts (Telnyx, Twilio, Resend), compliance gate, unified inbox with scheduling, verified webhooks with STOP/START, AI messaging tools, Conversations and Channels pages |
| `0005-Phase-3-part-1-reputation-calendars-automations-dele.patch` | Phase 3: Reputation (reviews, reply drafts, health score, non-gated review requests), Calendars (round robin, public booking, reminders, reschedule/cancel links), Automations (event-triggered versioned workflows, templates, AI drafting, run logs), AI tools for all three, and deleting CRM contacts |
| `0006-Phase-4-part-1-Lead-Finder-with-Opportunity-Score-an.patch` | Phase 4: Lead Finder (tenant prospect lists, audits at scale with business-email discovery, explained Opportunity Score, CAN-SPAM email outreach with one-click unsubscribe and limits, convert to CRM, AI tools) |
| `0007-Phase-5-part-1-hosted-websites-forms-and-knowledge-b.patch` | Phase 5: hosted websites on the visual editor (industry templates, AI copy from approved knowledge, manager-only publishing of exact drafts), forms with consent capture and a form-submitted automation trigger, approval-gated knowledge base used by the AI |
| `0008-Phase-6-part-1-plans-and-usage-limits-invoices-and-p.patch` | Phase 6: security fix for organization governance, plans with database-enforced usage limits and agency client management, invoices and estimates paid into each business's own Stripe account (webhooks, refunds), custom domains for sites, branding, full data export |
| `0009-Phase-6-part-2-agency-subscriptions-client-rebilling.patch` | Phase 6 part 2: agency subscriptions to the platform (Stripe Billing), client rebilling as draft invoices, email invitations, guided client setup, consent-based account transfer, white-label sign-in domains, automatic Netlify domain aliases |
| `0010-Home-dashboard-and-simpler-navigation.patch` | Home dashboard (today's numbers, what needs attention, schedule, tasks, unanswered conversations, newest leads, setup checklist); menu grouped by job and filtered by account type and role, classic console tools collapsed for staff only; phone bottom bar with a "More" sheet; signed-in users land on Home |

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
- `vitest`: 203/203 passing (the home dashboard adds attention ordering, time-zone day bounds and greetings). Before: 200/200 (Phase 6 part 2 adds rebilling lines and monthly invoicing, subscription state handling, Netlify aliases, the invitation join flow). Before part 2: 188/188 (Phase 6 adds invoice totals and deposits, plan input, domain validation and DNS verification, Stripe webhook handling). Before Phase 6: 180/180 (Phase 5 adds form validation and submission handling, site template and page-content validation). Before Phase 5: 172/172 (Phase 4 adds Opportunity Score, business-email selection, outreach send rules and footer, audit and drafting flows). Before Phase 4: 156/156 (Phase 3: time zones and DST, availability with buffers/notice/limits, round robin, health score, CSV import, workflow validation and matching, the automation engine with quiet-hour retries, stop conditions and leases, booking conflicts, safe contact matching for online bookings). Before Phase 3: 128/128 (Phase 1 logic and operator engine; network guard; compliance gate incl. quiet hours across time zones; Telnyx/Twilio signature verification; send, failover, scheduling and dispatch re-checks; inbound STOP and replay handling; AI messages still gated after approval)
- SQL security suite: 247/247 passing (Phase 6 part 2 adds 40: agency plan limits, server-only subscriptions, rebilling isolation, invitation tokens and email matching, transfer consent, console-domain verification). Before part 2: 207/207 (Phase 6 adds 30: locked organization columns, agency-only governance, limits and metering, invoice totals and transitions, payment rules, credential privacy, server-only domain verification). Before Phase 6: 177/177 (Phase 5 adds 22: forged submissions, form timeline/events, manager-only exact-draft publishing, knowledge approval). Before Phase 5: 155/155 (Phase 4 adds 21: prospect isolation, outreach state machine, unreadable unsubscribe tokens, unsubscribe suppression, do-not-contact enforcement). Before Phase 4: 134/134 (Phase 3 adds 49: event outbox integrity, bulk-import suppression, review immutability and no-gating responses, double-booking prevention, appointment status rules, manager-only activation of immutable workflow versions, run controls, contact deletion keeping opt-outs). Previously 85/85 on PostgreSQL 16 with a Supabase stand-in (Phase 1 plus credential column privacy, number ownership, message status machine, forged inbound/receipts, opt-out functions, webhook idempotency)
- `next build`: succeeds (the pre-existing `middleware` → `proxy` deprecation warning remains)
- Against a running production build: worker token reaches only its endpoints (wrong token → 401, with a clear error in the real worker script); scheduler endpoint accepts only `AUTOMATION_SECRET`
- Browser smoke test (Chromium, desktop and mobile): passcode login; tenant pages show the team-sign-in state; tenant APIs return 401 without a user session; cross-site POSTs are rejected; signed-in screens rendered with fixture API data and no page errors

Deploy notes for patch 0010: no migration or settings. Team users now land on **Home**; platform staff still land on the classic dashboard and find the classic tools under "Classic console". Home and the new menus were checked in Chromium at desktop and phone widths with fixture data, with no page errors and no horizontal scrolling.

Deploy notes for patch 0009: apply the Phase 6 part 2 migration; optional new variables `PLATFORM_FROM_EMAIL`, `STRIPE_PLATFORM_WEBHOOK_SECRET`, `NETLIFY_API_TOKEN`, `NETLIFY_SITE_ID` (IMPLEMENTATION_PLAN §2g). The Agency page, invitations, guided setup, invitation acceptance, client transfers and the branded sign-in page were checked in Chromium with fixture data at desktop and phone widths, with no page errors and no horizontal scrolling. Real Stripe subscriptions, invitation emails and the Netlify API were not exercised (no keys in this session); their logic is covered by unit tests.

Deploy notes for patch 0008: apply the Phase 6 migration (it contains a security fix); no new environment variables. Accounts start on the unlimited `internal` plan until an agency assigns one. Use a Stripe test key first (IMPLEMENTATION_PLAN §2f). Invoices, the customer invoice and estimate pages, Plan & account and the domain setup card were checked in Chromium with fixture data at desktop and phone widths, with no page errors and no horizontal scrolling. Real Stripe payments and DNS lookups were not exercised (no keys or domain in this session); webhook handling and verification logic are covered by unit tests.

Deploy notes for patch 0007: apply the Phase 5 migration; no new environment variables (IMPLEMENTATION_PLAN §2e). Knowledge, Forms, Websites, the site editor and the hosted form were checked in Chromium with fixture data at desktop and phone widths, with no page errors. Live `/s/` pages read from the database on the server and were not exercised without a Supabase project.

Deploy notes for patch 0006: apply the Phase 4 migration; set the outreach sender name and postal address in Lead Finder before sending (IMPLEMENTATION_PLAN §2d). Checked in Chromium with fixture data at desktop and phone widths, with no page errors.

Deploy notes for patch 0005: apply the Phase 3 migration (enables `btree_gist`); no new environment variables. The scheduler now also calls `/api/jobs/tick` (IMPLEMENTATION_PLAN §2c). Reputation, Calendars, Automations, the public booking/review/appointment pages and contact deletion were checked in Chromium with fixture data at desktop and phone widths, with no page errors and no horizontal scrolling.

Deploy notes for patch 0004: apply the Phase 2 migration and set `APP_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `PUBLIC_APP_URL` (IMPLEMENTATION_PLAN §2b). Inbox and Channels screens were checked in Chromium with fixture data at desktop and phone widths.

**Not yet verified:** the signed-in flows and real provider sending against the live Supabase project and Telnyx/Twilio/Resend accounts, because the migrations have not been applied and no provider credentials were used. Follow `docs/architecture/IMPLEMENTATION_PLAN.md` §2 to deploy.

Deploy notes for patch 0003: set `AGENT_WORKER_TOKEN` on the host and `SUN_WORKER_TOKEN` in the worker's `.env.local` (then remove the passcode from it). The follow-up scheduler will start running for the first time (production currently has no queued follow-ups). The CI workflow needs no secrets.

Before deploying, read **SECURITY_PLAN S1**: the production `app_secret_ok()` function embeds the shared database secret as a literal, and it should be rotated (runbook in IMPLEMENTATION_PLAN §6).
