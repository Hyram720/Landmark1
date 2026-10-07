# API Architecture

## 1. Principles

- **Route handlers stay thin.** Validation → domain service → JSON. Business logic lives in `src/lib/<domain>/`, shared by the REST API and the AI operator's tools.
- **One wrapper for tenant routes:** `tenantRoute(permission, handler)` in `src/lib/tenant/api.ts` provides:
  - same-origin check for state-changing methods (CSRF defence on top of `SameSite=Lax` cookies)
  - authentication (Supabase user session) and the active organization (cookie `sm_org`, validated against `my_organizations()`)
  - RBAC permission check (`src/lib/tenant/rbac.ts`), mirrored by RLS in the database
  - uniform errors: `{ error, code }` with the right HTTP status; Postgres errors mapped by `fromDb()` (42501 → 403, 23505 → 409, 23503 → 422, …); never internal details
- **Validation with Zod** (`readJson(req, schema)` caps bodies at 64 KB). The same schemas generate the AI tool JSON Schemas.
- **Every query is explicitly scoped by `organization_id`**, in addition to RLS.
- **Mutations are audited** through `audit()` → `log_audit()`.
- **No vendor names in domain code.** Integrations go through provider adapters.

## 2. Authentication and sessions

| Session | Cookie(s) | Grants |
|---|---|---|
| Team / tenant user | `sm_auth` (access token, ≤1 h), `sm_refresh` (rotating refresh token, 30 days), `sm_org` (active org) | Tenant modules for every member; legacy modules for platform staff (`team_members`) only |
| Owner passcode (legacy) | `sm_session` | Legacy single-tenant modules only; tenant APIs return 401 |

`middleware.ts`: public paths pass; otherwise passcode or Supabase session. Expired access tokens are refreshed with the refresh token, and the new token is forwarded to the same request. Non-staff users are redirected from legacy pages to `/command-center`. Unauthenticated tenant API calls get `401` JSON.

## 3. Endpoint reference: Phase 1 (tenant)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/tenant` | signed in | `{ signedIn, user, orgs, org, isPlatformStaff, ai }` |
| `POST /api/tenant` | signed in | `{action:"switch", orgId}` or `{action:"create", name, kind, parentId?}` |
| `GET /api/tenant/members` | org.read | Members of the active org |
| `POST /api/tenant/members` | org.manage | `{email, role}`: add an existing user |
| `PATCH /api/tenant/members` | org.manage | `{user_id, role?, status?}` |
| `POST /api/tenant/import-legacy` | org.manage (+ staff in DB) | Copy legacy prospects into the CRM |
| `GET /api/crm/contacts?q&offset&limit&sort` | crm.read | Search/list (score-sorted) with total |
| `POST /api/crm/contacts` | crm.write | Create; returns `{contact, duplicate}` (dedupe on email/phone) |
| `GET /api/crm/contacts/:id` | crm.read | Contact + timeline + tasks + deals + current consent |
| `PATCH /api/crm/contacts/:id` | crm.write | Update fields, stage, tags, do-not-contact |
| `POST /api/crm/contacts/:id` | crm.write / crm.erase | `{action:"rescore"}` or `{action:"erase"}` (admin) |
| `DELETE /api/crm/contacts/:id`, `DELETE /api/crm/contacts {ids}` | crm.delete (manager) | Permanently delete one or up to 100 contacts with their timeline, tasks, messages and appointments; deals and reviews are kept, unlinked; opt-outs survive |
| `POST /api/crm/contacts/:id/notes` | crm.write | Add note to timeline |
| `POST /api/crm/contacts/:id/consent` | crm.write | Append consent change (channel, status, source, evidence) |
| `GET /api/crm/pipeline?pipeline` | crm.read | Board: pipeline, stages, deals |
| `POST /api/crm/opportunities` | crm.write | Create deal |
| `PATCH /api/crm/opportunities/:id` | crm.write | `{stage_id}` move |
| `GET/POST /api/crm/tasks`, `PATCH /api/crm/tasks/:id` | crm.read / crm.write | Open tasks; create; complete/cancel |
| `GET /api/command[?conversation]` | ai.chat | Conversation list or messages |
| `POST /api/command` | ai.chat | `{message, conversationId?}` → `{conversationId, reply, actions, toolsUsed}`; 8 requests/min per user (DB-backed); 503 `integration_not_configured` without a provider |
| `GET /api/command/actions?status=a,b` | crm.read | AI actions |
| `POST /api/command/actions/:id` | ai.chat (approve: ai.decide) | `{decision:"approve"|"reject"}`; approval executes immediately as the approver |
| `GET/PUT /api/command/policies` | crm.read / ai.policies | AI permissions per category |
| `GET /api/command/audit?before` | audit.read | Audit log, newest first, 100 per page |

