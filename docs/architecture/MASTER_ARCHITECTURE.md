# Sun Marketing Console — Master Architecture

> **Status:** Phase 1, Phase 2 part 1 (messaging) and Phase 3 part 1 (reputation, calendars, automations) Phase 4 part 1 (Lead Finder) Phase 5 part 1 (sites, forms, knowledge) and Phase 6 (plans and limits, invoices and payments, custom domains, agency subscriptions and rebilling, invitations, onboarding, transfers, white-label sign-in) implemented (October 2026).
> **Companion documents:** [PRODUCT_ROADMAP](PRODUCT_ROADMAP.md) · [DATABASE_SCHEMA](DATABASE_SCHEMA.md) · [API_ARCHITECTURE](API_ARCHITECTURE.md) · [SECURITY_PLAN](SECURITY_PLAN.md) · [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)

## 1. Product thesis

Sun Marketing Console is becoming an **AI Business Growth Operating System**: a multi-tenant, white-label platform where an owner or agency describes an outcome in plain English and an **AI operator** carries it out across CRM, communications, reputation, websites, automation and analytics.

The lifecycle every module serves is **Acquire → Convert → Retain → Protect**.

| Stage | What the platform does | Modules |
|---|---|---|
| Acquire | Find and attract prospects | Lead Finder / Opportunity Radar, Site Scanner, websites and funnels, ads, social, SEO |
| Convert | Turn prospects into customers fast | CRM and pipeline, AI voice receptionist, SMS/email follow-up, calendars, proposals and payments |
| Retain | Increase lifetime value | Customer memory, campaigns, automations, referrals, client portal |
| Protect | Guard and grow reputation | Reputation and Trust Center, complaint recovery, review velocity, compliance |

**The differentiator:** traditional platforms give users tools; Sun Marketing Console gives businesses an operator that uses the tools together. The operator works under explicit permissions, and every action is audited.

---

## 2. Current-state assessment (audit of `Hyram720/sun-marketing-console` @ `767753c`)

### 2.1 Stack and runtime

| Concern | Current state |
|---|---|
| Framework | Next.js **16.3** App Router, React 19.2, TypeScript 5.9 (strict). No Tailwind: one hand-written `globals.css` (~400 lines) with a dark "console" theme scoped to `.shell` |
| Hosting | **Netlify** (headers such as `x-nf-client-connection-ip`; Netlify scheduled function `follow-up-scheduler` runs every 15 minutes). Vercel was not in use; the code is host-portable |
| Database | Supabase Postgres 17 (`sunsite-hub`), 35 tables, RLS on every table |
| DB access pattern | Server routes use the **anon key plus a shared `x-app-secret` header**; every policy is `app_secret_ok()`. Effectively a service-role connection guarded by a shared string. No per-user or per-tenant row security |
| Auth | (a) Owner **passcode** → deterministic SHA-256 cookie valid for one year; (b) "team login" via Supabase Auth password grant, gated on `team_members.active` (0 rows in production) |
| Background work | Netlify cron → `/api/automation/run` (sends due `interactions`); a Windows/Ollama **local agent worker** polls `/api/agents/worker` |
| Tests | No unit or integration test runner; five ad-hoc `scripts/verify-*.cjs` scripts. No CI |
| Lint/format | None configured |

### 2.2 Feature inventory (existing, working)

| Module | Route(s) | What it does | Integrations |
|---|---|---|---|
| Dashboard | `/` | Pipeline KPIs and action center over `businesses` | — |
| Opportunity Radar | `/discover` | Finds local businesses by city/category, scores opportunity | OpenStreetMap, Google Places (optional), Yelp (optional) |
| Site Scanner + Report Cards | `/scan`, `/audits`, `/report/[token]` | ~50 live website checks graded A–F; shareable public report with view/CTA tracking and PDF | Direct fetch with SSRF guard |
| Pipeline (prospects) | `/prospects`, `/prospects/[id]` | Agency prospect pipeline, enrichment, outreach templates, interactions | Public-source enrichment |
| Website rebuilds / builder | `/prospects/[id]/rebuild`, `/website-builder`, `/rebuild/[token]` | Concept website generator; Puck visual editor | OpenAI Images |
| Proposals | `/proposal/[token]` | Proposal acceptance and Stripe Checkout | Stripe |
| SEO Toolkit | `/seo` | Work plans, meta/schema generators, GBP checklist | — |
| Review Engine | `/reputation`, `/r/[slug]` | Branded review pages, QR codes, private feedback (no review gating) | QR |
| Email Marketing | `/email-marketing` | Contacts, templates, approved campaigns, unsubscribe | Resend |
| Campaign Studio | `/campaign-studio`, `/bridge/[id]` | Funnels with consent capture, AI chat/voice, scheduled follow-ups | OpenAI, Vapi, Telnyx SMS, Resend |
| AI Receptionist | `/receptionists` | Receptionist configuration and prompt generator per client | Vapi |
| Lead Marketplace | `/leads` | Roofing lead distribution to partners with wallets and atomic `claim_lead` | — |
| Agent Center | `/agents` | Queue jobs for the local Ollama worker; human-approved prompt improvements | Ollama (local) |
| Growth Engine, Video Prompt Studio | `/growth-engine`, `/video-prompts` | Integration readiness board; ad/video prompt authoring | Higgsfield/KIE (status only) |

