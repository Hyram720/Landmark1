# Product Roadmap

Principle: **stable foundations before breadth.** Each phase ships behind the same tenancy, RBAC, audit and AI-governance foundation from Phase 1. A phase is done only when its exit criteria hold in production. Every module also exposes its actions as AI operator tools, so the Command Center gains abilities as the platform grows.

## Phase overview

| Phase | Theme | Lifecycle stage | Status |
|---|---|---|---|
| 1 | Core architecture, multi-tenancy, CRM, auth, AI Command Center foundation | Convert | **Implemented** (pending deploy) |
| 1b | Hardening: baseline schema, secret rotation, MFA, CI, JWKS | — | **In progress** (part 1 implemented) |
| 2 | Communications: unified inbox, SMS/email/voice provider layer, AI voice agents | Convert | **In progress** (messaging foundation implemented; voice next) |
| 3 | Reputation & Trust Center, calendars, workflow automation | Protect · Convert | **Part 1 implemented** (reviews, booking, automations; platform sync next) |
| 4 | Lead generation engine, audits at scale, AI prospecting | Acquire | Planned |
| 5 | Websites, funnels, forms, landing pages, knowledge base | Acquire | Planned |
| 6 | Billing, white-label SaaS, agency rebilling, plans and limits | — | Planned |
| 7 | Analytics, attribution, AI revenue intelligence, ads | Retain · Acquire | Planned |
| 8 | Marketplace, advanced autonomous agents, affiliates | — | Planned |

---

## Phase 1: Foundation ✅ implemented

**Goal:** a business can sign in, work a real CRM, and direct an AI operator that is permissioned and audited, with tenant isolation enforced by the database.

Delivered:
- Organizations (agency → client), locations, memberships, five-role RBAC, suspension semantics
- Unified CRM: contacts, companies, pipelines and stages, deals, tasks, notes, consent ledger, activity timeline, custom field definitions, explainable lead scoring
- AI Command Center: conversational operator with 11 tools (5 read, 6 write), per-category permissions (Observe / Recommend / Ask approval / Act automatically), approval queue, recommendations, audit trail
- Supabase Auth sessions with refresh, tenant routing, CSRF and validation framework
- Privacy: erasure, do-not-contact, sensitive-entry redaction from the AI
- 54 database security tests and 25 unit tests

Exit criteria (verify after deploy):
- [ ] Migration applied to production; the security advisor shows no new findings
- [ ] Owner account bootstrapped; agency created; legacy prospects imported
- [ ] One client sub-account created with its own owner, and isolation verified by signing in as that owner
- [ ] Command Center answers pipeline questions and queues changes for approval with the OpenAI key configured

## Phase 1b: Hardening (1–2 weeks)

- Capture the live schema as a baseline migration (`supabase db pull`); remove drift
- **Rotate `APP_DB_SECRET`**, remove the literal from `app_secret_ok()` (store it in Vault or a GUC), and split the credential-encryption key into `APP_ENCRYPTION_KEY` (see SECURITY_PLAN S1/S2)
- Introduce `SUPABASE_SERVICE_ROLE_KEY` for schedulers and workers; stop using the shared secret for new work
- MFA (TOTP) for owner and admin roles; require `aal2` on admin actions
- Local JWT verification (JWKS) in middleware; remove per-request network calls
- ESLint + Prettier + GitHub Actions (typecheck, unit, SQL tests, build)
- Email invitations for members (Supabase `inviteUserByEmail` via the service role)
- Sentry (or equivalent) error monitoring; structured logging with `organization_id`

## Phase 2: Communications

**Part 1 implemented (patch 0004):** per-organization provider accounts (Telnyx, Twilio, Resend) with credentials sealed by `APP_ENCRYPTION_KEY`; the compliance gate (consent, opt-outs, quiet hours, do-not-contact, marketing opt-out text) on every send; failover between numbers; unified inbox with scheduling; verified Telnyx/Twilio webhooks for replies, delivery receipts and STOP/START; scheduled dispatch that re-checks the rules at send time; AI tools `list_conversations`, `get_conversation`, `send_message` under the Messages permission.