Legacy endpoints (`/api/businesses`, `/api/audits`, `/api/leads`, …) are unchanged and remain platform-staff only.

### Phase 2 endpoints (communications)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/inbox?status=open/closed/all&mine=1&unread=1` | crm.read | Conversation list |
| `GET /api/inbox/:id` / `POST {action}` | crm.read / crm.write | Thread (marks read); close, reopen, assign |
| `POST /api/messages` | crm.write | Send or schedule `{contact_id, channel, body, subject?, purpose?, scheduled_for?, idempotency_key?}` → `{outcome: sent/failed/scheduled/blocked/duplicate, …}`; a compliance block is a normal 200 result with the reason |
| `POST /api/messages/check` | crm.read | Can this person be messaged now, and why not |
| `POST /api/messages/:id {action:"cancel"}` | crm.write | Cancel a scheduled message |
| `POST /api/crm/contacts/:id/opt-out` | crm.write | Record an opt-out the person gave verbally |
| `GET/POST /api/channels`, `PATCH/DELETE/POST(test) /api/channels/:id`, `PUT /api/channels/settings` | org.read / org.manage | Provider accounts, credential test, time zone and texting hours |
| `POST /api/webhooks/telnyx/sms`, `POST /api/webhooks/twilio/sms` | provider signature | Inbound texts, delivery receipts, STOP/START (service role) |
| `POST /api/comms/dispatch` | `AUTOMATION_SECRET` | Sends due scheduled messages (called by the scheduler) |

### Phase 3 endpoints (reputation, calendars, automations)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/reputation?needs_reply=1&rating_max=&status=` | crm.read | Health score with factors, request stats, review sites, reviews, recent requests |
| `POST /api/reputation/reviews`, `PATCH /api/reputation/reviews/:id` | crm.write | Record a review; change status, save a draft reply or mark it posted |
| `POST /api/reputation/import` | reputation.manage | CSV import (`{csv, platform}`); duplicate review ids are skipped |
| `POST /api/reputation/sources`, `PATCH/DELETE /api/reputation/sources/:id` | reputation.manage | Review sites |
| `POST /api/reputation/requests` | crm.write | `{contact_id, channel, force?}` → `{outcome: sent/blocked/failed/skipped}` |
| `GET/POST /api/calendars`, `PATCH /api/calendars/:id` | crm.read / calendar.manage | Calendars with members; create and edit |
| `GET /api/calendars/:id/slots?from&days&exclude` | crm.read | Open times |
| `GET/POST /api/appointments`, `PATCH /api/appointments/:id` | crm.read / crm.write | Agenda, book (`outside_hours` for staff), status changes and reschedule, optional customer notice |
| `GET/POST /api/workflows`, `GET/POST /api/workflows/:id` | crm.read / automation.manage | List and templates; detail with versions, runs and `?run=` step log; actions `save`, `activate`, `pause`, `archive` |
| `POST /api/workflows/draft` | automation.manage | "Describe it in English" → proposal (not saved); 10 per hour per user |
| `POST /api/workflows/runs/:id` | automation.manage | Stop a run |
| `GET /api/workflows/webhook-secret` | org.manage | Signing secret for webhook steps |
| `GET/POST /api/public/booking/:slug` | public, rate-limited | Open times (no team identities); book with optional SMS consent captured as evidence |
| `GET/POST /api/public/appointment/:token` | public, rate-limited | Customer views, reschedules or cancels |
| `GET/POST /api/public/review-request/:token` | public, rate-limited | Records open, rating and site click; always returns every active review site |
| `POST /api/jobs/tick` | `AUTOMATION_SECRET` | Enroll runs from events, advance due runs, send reminders |

### Phase 4 endpoints (Lead Finder)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/prospecting?q&status&min_score&no_website&ssl_issue&no_booking&has_email&not_audited` | crm.read | Prospects (score order), recent searches, directory categories |
| `POST /api/prospecting` / `DELETE /api/prospecting {ids}` | crm.write / crm.delete | Add a business by hand; delete prospects |
| `POST /api/prospecting/search` | crm.write | Directory search; saves new businesses (10 per 10 minutes per organization) |
| `POST /api/prospecting/audit {ids?}` | crm.write | Queue audits and run the next two; returns `remaining` |
| `GET/PATCH /api/prospecting/:id`, `POST {action:"convert"}` | crm.read / crm.write | Detail with audits and outreach; status, notes, email, do-not-contact; add to CRM |
| `GET/PUT /api/prospecting/settings` | crm.read / org.manage | Sender name, postal address, signature, daily limit |
| `POST /api/prospecting/outreach` | crm.write | Draft the next email (template from the audit, or given text) |
| `PATCH /api/prospecting/outreach/:id`, `POST {action: send/discard}` | crm.write | Edit a draft; send (as the signed-in person) or discard |
| `POST /api/public/outreach-unsubscribe/:token` | public, rate-limited | One-click unsubscribe (RFC 8058) and the `/optout/:token` button |

