# Implementation Plan

## 1. Phase 1 — what was built

Everything is **additive**. Existing pages, routes, tables and the passcode login keep working unchanged.

| Area | Files |
|---|---|
| Database | `supabase/migrations/20261006120000_phase1_tenancy_crm_ai.sql` |
| DB security tests | `supabase/tests/supabase_stub.sql`, `supabase/tests/phase1_rls.test.sql`, `scripts/test-db.sh` |
| Sessions | `src/lib/session-cookies.ts`, `src/middleware.ts`, `src/app/api/login/route.ts`, `src/app/api/logout/route.ts` |
| Tenant framework | `src/lib/tenant/{session,api,rbac,audit}.ts` |
| CRM domain | `src/lib/crm/{service,scoring}.ts` |
| AI layer | `src/lib/ai/{types,provider,openai}.ts` |
| AI operator | `src/lib/command/{engine,tools,policy,actions}.ts` |
| API | `src/app/api/tenant/**`, `src/app/api/crm/**`, `src/app/api/command/**` |
| UI | `src/app/command-center`, `src/app/crm`, `src/app/crm/contacts/[id]`, `src/app/organization`, `src/components/tenant/*`, nav in `src/components/Shell.tsx`, AI key note in `src/app/settings/page.tsx` |
| Unit tests | `tests/unit/*.test.ts`, `tests/support/*`, `vitest.config.mts` |

New dependencies: `zod` (runtime), `vitest` (dev).

## 2. Deploying Phase 1

> Do these in order. Steps 2–4 take about 15 minutes.

1. **Back up** the production database (Dashboard → Database → Backups), or confirm PITR is on.
2. **Apply the migration.** It runs in one transaction and creates only new objects:
   ```bash
   supabase link --project-ref zsikcyixfvvepzqbgocw
   supabase db push            # or paste the file into the SQL editor
   ```
   Then run Dashboard → Advisors → Security and confirm there are no new findings.
3. **Configure Supabase Auth:** Authentication → Providers → Email: **disable public sign-ups** for now (accounts are invite-only until Phase 1b invitations). Set the JWT expiry to 3600 s (the default).
4. **Create your owner account:** Authentication → Users → *Add user* (your email and a strong password). Then, in the SQL editor:
   ```sql
   insert into public.team_members (user_id, email, display_name, role, active)
   select id, email, 'Owner', 'owner', true from auth.users where email = 'YOUR_EMAIL'
   on conflict (user_id) do update set active = true, role = 'owner';
   ```
5. **Deploy the app** (merge to `main`; Netlify builds as usual). No new required environment variables. Optional:
   | Variable | Default | Purpose |
   |---|---|---|
   | `AI_COMMAND_MODEL` | `gpt-4.1-mini` | OpenAI model for the operator (any tool-calling chat model your key can use) |
   | `AI_PROVIDER` | `openai` | Reserved for future adapters |
   | `AGENT_WORKER_TOKEN` | unset | ≥32 random characters (`openssl rand -hex 24`). Put the same value in the worker's `.env.local` as `SUN_WORKER_TOKEN`, then remove `SUN_CONSOLE_PASSCODE` from it |
   | `AUTOMATION_SECRET` | existing | Now actually used: the 15-minute follow-up scheduler was previously blocked by the login gate (SECURITY_PLAN S15). Production had 0 queued `interactions`, so nothing old will be sent |
6. **Sign in** at `/login` → *Team account*. Open **AI Command Center**, create your agency workspace, then use **Organization → Import prospects** to bring the 63 existing businesses into the CRM.
7. **Connect AI:** Settings → *OpenAI (AI Command Center & images)*. This is the same encrypted key used for images.
8. **Smoke test:** ask the operator "Summarize my pipeline", then "Create a follow-up task to call Acme tomorrow at 10am". The task appears under *Needs approval*. Approve it and confirm it shows in CRM → Tasks and in the audit trail.
9. **Client sub-account test:** Organization → *Client accounts* → create one; add a second test user as its owner; sign in as that user and confirm they see only that client.