**Remaining:** AI voice agents and calls (2.7), outbox/queue workers (2.8), migration of `email_contacts`/`studio_contacts`/`interactions` (2.8), web chat and WhatsApp, 10DLC registry UI, and the navigation restructure (2.9).

**Goal:** every conversation with a customer, on any channel, lands in one inbox and one timeline, and is sent through swappable providers under consent rules.

- `provider_accounts` (encrypted, per org with agency defaults), `phone_numbers`, `messaging_profiles` (10DLC brand/campaign registry)
- **Messaging layer:** SMS/MMS (Telnyx primary, Plivo, Twilio fallback), email (Resend, SES/Postmark), web chat widget, WhatsApp when available; router by price, region, health and delivery rate
- **Unified inbox:** `conversations`, `messages`, assignment, snooze, templates, scheduling, AI-drafted replies (operator tool: `draft_reply`, `send_message` under the `messaging` policy)
- **Compliance engine:** consent check before every send, quiet hours by recipient timezone, opt-out keywords on every provider, frequency caps, content checks
- **AI voice:** `voice_agents` (provider per agent: ElevenLabs, Cartesia, OpenAI), `calls` (duration, cost, sentiment, transcript, outcome), inbound receptionist, missed-call text-back, after-hours, transfers, voicemail, callback scheduling; migrate Vapi receptionist configs
- Domain events outbox + queue workers; retire the Netlify cron
- Migrate `email_contacts`, `studio_contacts` and `interactions` into `contacts` and `activities`
- Navigation restructure to the target IA (Dashboard, AI Command Center, CRM, Conversations, Calls, Calendar, Campaigns, Automations, Reputation, Websites, Lead Finder, Analytics, Payments, AI Agents, Settings), with legacy tools grouped under "Agency tools"

## Phase 3: Reputation, calendars, workflows

**Part 1 implemented (patch 0005):**
- **Reputation:** review sites, reviews recorded by hand or imported from CSV, reply drafts (people or the AI) that a person posts and marks as posted, status (new / acknowledged / resolved), negative reviews open a high-priority task automatically, and an explained 0–100 Reputation Health Score.
- **Review requests:** sent by text or email through the compliance gate, at most once per customer every 30 days. The public request page always shows every review site; private feedback is offered alongside them, never instead of them (no gating). Ratings of 3 or lower create a follow-up task.
- **Calendars:** personal, round-robin and resource calendars with working hours, buffers, minimum notice, horizon and daily limits. The database blocks double booking. Includes public booking pages with recorded SMS consent, a manage link for the customer to reschedule or cancel, confirmations and reminders 1–24 hours ahead, and an agenda with confirm, complete, no-show, reschedule and cancel.
- **Automations:** versioned, immutable workflow definitions triggered by domain events (new contact, tag, lifecycle stage, deal stage, inbound message, appointment booked, cancelled, completed or no-show, review, private feedback). Steps: wait, text, email, task, tags, stage, note, review request, stop-if (replied, booked, tag, stage) and signed webhook. Four templates. "Describe it in English" proposes a draft that a person reviews and saves; only managers switch versions on. Runs are leased (safe with two schedulers) and logged per step.
- **AI tools:** `reputation_summary`, `list_reviews`, `draft_review_reply`, `request_review`, `list_calendars`, `check_availability`, `list_appointments`, `book_appointment`, `cancel_appointment`, `list_automations` and `draft_automation`, plus a new **Appointments** AI permission (default: approve).