Strengths worth keeping: careful compliance instincts (no review gating, consent-gated follow-ups, `STOP` handling, `List-Unsubscribe`), verified webhooks (Telnyx ed25519, Stripe signatures), encrypted provider keys (AES-256-GCM), SSRF guards, and honest "not configured" states.

### 2.3 Database (live) — summary

35 tables in `public`. Only **6 of the 17 applied migrations** exist in the repository; the base schema (`businesses`, `audits`, `interactions`, `proposals`, `team_members`, `app_secrets`, lead marketplace tables, `receptionist_*`, `website_rebuilds`, and the `app_secret_ok()` function) **is not in version control**. See [DATABASE_SCHEMA §1](DATABASE_SCHEMA.md#1-current-live-schema-audit).

### 2.4 Technical debt

| # | Debt | Impact | Plan |
|---|---|---|---|
| T1 | Schema drift: 11 applied migrations missing from the repo | Cannot rebuild the database or review changes | `supabase db pull` into a baseline migration (Phase 1b) |
| T2 | Single-tenant data model; no `organization_id` on legacy tables | Blocks SaaS | Phase 1 adds tenancy; legacy tables migrate module-by-module (Phases 2–5) |
| T3 | Shared-secret DB access everywhere | One leaked string = full database | Move server jobs to a service-role key; user traffic to user JWT + RLS (started in Phase 1) |
| T4 | No tests, lint or CI | Regressions ship silently | Vitest + SQL tests added in Phase 1; add ESLint + GitHub Actions in Phase 1b |
| T5 | `middleware.ts` is deprecated in Next 16 (`proxy.ts`) | Future upgrade break | Rename once Netlify's Next runtime supports `proxy` (verify) |
| T6 | Three separate "contact" models (`businesses`, `email_contacts`, `studio_contacts`) plus `leads` | Fragmented customer memory | Converge on `contacts` + `activities` (Phases 2–3) |
| T7 | Three messaging code paths (Twilio in `messaging.ts`, Telnyx/Resend in Campaign Studio, Resend in email center) | Vendor lock-in, inconsistent compliance | Unified communications layer (Phase 2) |
| T8 | Middleware performs 1–2 network calls per request | Latency and cost | Verify Supabase JWTs locally with JWKS (Phase 1b) |
| T9 | Dark theme does not set `color` on `.shell`; mobile nav renders 20 items in 3 rows | Readability and usability | Global fix plus the navigation redesign in [PRODUCT_ROADMAP](PRODUCT_ROADMAP.md) |
| T10 | Hand-rolled CSS; no component library | Slower UI work | Keep tokens; extract shared components (`Modal`, `Toast`, `TenantGate` started) |
| T11 | Mixed code style (some routes minified onto single lines) | Hard to review | Add Prettier in Phase 1b |

### 2.5 Reusable components

- **`lib/audit.ts`** (1,181 lines): mature website auditor, the core of Lead Finder audits (Phase 4).
- **`lib/secrets.ts`**: AES-GCM credential vault; generalize to per-tenant provider accounts (Phase 2).
- **Campaign Studio** (`lib/campaign-studio/*`): consent capture, unsubscribe tokens, atomic follow-up claiming. These are the patterns for Phase 2 communications.
- **Webhook verification** (Telnyx ed25519, Stripe, bearer for Vapi): move into `lib/webhooks/`.
- **`claim_lead()`** atomic claim pattern, reusable for lead routing.
- **Report cards, proposals, review pages**: public token pages with tracking, reused by the client portal.
- **Local agent worker**: model for on-prem or offline agent execution in the marketplace era.

---

## 3. Gap analysis against the specification

Legend: ✅ exists · 🟡 partial · ❌ missing · 🆕 delivered in Phase 1

| # | Spec area | Status | Notes / gap |
|---|---|---|---|
| 1 | Positioning: AI growth OS | 🟡→🆕 | Navigation now leads with **AI operator**; messaging update pending |
| 2 | AI Command Center with permission ladder and audit | 🆕 | Chat operator, 11 tools, observe/recommend/approve/auto per category, DB-enforced, audit trail. Creates/modifies CRM records, deals and tasks today; campaigns, workflows, pages and agents arrive with their modules |
| 3 | Multi-tenant SaaS | 🆕 (foundation) | Agencies → client sub-accounts, locations, memberships, RBAC, suspension. Phase 6 part 1 adds plans with database-enforced limits and metering, agency governance (plan, suspend), branding on customer pages, custom domains and full data export. Phase 6 part 2 adds platform subscriptions for agencies, client rebilling, email invitations, guided client setup, consent-based account transfer and branded sign-in on an agency's own domain. **Missing:** self-serve onboarding, invitations by email |
| 4 | CRM | 🟡→🆕 | Contacts, companies, pipelines, stages, deals, tasks, notes, tags, custom field definitions, activity history, drag-and-drop board, explainable lead scoring. **Missing:** custom objects UI, custom field editor UI, ownership routing, merge/dedupe UI, import/export UI |
| 5 | Customer memory | 🆕 (foundation) | Unified `activities` timeline, `sensitive` flag hidden from AI, erasure, consent. Cross-channel ingestion arrives with Phase 2 |
| 6 | AI voice platform | 🟡 | Vapi-specific receptionist config and Campaign Studio calls exist. **Missing:** provider-agnostic voice layer, call records per tenant, transfers, call-time booking |
| 7 | SMS and messaging | 🆕 (Phase 2 part 1) | Provider layer (Telnyx, Twilio, Resend) with failover, unified inbox, scheduling, consent/opt-out/quiet-hours gate, verified webhooks, STOP/START. **Missing:** web chat, WhatsApp, 10DLC registry UI, bulk sends (Phase 3 campaigns) |
| 8 | Reputation and Trust Center | 🆕 (Phase 3 part 1) | Reviews (manual/CSV), reply drafts incl. AI, explained Reputation Health Score, non-gated review requests, complaint tasks. **Missing:** Google/Facebook sync, widgets, competitor comparison |
| 9 | Lead generation engine | 🆕 (Phase 4 part 1) | Tenant-scoped Lead Finder, audits at scale with business-email discovery, explained Opportunity Score, CAN-SPAM email outreach with one-click unsubscribe and volume limits, convert to CRM, AI tools. **Missing:** paid data providers (ratings), reply detection, sequences |
| 10 | Websites, funnels, forms | 🆕 (Phase 5 part 1) | Hosted multi-tenant sites on the Puck editor with industry templates, draft/publish by managers, forms builder with consent capture and automation trigger. Custom domains (Phase 6). **Missing:** surveys/quizzes, A/B tests |
| 11 | Workflow automation | 🆕 (Phase 3 part 1) | Event-triggered, versioned automations with templates, AI drafting, compliance-gated messaging, signed webhooks, per-step run logs. **Missing:** branching graphs, queue faster than the 15-minute scheduler |
| 12 | Calendars | 🆕 (Phase 3 part 1) | Personal/round-robin/resource calendars, public booking, reminders, reschedule/cancel, no double booking, AI booking tools. **Missing:** Google/Microsoft sync, waitlists |
| 13 | Email marketing | 🟡 | Resend broadcasts with approval. **Missing:** sequences, A/B, tracking, segmentation, provider abstraction |
| 14 | Social | ❌ | — |
| 15 | Ads and attribution | ❌ | — |
| 16 | Affiliates and referrals | ❌ | — |
| 17 | Payments and billing | 🆕 (Phase 6 part 1) | Invoices and estimates with deposits and tax, customer pay/accept page, card payments into each business's own Stripe account with verified webhooks and refunds, manual payments. Part 2: agencies pay the platform through Stripe Billing, and rebill clients a plan fee plus usage at their own rates as reviewable draft invoices. **Missing:** recurring customer subscriptions for businesses, other processors |
| 18 | Knowledge base | 🆕 (Phase 5 part 1) | Versioned, approval-gated facts with full-text search, used by the AI operator and AI site copy. **Missing:** vector search, receptionist integration |
| 19 | Analytics and revenue intelligence | 🟡 | Dashboard KPIs; the AI can answer pipeline questions via `pipeline_summary`. **Missing:** metrics store, attribution, AI analyst over all data |
| 20 | Industry modules | 🟡 | Industry lists in receptionist and radar. **Missing:** installable template bundles |
| 21 | Marketplace | ❌ | Tool registry is the seed (see §6) |
| 22 | Client portal | 🆕 (foundation) | Client sub-account users sign in and see only their CRM and Command Center. Portal-specific simplified views pending |
| 23 | Security | 🟡→🆕 | See [SECURITY_PLAN](SECURITY_PLAN.md) |
| 24 | Compliance | 🟡→🆕 | Consent ledger, erasure, append-only audit; messaging compliance in Phase 2 |
| 25 | Technical architecture | 🟡 | Supabase, Next, TS in place; Tailwind not adopted (deliberate, see ADR-6); provider abstractions started with AI |
| 26 | UX / navigation | 🆕 | Home dashboard (today's numbers, needs-attention list, schedule, tasks, unanswered conversations, newest leads, setup checklist); menu grouped by Customers, Marketing, AI, Money and Settings, filtered by account type and role; the classic console is one collapsible group for platform staff; phone bottom bar with a "More" sheet |
| 27 | Development documentation | 🆕 | This document set |
| 28 | Quality requirements | 🆕 for new modules | Loading, empty and error states, validation, tests, "integration not configured" |

---

## 4. Target architecture

```mermaid
flowchart TB
  subgraph Clients
    WEB[Next.js App Router UI<br/>console · client portal · public pages]
    EXT[Public API / webhooks callers]
  end
  subgraph Edge["Next.js server (Netlify or Vercel)"]
    MW[proxy/middleware<br/>session refresh · tenant routing]
    RT[Route handlers<br/>tenantRoute(): auth · RBAC · zod · CSRF]
    WH[Webhook ingress<br/>signature verify · idempotency]
  end
  subgraph Domain["Domain services (src/lib)"]
    CRM[crm/*]
    CMD[command/*<br/>engine · tools · policy · actions]
    COMMS[comms/* Phase 2]
    REP[reputation/* Phase 3]
    WF[workflows/* Phase 3]
    BILL[billing/* Phase 6]
  end
  subgraph Providers["Provider adapters (no vendor in domain code)"]
    AI[ai/: OpenAI · next providers]
    VOICE[voice/: ElevenLabs · Cartesia · OpenAI]
    TEL[telephony/: Telnyx · Plivo · Twilio]
    MSG[email/: Resend · SES · Postmark]
    PAY[payments/: Stripe · next]
  end
  subgraph Supabase
    PG[(Postgres + RLS<br/>organization_id everywhere)]
    AUTH[Auth + MFA]
    STO[Storage]
    RTM[Realtime]
    Q[Queues / outbox → workers]
  end
  WEB --> MW --> RT --> Domain
  EXT --> WH --> Q
  Domain --> Providers
  Domain -->|user JWT| PG
  Q -->|service role, org-scoped| Domain
  RT --> AUTH
```

### 4.1 Tenancy model

- **Organization** is the tenant boundary. `kind = agency | client`; a client always has exactly one parent agency. Agencies are created by platform staff; clients by agency admins.
- **Membership** grants a role per organization: `owner > admin > manager > member > viewer`. Agency members inherit access to their clients **capped at admin**; agency admins appoint client owners.
- **Every tenant row carries `organization_id`.** RLS grants access through `public.org_rank(organization_id)`, a `security definer` function reading memberships for `auth.uid()`. Composite foreign keys `(id, organization_id)` make cross-tenant references impossible.
- **Application code also scopes by the active organization**, because a person can belong to several organizations and RLS would return all of them.
- **Locations** hang off an organization; location-level permissions are a Phase 3 refinement (calendars, territories).
- **Platform staff** (`team_members`) keep access to the legacy single-tenant modules until those modules migrate.

### 4.2 Two data-access modes

| Mode | Used by | Security |
|---|---|---|
| **User mode**: anon key + the user's access token (`userClient()`) | All user-initiated reads and writes in tenant modules | RLS on `auth.uid()`; the shared secret is never sent |
| **System mode**: service-role key | Webhooks, schedulers, queue workers | Bypasses RLS; must always filter by `organization_id`; only in server-only modules |
| *Legacy mode*: anon key + `x-app-secret` | Existing single-tenant modules | To be retired (see SECURITY_PLAN S1–S3) |

### 4.3 AI operator architecture (implemented)

```
User goal ──► /api/command ──► engine.runCommand()
                                 │  system prompt: org, role, date, AI permissions, data-is-untrusted rule
                                 ▼
                     ChatModel (provider adapter) ◄──► tool specs (zod → JSON Schema)
                                 │ tool calls
              ┌──────────────────┴───────────────────┐
         read tool                               write tool
   runs now with the user's RLS     validate → ai_actions row with status from policy:
                                    observe→blocked · recommend→recommended ·
                                    approve→pending_approval · auto→approved→execute
                                 │
                     audit_log (ai.action.*) · outcome reported truthfully to the model
```

- **Tools are thin wrappers over the same domain services the UI uses** (`lib/crm/service.ts`), so the AI cannot do anything a user cannot do through the UI, and it passes the same validation.
- **The database is the authority** on governance: `tg_ai_actions_guard` rejects statuses that don't match the organization policy, makes payloads immutable, requires a manager to approve, and lets only the approver execute.
- **Execution happens with the approving human's RLS rights.** The AI never holds a service-role credential.
- **Prompt-injection posture:** tool output is labelled untrusted; writes cannot exceed policy; sensitive timeline entries are redacted before reaching the model; there are caps of 6 steps and 10 writes per turn.
- **Extending the operator** means registering a tool with `category`, `input` schema, `validate`, `summarize` and `run`. New modules (messaging, workflows, reputation) plug in without engine changes. The same registry is the seed of the marketplace (§6).

### 4.4 Provider abstraction pattern

Each capability gets an interface in `src/lib/<capability>/types.ts`, adapters per vendor, and a **router** that picks an adapter per organization and per request:

```ts
interface SmsProvider {
  id: "telnyx" | "plivo" | "twilio";
  send(msg: OutboundSms, account: ProviderAccount): Promise<{ providerMessageId: string; costMicros?: number }>;
  verifyWebhook(req: Request, account: ProviderAccount): Promise<boolean>;
  parseWebhook(body: unknown): InboundSmsEvent | DeliveryEvent | null;
}
// router: choose by org preference → region → health (rolling delivery rate) → price; fail over on retryable errors
```

Credentials live in a per-organization `provider_accounts` table, encrypted, with agency-level defaults (Phase 2). The AI layer already follows this pattern: `ai/types.ts`, `ai/openai.ts`, `ai/provider.ts`.

### 4.5 Event-driven backbone (outbox implemented in Phase 3; queue pending)

- **Transactional outbox:** domain writes insert `domain_events (organization_id, type, payload, created_at)` in the same transaction.
- **Queue:** Supabase Queues (pgmq) or an external queue such as Inngest; workers run with the service role, scoped per organization, idempotent by event ID.
- Workflows (Phase 3), lead scoring refresh, analytics rollups, webhooks out and AI "act automatically" jobs all consume events.
- Inbound webhooks are verified and then written to `webhook_events` (unique provider event ID) before any processing.

### 4.6 White-label (Phase 6)

`organizations.branding` (logo, colors, product name) is in place. Custom domains map `host → organization` through a `domains` table checked in middleware; email sender domains are verified per organization via the email provider abstraction.

---

## 5. Key decisions (ADR summary)

| ID | Decision | Rationale |
|---|---|---|
| ADR-1 | **Evolve the existing app; don't rebuild.** New multi-tenant modules sit beside legacy modules and absorb them one at a time | Keeps working revenue features alive; lower risk |
| ADR-2 | **RLS on `auth.uid()` + composite FKs** for all new tables; the shared secret grants nothing on them | Database-enforced isolation that survives application bugs |
| ADR-3 | **AI governance in the database** (policy-checked state machine) as well as the app | The UI and engine can have bugs; the DB guard is the last line |
| ADR-4 | **AI acts with the accountable human's rights**, never with a service credential | Prevents privilege escalation via prompt injection |
| ADR-5 | **Zod schemas as the single source** for API validation and AI tool JSON Schema | One definition, two enforcement points |
| ADR-6 | **Keep the existing CSS design system** instead of introducing Tailwind mid-flight | Avoids a parallel styling system; revisit at the Phase 2 UI restructure |
| ADR-7 | **Host-agnostic Next.js**; currently Netlify. Moving to Vercel is optional | Scheduled jobs move to the queue/worker layer in Phase 2, removing host-specific cron |
| ADR-8 | **Provider adapters + router** for AI, voice, telephony, messaging, email and payments | Spec requirement; cost and reliability routing |
| ADR-9 | **Deterministic, explainable lead scoring first**; ML scoring later on the same factor interface | Users and the AI can see why; no training data yet |

## 6. Marketplace readiness

Tool registry entries, pipeline templates (`seed_organization_defaults`), and policies are already data or code units that can be packaged. Phase 8 adds `marketplace_listings`, `installs`, and versioned bundles (`agents`, `workflows`, `funnels`, `industry configs`) with signed manifests and sandboxed tool permissions.