### Rollback
The application change is safe to revert (the legacy modules don't depend on new tables). To remove the schema:
```sql
begin;
drop table if exists public.ai_actions, public.ai_messages, public.ai_conversations, public.ai_policies,
  public.activities, public.tasks, public.opportunities, public.pipeline_stages, public.pipelines,
  public.consents, public.custom_field_definitions, public.contacts, public.companies,
  public.audit_log, public.memberships, public.locations, public.organizations cascade;
drop function if exists public.import_legacy_businesses(uuid), public.erase_contact(uuid),
  public.add_member_by_email(uuid,text,text), public.create_organization(text,text,uuid),
  public.seed_organization_defaults(uuid), public.log_audit(uuid,text,text,text,jsonb,text),
  public.my_organizations(), public.can_manage_owners(uuid), public.has_org_role(uuid,text),
  public.org_rank(uuid), public.role_rank(text), public.tg_set_updated_at() cascade;
commit;
```

## 2b. Deploying Phase 2 (communications)

1. Apply `supabase/migrations/20261007120000_phase2_communications.sql` (additive, one transaction).
2. Set server environment variables:
   | Variable | Purpose |
   |---|---|
   | `APP_ENCRYPTION_KEY` | 32+ random characters (`openssl rand -base64 48`). Seals provider credentials. Back it up: credentials saved with it cannot be read without it |
   | `SUPABASE_SERVICE_ROLE_KEY` | Lets verified webhooks and the scheduler write replies, receipts and opt-outs. Server-only |
   | `PUBLIC_APP_URL` | e.g. `https://console.yourdomain.com`; used for delivery callbacks and Twilio signature checks |
3. Redeploy. The existing 15-minute scheduler now also calls `/api/comms/dispatch`.
4. In **Channels**, connect a number (Telnyx: API key + webhook public key; Twilio: Account SID + auth token) and press **Test**. Paste the shown webhook URL into the provider's inbound settings.
5. US business texting requires an approved A2P 10DLC brand and campaign at the provider; register before sending at volume.
6. Smoke test: record SMS consent on a test contact (yourself), send a text from **Conversations**, reply from your phone, then text STOP and confirm the inbox shows the reply and the contact's consent shows *Revoked*.

Rollback: `drop table public.messages, public.conversations, public.suppressions, public.webhook_events, public.provider_accounts cascade;` then drop `provider_secret`, `apply_opt_out`, `clear_opt_out`, `tg_messages_guard`, `tg_messages_timeline`.

## 2c. Deploying Phase 3 (reputation, calendars, automations)

1. Apply `supabase/migrations/20261008120000_phase3_reputation_calendars_workflows.sql`. It enables `btree_gist` in the `extensions` schema, is additive, and runs in one transaction.
2. No new environment variables. Phase 2's `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_APP_URL` and `APP_ENCRYPTION_KEY` are required for public booking, review links, reminders, automations and signed webhooks. Each feature shows "Integration not configured" when one is missing.
3. Redeploy. The 15-minute scheduler now also calls `/api/jobs/tick`. Automation waits and reminders therefore resolve to within 15 minutes; call `/api/jobs/tick` more often from an external cron if you need tighter timing.
4. In **Reputation → Review sites**, add your Google review link. In **Calendars**, create a calendar with members and switch on online booking. In **Automations**, start from a template, save it, then switch it on as a manager.
5. Smoke test:
   - Book yourself through `/book/<slug>` with the SMS box ticked.
   - Confirm the agenda shows the booking, a confirmation arrives, and the manage link can reschedule it.
   - Mark a past appointment *No-show* with the No-show recovery template switched on. Within 15 minutes the run appears under the automation, with its text and task.
   - Send yourself a review request, rate 2 stars, and confirm a follow-up task appears and the Google button still works.

Rollback: `drop table public.workflow_run_logs, public.workflow_runs, public.workflows, public.workflow_versions, public.appointments, public.calendar_members, public.calendars, public.review_requests, public.reviews, public.review_sources, public.domain_events cascade;` Then drop the functions `emit_event` and `review_request_respond`, the triggers `contacts_created_events`, `contacts_changed_events`, `opportunities_stage_event` and `messages_received_event`, and the `calendar` value from the `ai_policies` check (delete those rows first).

## 2d. Deploying Phase 4 (Lead Finder)

1. Apply `supabase/migrations/20261009120000_phase4_lead_engine.sql` (additive, one transaction).
2. No new environment variables. Sending needs an email sender in **Channels** (Resend with a verified domain), `APP_ENCRYPTION_KEY` and `PUBLIC_APP_URL`. Background audits need `SUPABASE_SERVICE_ROLE_KEY`.
3. In **Lead Finder → Outreach settings**, an admin enters the sender name and a real postal address (street or registered PO box). Sending is refused until this is set.
4. Use a separate sending subdomain for outreach (for example `hello.youragency.com`) with SPF, DKIM and DMARC, and keep the default daily limit until the domain has a sending history.
5. Smoke test:
   - Search a business type in your city and audit a few websites.
   - Add yourself as a business with your work email, draft an email and send it.
   - Click the unsubscribe link, and confirm the prospect shows *Do not contact* and that a second send is refused.

Rollback: `drop table public.outreach_messages, public.prospect_audits, public.prospects, public.prospect_searches cascade;` then drop the functions `outreach_unsubscribe` and `outreach_unsubscribe_token`.

## 3. Development workflow

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm test             # unit tests (vitest)
npm run test:db      # applies migrations to a throwaway local PostgreSQL 15+ and runs the RLS tests
npm run build
```

`test:db` needs PostgreSQL binaries (`apt install postgresql` or set `PGBIN`). It emulates Supabase's `anon`, `authenticated` and `service_role` roles and `auth.uid()`.

**Definition of done for every new feature:** loading, empty and error states; Zod validation; RBAC permission; organization-scoped queries; audit entries for mutations; RLS + SQL tests for new tables; unit tests for domain logic; "Integration not configured" with a settings link for missing providers; a mobile check; an AI tool when the feature is an action a user would delegate.

## 4. Phase 1b backlog

Done in part 1 (patch `0003`): S5, S7, S9, S10, S11, S15; S6, S8 and S12 partially; CI (typecheck, unit, SQL tests, build, gitleaks). Remaining, in priority order:

1. **S1/S2 secret rotation** (§6 runbook) — urgent
2. Baseline migration of the live schema; CI drift check
3. `SUPABASE_SERVICE_ROLE_KEY` + `src/lib/supabase/system.ts` for jobs; worker token for the local agent (S10)
4. GitHub Actions: typecheck, lint, unit, SQL tests, build; gitleaks
5. MFA enrolment UI and `aal2` enforcement for admin actions
6. JWKS verification in middleware (S13); DB-backed login limiter (S5)
7. Legacy hardening: role checks (S6), settings allow-list (S7), public endpoint limits (S8), SSRF fixes (S9), constant-time compare (S11), CSP (S12)
8. Member invitations by email; custom-field editor UI; CSV import/export for contacts
9. Global dark-theme text color fix and mobile navigation redesign

## 5. Phase 2 work breakdown (communications)

| Step | Deliverable |
|---|---|
| 2.1 | `provider_accounts`, `phone_numbers`, `messaging_profiles`, `suppression_list`; Settings → Integrations per org with "Integration not configured" states |
| 2.2 | `lib/telephony` + `lib/email` interfaces; Telnyx, Twilio and Resend adapters (port existing code); router with health and price ranking |
| 2.3 | Compliance gate (`canSend(contact, channel, purpose)`): consent, quiet hours, suppression, 10DLC status, frequency caps; unit-tested exhaustively |
| 2.4 | `conversations` / `messages`; webhook ingress standard; inbound → contact match → timeline |
| 2.5 | Unified Inbox UI (assignment, templates, scheduling, AI-drafted replies) |
| 2.6 | Operator tools `draft_message`, `send_message`, `schedule_message` under the `messaging` policy |
| 2.7 | Voice: `voice_agents`, `calls`; Vapi adapter (existing) + direct Telnyx Call Control with ElevenLabs/Cartesia/OpenAI voice adapters; missed-call text-back; receptionist migration |
| 2.8 | Outbox + queue workers; retire the Netlify cron; migrate `email_contacts`, `studio_contacts`, `interactions` |
| 2.9 | Navigation restructure to the target IA |

## 6. Runbook: rotate the shared DB secret (S1/S2)

> Plan a 15-minute window. Legacy modules fail closed during steps 3–4.

1. Generate two new random values: `NEW_DB_SECRET` and `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`).
2. Ship a code change that decrypts `app_secrets` with the old derivation and re-encrypts with `APP_ENCRYPTION_KEY` (ciphertext version `v2`), keeping `v1` read support.
3. Store the new DB secret in Vault and change the function so the value is no longer in the schema:
   ```sql
   select vault.create_secret('<NEW_DB_SECRET>', 'app_db_secret');
   create or replace function public.app_secret_ok() returns boolean
   language sql stable security definer set search_path = '' as $$
     select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-app-secret', '')
          = (select decrypted_secret from vault.decrypted_secrets where name = 'app_db_secret')
   $$;
   revoke execute on function public.app_secret_ok() from public;
   grant execute on function public.app_secret_ok() to anon, authenticated;
   ```
   Run this in the SQL editor, not as a committed migration, so the value never lands in a file or the migration history.
   Policies written as `using (app_secret_ok())` may evaluate the function once per row; rewrite them as `using ((select public.app_secret_ok()))` (several already are) so the Vault lookup runs once per statement.
4. Update `APP_DB_SECRET` in the host environment and redeploy.
5. Run the re-encryption step; verify Settings shows each provider as connected.
6. Rotate the provider keys stored in `app_secrets` (Google Places, OpenAI, Resend) at each provider, since the old encryption root was exposed.
7. Rotate `APP_PASSCODE` (it is also on the agent-worker machine).

## 7. Third-party services and credentials (now and later)

| Service | Purpose | Credentials | Needed by | Status |
|---|---|---|---|---|
| Supabase | DB, Auth, Storage, Realtime, Vault, Queues | `SUPABASE_URL`, `SUPABASE_KEY` (anon), **`SUPABASE_SERVICE_ROLE_KEY`** (1b) | Now | Configured (service key to add) |
| Netlify *or* Vercel | Hosting, env, cron (until queues) | Host account | Now | Netlify in use |
| OpenAI | AI operator, images, voice (optional) | `OPENAI_API_KEY` or Settings; `AI_COMMAND_MODEL` | Phase 1 | Image key may exist; verify model access |
| Additional LLM provider (e.g. Anthropic) | Model choice/failover | API key | Phase 2+ | Optional |
| Telnyx | SMS/MMS, voice, numbers (primary) | API key, public key (webhooks), messaging profile, numbers | Phase 2 | Partially configured (Campaign Studio) |
| Plivo | SMS/voice (secondary) | Auth ID + token | Phase 2 | — |
| Twilio | Fallback SMS/voice | Account SID, auth token, numbers | Phase 2 | Legacy env vars |
| The Campaign Registry (via CPaaS) | A2P 10DLC brand and campaign registration | Through Telnyx/Twilio | Phase 2 | — |
| ElevenLabs | Voice synthesis | API key | Phase 2 | — |
| Cartesia | Voice synthesis (low latency) | API key | Phase 2 | — |
| Vapi | Existing voice orchestration (to be one adapter) | API key, assistant/phone IDs, webhook secret | Phase 2 | Configured |
| Resend | Transactional and marketing email | API key, verified sending domains | Phase 2 | Configured |
| Amazon SES or Postmark | Email (secondary) | Keys, domains | Phase 2 | — |
| Google Business Profile API | Review monitoring and replies | OAuth client, approved API access | Phase 3 | — |
| Meta Graph API | Facebook reviews, Pages, social posting, Ads | App ID/secret, approved permissions | Phase 3/7 | — |
| Google Calendar API, Microsoft Graph | Calendar sync | OAuth clients | Phase 3 | — |
| Google Places API | Lead Finder | API key | Phase 4 | Configured |
| Yelp Fusion | Reputation and lead data | API key | Phase 4 | Optional |
| PageSpeed Insights API | Speed audits at scale | API key | Phase 4 | — |
| Stripe | Proposals now; Billing, Connect for rebilling | Secret/restricted key, webhook secret, Connect settings | Phase 6 | Configured for proposals |
| Domain/SSL for white-label | Custom domains | Host domain API (Netlify/Vercel) or Cloudflare for SaaS | Phase 6 | — |
| Google Ads API | Ads and attribution | Developer token, OAuth, MCC | Phase 7 | — |
| Meta Marketing API | Ads and attribution | App + system user token | Phase 7 | — |
| LinkedIn, TikTok, X, Instagram APIs | Social publishing | Per-platform app approval | Phase 7 | — |
| Sentry | Error monitoring | DSN, auth token | Phase 1b | — |
| Upstash Redis (optional) | Rate limiting / cache | REST URL + token | Phase 1b | Optional |
| Inngest (optional, if not Supabase Queues) | Durable workflows/jobs | Event and signing keys | Phase 2 | Decide in 2.8 |

## 8. Decisions needed from the owner

1. **Hosting:** stay on Netlify (works today) or move to Vercel as the spec prefers. Recommendation: decide before Phase 2.8; nothing in Phase 1 depends on it.
2. **Job runner:** Supabase Queues (fewer vendors) vs. Inngest (richer workflow tooling). Recommendation: Supabase Queues + a small worker for Phase 2; revisit for Phase 3 workflows.
3. **Default AI model** and whether to enable zero-data-retention with the provider.
4. **Primary telephony provider** for new numbers (recommend Telnyx: already integrated, cost-effective, ed25519-signed webhooks).
5. **Legacy passcode sunset date** once owner MFA is in place.