### Phase 5 endpoints (sites, forms, knowledge)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET/POST /api/forms`, `GET/PUT/DELETE /api/forms/:id` | crm.read / sites.manage | Forms; detail includes recent submissions |
| `GET/POST /api/public/forms/:slug` | public, rate-limited | Form definition (with consent wording); submit `{values, consent_sms, consent_email, website (honeypot), page_url}` |
| `GET/POST /api/sites` | crm.read / crm.write | Sites list and industries; create from a template or with `use_ai` (copy from approved knowledge only) |
| `GET/PATCH /api/sites/:id`, `POST {action: publish/unpublish/archive}` | crm.read / crm.write (+ sites.manage to publish) | Site detail and pages; publishing publishes every changed page |
| `POST /api/sites/:id/pages` | crm.write | Add a page (optionally copying another) |
| `GET/PATCH/DELETE /api/sites/pages/:pageId`, `POST {action: publish/unpublish}` | crm.read / crm.write / sites.manage | Load and save drafts (validated), publish one page |
| `GET/POST /api/knowledge`, `PATCH/DELETE /api/knowledge/:id` | crm.read / crm.write (approve: sites.manage) / crm.delete | Knowledge items |
| `GET /s/:site/:page?`, `GET /f/:slug` | public | Live site pages (published copy only) and hosted forms |

### Phase 6 endpoints (plans, invoices, payments, domains)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/billing` | org.read | Plan, status and usage; agencies also get their plans and client accounts with usage |
| `POST /api/billing` | org.manage (agency) | Create or update an agency plan (price, limits per metric) |
| `POST /api/billing/govern` | org.manage | `{org_id, plan?, status?}`; the database allows platform staff or the parent agency's admins only |
| `GET/POST/DELETE /api/billing/stripe` | org.read / org.manage | The organization's own Stripe account: connect (key validated, webhook endpoint created automatically or secret pasted), status, disconnect |
| `GET/PUT /api/organization/branding` | org.read / org.manage | Name, logo, color and support contacts shown on customer pages |
| `GET /api/organization/export` | owner/admin of the org or its agency | Full JSON export; works while the account is suspended |
| `GET/POST /api/invoices` | crm.read / crm.write | List (`kind`, `status`, `contact_id`) and create invoices or estimates |
| `GET/PUT /api/invoices/:id`, `POST {action: send/void/accept/decline/convert/record_payment}` | crm.read / crm.write (manual payments, accept/decline: manager) | Detail with payments and customer link; edit drafts; lifecycle actions |
| `POST /api/invoices/payments/:id {action: refund}` | manager | Refund a card payment through the business's Stripe account |
| `POST /api/webhooks/stripe-account/:accountId` | Stripe signature (per-account secret) | `checkout.session.completed`, `charge.refunded`; idempotent |
| `GET/POST /api/public/invoice/:token` | public, rate-limited | Customer view; `{action: pay}` returns a Stripe Checkout URL, `accept`/`decline` for estimates |
| `GET/POST /api/sites/:id/domains`, `POST/DELETE /api/sites/domains/:domainId` | crm.read / sites.manage | Custom domains; `{action: verify}` checks the `_sun-verify` TXT record |
| `GET /i/:token` | public | Customer invoice and estimate page |

Plan limits surface as HTTP 402 with code `plan_limit`.

Outgoing workflow webhooks carry `X-Sun-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`. They are sent with `publicFetch`, so private and internal addresses are refused, and time out after 10 seconds.

## 4. Conventions for new endpoints

- **Paths:** `/api/<module>/<resource>[/:id][/<sub-resource>]`; plural resource names.
- **Pagination:** `limit` (≤200) + `offset` now; switch to keyset (`before` cursor) for append-only streams (audit, messages).
- **Idempotency:** client-supplied `Idempotency-Key` header on create endpoints that trigger external effects (messages, payments, calls). Store it with a unique constraint per org.
- **Errors:** `{ error: string (human), code: string (machine) }`. Codes in use: `unauthenticated`, `no_organization`, `forbidden`, `csrf`, `invalid`, `invalid_reference`, `conflict`, `not_found`, `too_large`, `rate_limited`, `plan_limit`, `integration_not_configured`, `server_error`.
- **"Integration not configured"** is always a `503` with code `integration_not_configured` and a settings path. The UI shows it; nothing is ever simulated.
- **Long-running work** (bulk sends, audits at scale, AI autonomous jobs) returns `202` with a job ID; progress through Supabase Realtime on the job row.