**Remaining:**
- Google Business Profile and Facebook review sync, with posting replies through the API.
- Google and Microsoft calendar sync, waitlists and territories.
- QR review cards, review widgets and testimonials, competitor comparison, and reputation trend snapshots.
- Branching (if/else) workflow graphs; AI-call, payment, form and missed-call triggers, which arrive with their modules.
- A queue faster than the 15-minute scheduler.

- **Reputation & Trust Center:** Google Business Profile review ingestion (and Facebook where permitted), review requests by SMS, email and QR, AI responses with approval or auto policy, negative-review alerts, complaint escalation into tasks, recovery workflows, widgets and testimonials, competitor comparison, trend charts
- **Reputation Health Score** (0–100): weighted average rating, volume, 90-day velocity, negative frequency, response rate and speed, sentiment, unresolved complaints, trend. Factors are stored and explained like lead scores
- Private feedback routes unhappy customers to resolution **without hiding the public review option** (no review gating)
- **Calendars:** individual, round-robin, team, service and location calendars; Google and Microsoft sync; booking pages; reminders; reschedule and cancel; waitlists; no-show recovery; buffers; working hours; territories. Availability and booking exposed as AI and voice tools
- **Workflow automation:** versioned workflow graphs; triggers on domain events (new lead, form, call, missed call, message, appointment states, stage change, payment, review, inactivity, tag, webhook, schedule); actions (send SMS/email, AI call, assign, move stage, create task, request review, book, update CRM, generate document, webhook, notify, start/stop agent or campaign). "Describe it in English" builds a draft workflow that runs only after approval

## Phase 4: Lead generation engine

- Tenant-scoped Lead Finder built on Opportunity Radar + `lib/audit.ts`
- Filters: industry, geography, website quality, review score and count, missing site, speed, SEO, broken links, SSL, mobile, booking, chat, AI receptionist, reputation, social activity
- **Opportunity Score** with explained factors; automated audits (website, SEO, reputation, conversion, missed-call risk, automation opportunities)
- Personalized outreach generated from audits, sent only on compliant channels: email to business addresses with CAN-SPAM footer; no cold SMS or robocalls without consent

## Phase 5: Websites and funnels

- Multi-tenant hosted sites and funnels (Puck-based editor), templates by industry, forms, surveys, quizzes, appointment and thank-you pages, SEO metadata, A/B variants
- "Build me a website for a roofing company": the AI asks only essential questions, then drafts structure, copy, forms, CTAs and SEO for approval
- **Knowledge base:** versioned, approval-gated entries (services, pricing, hours, FAQs, policies, scripts, brand voice) consumed by every agent through retrieval

## Phase 6: SaaS business layer

- Plans, feature packages, limits and metering (`usage_events`), Stripe Billing behind a payments abstraction
- Agency rebilling with markup on usage (messages, minutes, AI tokens), client invoices, estimates, deposits, payment links, refunds
- White-label: custom domains, branding, sender domains, branded login, client onboarding wizard, account transfer, suspension, data export

## Phase 7: Analytics and attribution

- Metrics store (daily rollups per org), dashboards that answer questions, AI analyst tools over metrics
- Meta Ads and Google Ads integration; spend, CPL, cost per appointment and customer, ROAS
- First- and last-touch attribution with a touchpoint model ready for multi-touch

## Phase 8: Marketplace and autonomy

- Installable agents, workflows, funnels, templates and industry modules; creator payouts
- Affiliate and referral system (links, tracking, commission rules, recurring commissions, payouts, fraud signals); agencies sell subscriptions through it
- Long-running autonomous agents with goals, budgets and schedules, still bounded by policy, approvals and audit

## Industry modules (delivered progressively from Phase 3)

Roofing, solar, life insurance, real estate, home services, monuments/headstones, HVAC, plumbing, landscaping, dentists, attorneys, med spas, restaurants and automotive services each ship as a bundle: pipeline stages, forms, website template, receptionist script, qualification questions, follow-up sequence, review campaign and dashboard. Bundles install through `seed_organization_defaults`-style provisioning functions.
