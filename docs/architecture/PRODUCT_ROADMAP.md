# Product Roadmap

Principle: **stable foundations before breadth.** Each phase ships behind the same tenancy, RBAC, audit and AI-governance foundation from Phase 1. A phase is done only when its exit criteria hold in production. Every module also exposes its actions as AI operator tools, so the Command Center gains abilities as the platform grows.

## Phase overview

| Phase | Theme | Lifecycle stage | Status |
|---|---|---|---|
| 1 | Core architecture, multi-tenancy, CRM, auth, AI Command Center foundation | Convert | **Implemented** (pending deploy) |
| 1b | Hardening: baseline schema, secret rotation, MFA, CI, JWKS | — | **In progress** (part 1 implemented) |
| 2 | Communications: unified inbox, SMS/email/voice provider layer, AI voice agents | Convert | **In progress** (messaging foundation implemented; voice next) |
| 3 | Reputation & Trust Center, calendars, workflow automation | Protect · Convert | **Part 1 implemented** (reviews, booking, automations; platform sync next) |
| 4 | Lead generation engine, audits at scale, AI prospecting | Acquire | **Part 1 implemented** (Lead Finder, Opportunity Score, compliant email outreach) |
| 5 | Websites, funnels, forms, landing pages, knowledge base | Acquire | **Part 1 implemented** (hosted sites, forms, knowledge base) |
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

**Part 1 implemented (patch 0006):**
- **Lead Finder:** each organization keeps its own prospect list. Search the free OpenStreetMap directory (shared with the legacy Opportunity Radar), add businesses by hand, filter, and delete.
- **Audits at scale:** queued audits run two at a time while the page is open and three per scheduler tick in the background.
- **Each audit** uses the existing website audit, now with online-booking detection, plus email discovery on the business's own site (business addresses only, never freemail).
- **Opportunity Score** (0–100), explained factor by factor: no website, website, mobile, speed and search scores, SSL warning, online booking, chat, reputation (when known) and independence. Signals that have not been checked earn nothing rather than being guessed.
- **Email outreach:**
  - One-to-one business email drafted from the audit's strongest verifiable finding, edited and sent by a person.
  - Every send adds a CAN-SPAM footer: sender, postal address, "marketing message" line and an unsubscribe link, plus RFC 8058 one-click unsubscribe headers.
  - Limits: 3 emails per business, 3 days apart, and a daily organization limit (default 40).
  - Unsubscribing suppresses the address organization-wide and flags the business do-not-contact.
  - There is no texting or calling of prospects.
- **Convert to CRM** creates a company and contact (lifecycle: prospect) with the score reasons as a note.
- **AI tools:**
  - `find_businesses`, `audit_prospects` and `convert_prospect`, under the CRM permission.
  - `list_prospects` and `get_prospect` (read-only).
  - `draft_outreach`, under the Outreach permission (formerly Campaigns, default: recommend). It only ever creates drafts.

**Remaining:**
- Paid data providers (Google Places ratings and reviews, Yelp) behind an adapter.
- Social-activity and AI-receptionist signals, and broken-link checks.
- Reply detection through inbound email.
- Multi-step outreach sequences with automatic stop on reply.
- Shareable report cards per prospect, reusing the legacy report pages.

- Tenant-scoped Lead Finder built on Opportunity Radar + `lib/audit.ts`
- Filters: industry, geography, website quality, review score and count, missing site, speed, SEO, broken links, SSL, mobile, booking, chat, AI receptionist, reputation, social activity
- **Opportunity Score** with explained factors; automated audits (website, SEO, reputation, conversion, missed-call risk, automation opportunities)
- Personalized outreach generated from audits, sent only on compliant channels: email to business addresses with CAN-SPAM footer; no cold SMS or robocalls without consent

## Phase 5: Websites and funnels

**Part 1 implemented (patch 0007):**
- **Forms:** a builder (field types, required, maps to contact fields, select choices, tag, task, thank-you message or redirect) and hosted pages at `/f/<link>`, also embeddable in site pages.
  - Optional text and marketing-email consent boxes record consent with the exact wording, page, time and hashed IP.
  - Every submission becomes or updates a contact, lands on the timeline, opens a follow-up task and emits `form.submitted`, a new automation trigger that can be filtered by form.
  - Spam protection: a honeypot field and per-IP rate limits.
- **Hosted websites** at `/s/<site>`:
  - Built with the existing visual editor (Puck), with a section library for live sites: hero with a working call button, services, story, process, FAQ, gallery, lead form, online booking and footer.
  - Seven industry templates that make no claims the owner would have to prove. Optionally, AI-written copy that uses only approved knowledge.
  - Multi-page sites, a title and search description per page, and saved drafts that never change the live site. Only managers publish, and publishing copies the exact draft.
  - Saved pages are validated: known sections only, hex colors, and https, relative or anchor links.
- **Knowledge base:** versioned facts (services, pricing, hours, FAQs, policies, scripts, brand voice). Members draft and managers approve. Editing an approved item sends it back for approval. Full-text search returns approved items only.
- **AI tools:**
  - `search_knowledge` (read-only). The operator is told to state business facts only from approved knowledge.
  - `add_knowledge`, which creates drafts only.
  - `list_forms_and_sites` (read-only).

**Remaining:**
- Custom domains (Phase 6 white-label).
- Surveys and quizzes, A/B variants, funnels with multiple steps.
- Image uploads to storage (sites use image URLs today).
- Vector search for the knowledge base.
- Page analytics.

- Multi-tenant hosted sites and funnels (Puck-based editor), templates by industry, forms, surveys, quizzes, appointment and thank-you pages, SEO metadata, A/B variants
- "Build me a website for a roofing company": the AI asks only essential questions, then drafts structure, copy, forms, CTAs and SEO for approval
- **Knowledge base:** versioned, approval-gated entries (services, pricing, hours, FAQs, policies, scripts, brand voice) consumed by every agent through retrieval

## Phase 6: SaaS business layer

**Part 1 implemented (patch 0008):**
- **Security fix:** client admins can no longer change their own plan or status or move their account to another agency; agencies govern their clients through a checked database function.
- **Plans and limits:** platform and agency-defined plans with monthly limits (texts, emails, AI requests, outreach) and totals (contacts, team members, websites). Usage is metered and limits are enforced by the database, so no code path can skip them. Agencies assign plans and suspend or reactivate client accounts.
- **Invoices and estimates:** line items, tax, deposits, due dates and notes. The customer gets a branded link to pay by card or accept/decline an estimate. Accepted estimates become invoices. Cash and check payments can be recorded; card payments can be refunded.
- **Payments** go into each business's own Stripe account (Checkout), confirmed by a signed webhook per account. The platform never holds client money.
- **Custom domains** for hosted sites, proven with a DNS TXT record.
- **Branding** (name, logo, color, support contacts) on customer pages, and a **full data export** that works even while suspended.
- **AI tools:** `invoice_summary`, `usage_summary` (read-only).

**Remaining:**

- Platform subscription billing of agencies (Stripe Billing) and feature packages
- Agency rebilling with markup on usage (messages, minutes, AI tokens)
- White-label: sender domains, branded login, client onboarding wizard, account transfer, automatic domain certificates through the host's API

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