## 5. Webhook ingress (standard from Phase 2)

```
POST /api/webhooks/<provider>/<capability>
  1. Read the raw body (size cap) → verify signature with the provider adapter (ed25519, HMAC, or provider-signed JWT)
  2. Reject on stale timestamps (>5 min); constant-time comparisons
  3. Insert into webhook_events (provider, provider_event_id UNIQUE) → duplicates return 200 immediately
  4. Resolve the organization from the provider resource (phone number, account ID); never trust IDs from the payload alone
  5. Enqueue → return 200 fast; the worker processes idempotently with the service role scoped to that org
```

Existing verified handlers (Telnyx SMS, Vapi, Stripe) will be ported into this shape.

## 6. Provider adapter interfaces

```ts
// src/lib/ai/types.ts (implemented)
interface ChatModel { provider: string; model: string; complete(req: { messages: ChatMessage[]; tools: ToolSpec[] }): Promise<Completion> }

// src/lib/telephony/types.ts (Phase 2)
interface TelephonyProvider {
  id: string;
  placeCall(req: { from: string; to: string; agent: VoiceAgentRef; webhookUrl: string }, acct: ProviderAccount): Promise<{ callId: string }>;
  transfer(callId: string, to: string, acct: ProviderAccount): Promise<void>;
  sendSms(req: OutboundSms, acct: ProviderAccount): Promise<{ messageId: string; costMicros?: number }>;
  verifyWebhook(req: Request, rawBody: string, acct: ProviderAccount): Promise<boolean>;
  parseEvent(body: unknown): TelephonyEvent | null;
}

// src/lib/voice/types.ts (Phase 2)
interface VoiceProvider { id: string; synthesizeStream(text: string, voice: VoiceRef): AsyncIterable<Uint8Array>; listVoices(acct: ProviderAccount): Promise<VoiceRef[]> }

// src/lib/email/types.ts (Phase 2)
interface EmailProvider { id: string; send(msg: OutboundEmail, acct: ProviderAccount): Promise<{ messageId: string }>; verifyDomain(domain: string, acct: ProviderAccount): Promise<DnsRecords> }

// src/lib/payments/types.ts (Phase 6)
interface PaymentProvider { id: string; createCheckout(req: CheckoutRequest): Promise<{ url: string; externalId: string }>; createSubscription(...): Promise<...>; refund(...): Promise<...>; verifyWebhook(...): Promise<boolean> }
```

**Router** (`src/lib/<capability>/router.ts`): resolve the org's provider account (org → parent agency → platform default), filter by capability and region, rank by health (rolling delivery or answer rate), then price; fail over on retryable errors; record the provider and cost on the resulting message or call.

## 7. AI operator tool contract

```ts
type WriteTool = {
  name: string;               // ^[a-z][a-z0-9_]{1,63}$, unique
  category: AiCategory;       // decides the governing policy
  description: string;        // shown to the model
  input: ZodSchema;           // → JSON Schema for the model; runtime validation
  validate(input): void;      // the domain service's own validation, before queueing
  summarize(input): string;   // the human-readable line in approvals and audit
  run(ctx, input): Promise<unknown>; // executes with the accountable user's RLS rights
};
```

Phase 1 tools: `search_contacts`, `get_contact`, `pipeline_summary`, `list_deals`, `list_open_tasks` (read); `create_contact`, `update_contact`, `add_note`, `create_task`, `create_deal`, `move_deal` (write). Phase 2: `list_conversations`, `get_conversation`, `send_message`. Phase 3: `reputation_summary`, `list_reviews`, `list_calendars`, `check_availability`, `list_appointments`, `list_automations` (read); `draft_review_reply`, `request_review` (reputation), `book_appointment`, `cancel_appointment` (calendar), `draft_automation` (workflows; creates drafts only).

## 8. Rate limiting

- Login: per-IP attempt counter (in-memory; move to DB/Redis in Phase 1b).
- AI: 8 operator requests per minute per user (counted from `ai_messages`).
- Public endpoints (review feedback, report events, studio capture): DB-backed limiter (`studio_take_limit` pattern) to be applied uniformly in Phase 1b.
- Outbound messaging (Phase 2): per-org and per-number throughput limits matching 10DLC throughput tiers.

## 9. Public API (Phase 6+)

Organization-scoped API keys (`api_keys (hash, prefix, scopes, last_used_at)`), the same handlers behind `/api/v1/*`, OpenAPI generated from the Zod schemas, and outbound webhooks signed with per-subscription secrets.
