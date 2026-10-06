# Security Plan

## 1. Audit findings (existing system)

Severity uses impact × likelihood for a multi-tenant SaaS holding customer PII and provider credentials. **No secret values appear in this document.**

| ID | Severity | Finding | Recommendation | Phase |
|---|---|---|---|---|
| **S1** | **Critical** | The live `public.app_secret_ok()` function compares the `x-app-secret` header to a **hardcoded string literal**. Anyone who can see the schema (dumps, `pg_proc`, the `supabase_migrations` history table, support exports, backups) learns the one secret that, with the anon key, grants read/write on every legacy table, including encrypted provider keys | **Rotate now.** Store the new value in Supabase Vault and have a `security definer` `app_secret_ok()` compare against `vault.decrypted_secrets`, or retire the header model (S3). Treat the old value as compromised. Check `supabase_migrations.schema_migrations` and old backups for copies | 1b (urgent) |
| **S2** | High | `APP_DB_SECRET` is also the root of the AES-256-GCM key protecting `app_secrets` (provider API keys). One leaked string exposes both the database and the decryption key; rotating the DB secret silently breaks decryption | Introduce a separate `APP_ENCRYPTION_KEY` (32 random bytes, server-only), add a key ID to the ciphertext (`v2.<kid>.…`), and re-encrypt existing rows during rotation. Then rotate the stored provider keys themselves | 1b |
| **S3** | High | Legacy data access = anon key + shared header. All authorization lives in application code, there is no per-user identity in the database, and there is no tenant isolation on legacy tables | Phase 1 pattern: user JWT + RLS for user traffic; `SUPABASE_SERVICE_ROLE_KEY` for jobs. Migrate legacy modules (DATABASE_SCHEMA §4) and finally drop `app_secret_ok()` | 1b–5 |
| **S4** | High | Owner passcode session: a deterministic `sha256("sunmarketing::"+passcode)` cookie valid for one year. It cannot be revoked without changing the passcode, is shared by everyone who knows the code, has no attribution and no MFA | Make the passcode a break-glass path: off by default once an owner has a team account; random server-stored session IDs with expiry and revocation; audit every passcode login | 1b |
| S5 | Medium | Login brute-force limiting is an in-memory `Map` per serverless instance | Move to a DB-backed limiter (`studio_take_limit` pattern) keyed by IP and account; rely on Supabase Auth's built-in limits for password logins | 1b |
| S6 | Medium | Legacy routes have no role checks: any team member or passcode holder can change settings, send messages, or delete data | New modules use RBAC; legacy routes get `requireStaffRole()` until they migrate | 1b |
| S7 | Medium | `PATCH /api/settings` passes the request body straight to `update()` (mass assignment within `app_settings`) | Zod schema allow-list | 1b |
| S8 | Medium | Public endpoints without rate limits: `/api/public/feedback` (spam; `campaignId` unchecked) and `/api/public/report-event` (non-atomic read-modify-write counters; inflation) | DB limiter per IP + token; validate that the campaign exists and is active; atomic `update … set view_count = view_count + 1` via RPC | 1b |
| S9 | Medium | Site Scanner SSRF guard: DNS is resolved, then `fetch` resolves again (DNS-rebinding window). `100.64.0.0/10` and some IPv4-mapped IPv6 ranges (`::ffff:172.16/12`, `::ffff:169.254/16`) are not blocked | Pin the resolved IP using an undici `Agent` with a custom `lookup`; complete the blocklist (CGNAT, benchmarking, mapped ranges); add unit tests | 1b |
| S10 | Medium | The local agent worker authenticates with the **owner passcode** stored in a plaintext `.env.local` on a workstation; a passcode session can also post job results and improvement proposals | Dedicated worker token (hashed in the DB) scoped to `/api/agents/worker` only; rotate the passcode after rollout | 1b |
| S11 | Low | `/api/automation/run` compares the bearer token with `!==` | `timingSafeEqual` | 1b |
| S12 | Low | No Content-Security-Policy or HSTS (nosniff, frame-deny and referrer-policy are present) | Nonce-based CSP for console pages; HSTS at the host | 1b |
| S13 | Low | Middleware makes 1–2 network calls per request to Supabase (latency; outage amplification) | Verify JWTs locally via JWKS; cache staff membership in a short-lived signed claim | 1b |
| S14 | Info | 11 applied migrations (including the original policies) are not in the repository | Baseline pull (DATABASE_SCHEMA §1) so policies can be reviewed and tested | 1b |

Strengths already present: verified Telnyx (ed25519 + timestamp window) and Stripe webhooks, encrypted provider keys, SSRF guard on scanner and enrichment, no review gating, consent-gated follow-ups with `STOP` handling, `List-Unsubscribe`, secure headers, no secrets in client bundles (explicitly avoided in `next.config.mjs`), and fail-closed middleware.

## 2. Controls implemented in Phase 1

| Control | Implementation |
|---|---|
| Tenant isolation in the database | RLS on `org_rank(organization_id)` for 17 new tables; composite FKs block cross-tenant references; 54 SQL tests |
| Least privilege | Five-role ladder; DB-enforced role grants (no granting above own rank, last-owner protection); agency staff capped at admin in clients |
| No shared-secret expansion | New tables ignore `x-app-secret`; user traffic uses the user's JWT |
| AI governance | Per-category policy; DB-enforced action state machine; immutable payloads; manager approval; execution with the approver's rights; step and write caps; sensitive-entry redaction; untrusted-data instruction in the system prompt |
| Audit | Append-only `audit_log` (immutable even for `service_role`); actor fixed to `auth.uid()`; AI vs. user actor types |
| Session security | httpOnly + Secure + SameSite=Lax cookies; ≤1 h access tokens with rotating refresh tokens; logout clears all session cookies |
| CSRF | Same-origin check on state-changing tenant requests |
| Input validation | Zod on every tenant endpoint; 64 KB body cap; PostgREST filter-syntax sanitizing in search; DB `check` constraints as a second layer |
| Error hygiene | `fromDb()` maps database errors to safe messages; no stack traces or SQL in responses |
| Abuse limits | DB-backed AI rate limit per user |
| Privacy | `erase_contact()` (admin, audited), do-not-contact, consent ledger |
| Secrets | AI provider key reuses the encrypted Settings vault; never sent to the client |

## 3. Security architecture going forward

### 3.1 Identity
- Supabase Auth (email/password now; magic links and Google/Microsoft OAuth in Phase 2)
- **MFA:** TOTP enrolment; require `aal2` for owner/admin sessions and for sensitive actions (AI policy → auto, erasure, billing, member roles)
- SSO/SAML for enterprise agencies (Phase 6+)
- Session revocation on role removal (refresh token revoke via the admin API)

### 3.2 Secrets and keys
- Server-only environment variables (Netlify/Vercel encrypted env); never `NEXT_PUBLIC_*` for secrets
- Per-tenant provider credentials in `provider_accounts`, encrypted with `APP_ENCRYPTION_KEY` (with key IDs), decrypted only inside adapters
- Quarterly rotation runbook; immediate rotation on staff departure
- Secret scanning in CI (gitleaks)

### 3.3 Data protection
- TLS everywhere; Postgres encryption at rest (Supabase)
- Storage buckets private by default; object paths `org/<organization_id>/…` with RLS on `storage.objects` using `org_rank`
- Signed URLs with short TTLs for recordings and attachments
- Field-level sensitivity: `activities.sensitive` today; classification tags on knowledge and custom fields later

### 3.4 Webhooks
Signature verification per provider, timestamp window, raw-body handling, idempotency table, organization resolved from provider resources, fast acknowledgement with queued processing (API_ARCHITECTURE §5).

### 3.5 Monitoring and response
- Error monitoring (Sentry) with PII scrubbing; structured logs with `organization_id`, `user_id`, `request_id`
- Alerts: authentication failure spikes, RLS denials (42501) spikes, webhook verification failures, AI action failure rate, provider error rates
- Supabase security and performance advisors run in CI after migrations
- Incident runbook: contain (rotate keys, suspend org), assess (audit log), notify (per breach-notification law), remediate, postmortem

### 3.6 Backups and continuity
- Supabase PITR (Pro plan) plus a daily logical backup to separate cloud storage, encrypted with a separate key
- Quarterly restore drill into a staging project; RPO ≤ 15 min, RTO ≤ 4 h targets
- Per-organization data export (CSV/JSON) for portability and suspension/offboarding

### 3.7 AI-specific threats (OWASP LLM Top 10 mapping)

| Threat | Mitigation |
|---|---|
| Prompt injection (direct and via CRM data, messages, reviews) | Policy-bounded writes; human approval by default; tool output labelled untrusted; no tool can exceed user RLS; per-turn caps |
| Excessive agency | Category policies default to approve/recommend/observe; `auto` requires an admin with explicit confirmation; every action audited |
| Sensitive data disclosure | `sensitive` timeline redaction; conversations private per user; provider data-retention settings (zero-retention where available) |
| Insecure output handling | Model output is rendered as text (no HTML); tool arguments validated twice (tool schema + service schema) |
| Model denial of service and cost | Per-user rate limit; step caps; token usage captured (`Completion.usage`) for metering in Phase 6 |
| Supply chain | Provider adapters isolated; models configurable; no plugins execute arbitrary code (marketplace bundles get signed manifests and scoped tool permissions in Phase 8) |

## 4. Compliance design

| Requirement | Design |
|---|---|
| **TCPA** | Prior express (written, for marketing) consent recorded per channel with source and evidence; no autodialed or AI-voice marketing calls or texts without it; quiet hours (8am–9pm recipient local time); immediate opt-out honoring; consent checked by the messaging layer on every send, not by callers |
| **A2P 10DLC** | `messaging_profiles` registry (brand, campaign, use case, sample messages); numbers bound to registered campaigns; throughput per tier; sends blocked for unregistered numbers |
| **CAN-SPAM** | Accurate headers; physical address footer; one-click `List-Unsubscribe`; opt-outs processed immediately (within the 10-business-day limit); suppression list per org |
| **Privacy (CCPA/CPRA, state laws, GDPR where applicable)** | Erasure (`erase_contact`), export, retention settings per org, data processing agreements with subprocessors, privacy notice templates for client sites |
| **Data deletion** | Erasure for contacts; organization closure → 30-day grace → hard delete with an audit record kept |
| **Communication logs** | Every message and call stored with consent snapshot, provider, status and timestamps; audit log immutable |
| **Review platform policies** | No review gating, no incentivized reviews, no fake reviews; AI responses never fabricate facts; private feedback offered alongside, never instead of, public review links |
| **Anti-spam posture** | Lead Finder outreach only to business contacts via compliant channels; no purchased consumer lists; per-org send limits and complaint-rate monitoring with automatic pause |

## 5. Immediate actions for the owner (before Phase 2)

1. Rotate the shared DB secret and fix S1 (runbook in IMPLEMENTATION_PLAN §6).
2. Create your personal Supabase Auth account, add it to `team_members`, enable MFA, and stop using the passcode for daily work.
3. Rotate the owner passcode (it is stored on the agent-worker machine in plaintext).
4. Turn on PITR backups.
