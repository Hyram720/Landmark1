# Ledger — credit dispute workspace

Ledger is a rebuild of the Ledger workspace (backup format v1). It is a credit repair business platform for personal and business clients that understands Metro 2 and builds in CROA and FCRA safeguards. It has a staff workspace, a client portal, a public onboarding form and a Node/Express backend, with no build step.

## Run it

**Full business setup (server, logins, client portal):**

```bash
npm install
LEDGER_ENCRYPTION_KEY='a long random secret' npm run ledger
```

Then open http://localhost:4100. The first visit creates the **owner** account.

| Address | Who uses it |
|---|---|
| `/` | You and your staff: the full workspace |
| `/portal` | Clients: e-sign the CROA disclosure and agreement, upload ID and bureau letters, follow disputes and scores, see recommendations, cancel within 3 days |
| `/apply` | Prospects: public onboarding form (personal, business or both). Every submission becomes a lead with a call task. Add `?ref=<source id>` to credit a referral source |
| `/pricing`, `/terms`, `/refund-policy`, `/privacy`, `/checkout` | Public business pages (files in `ledger/site/`). **Still DRAFT**: DRAFT banner + `noindex`, with phone (856) 655-7855, contact fred@myledgercredit.com and effective date October 21, 2026 filled in, until the owner approves publishing. `/checkout` is the enrollment flow ($0 due, pay after service); it submits to `/api/intake` as a lead and the agreement is signed in the portal. Payments are cards only (no eCheck). Billing enforces a 12-month term and a $1,188 total cap per client agreement (`Billing.capCheck`, checked again by the server on save) |
| `/go/<id>` | Tracked partner links: counts the click, then redirects to your affiliate link |
| `/go/partner/<key>` | Partner links with a hashed sub-ID per client/staff (metadata-only click log; report under Partners → Click report) |
| `/go/rent/<provider>` | Rent-reporting referrals (Boom, Credit Rent Boost, Self). A signed-in client’s click is stored, then the browser goes to the provider |
| `/go/credit/<provider>` | Credit-monitoring referrals (`myfreescorenow`, `smartcredit`). Same click record (client, provider, time), then the approved affiliate link |
| `/api/health` (`/healthz`) | Health check for Railway: status, uptime, build, encryption and storage |
| `/api/coach/:id`, `/api/portal/coach` | Business credit coach (staff; signed-in client sees only their own plan) — see docs/assistant-spec.md §10 |

**Master file (personal use, no login):** `ledger/dist/ledger-master.html` is the whole workspace in one file. Double-click it to open it in your browser. It needs no login and no server, and it saves everything in that browser. Use **Settings → Export backup** regularly, and keep the file and backups private. Rebuild it after changes with `npm run ledger:master`. The client portal, uploads, text/email sending and AI features need the server.

**Quick preview (no server):** open `ledger/index.html`, then choose **Settings → Load demo data**. Data stays in that browser, and logins, the portal, uploads and messaging are turned off.

### Server settings

| Variable | Purpose |
|---|---|
| `LEDGER_PORT` / `PORT` | Port (default 4100) |
| `LEDGER_DATA_DIR` | Where the database and uploaded files live (default `data/ledger`, which git ignores) |
| `LEDGER_ENCRYPTION_KEY` | Encrypts the database and every uploaded file with AES-256-GCM. **Set this in production and keep it safe** — the data can't be read without it |
| `LEDGER_RESEND_KEY` (or `RESEND_API_KEY`) + `LEDGER_EMAIL_FROM` | Sends client emails from the app through Resend. Without these, Email opens your mail app and logs the message |
| `ANTHROPIC_API_KEY` | Turns on **Ledger AI**, the built-in credit repair expert (Claude). Without it, the AI panel explains how to enable it |
| `LEDGER_SETUP_CODE` | Required to create the owner account on first visit, so nobody else can claim a freshly deployed server |
| `LEDGER_BOOTSTRAP_OWNER_EMAIL` + `LEDGER_BOOTSTRAP_OWNER_PASSWORD_HASH` | Owner recovery: on start, that email becomes an owner with that password (scrypt hash from `hashPassword()`, never the plain password). Creates the owner if missing or replaces an existing owner's password; never touches client/partner/staff accounts. Applied once per email+hash. Remove both after signing in. Optional `LEDGER_BOOTSTRAP_OWNER_NAME` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Sends texts through Twilio. Texts go only to clients with SMS consent on file (TCPA). Business texting also needs A2P 10DLC registration |
| `LEDGER_AI_ENABLED` + `OPENAI_API_KEY` | Turns on the OpenAI-backed Ledger Assistant, AI-polished Metro 2 letters and the website helper. Off unless `LEDGER_AI_ENABLED=true`. See `docs/assistant-spec.md` |
| `LEDGER_OPENAI_MODEL` | Model for the above (default `gpt-5-mini`) |
| `LEDGER_AI_LETTERS_PER_HOUR` | Abuse ceiling per staff user for AI letter polish (default 300); templates are always unlimited |
| `LEDGER_MAIL_MODE` | `off` (default), `console` (dev: prints emails to the log), `resend` or `smtp`. Needed for password-reset emails, magic links, sign-in codes and client update emails |
| `LEDGER_SMTP_URL` | SMTP connection URL when `LEDGER_MAIL_MODE=smtp` (needs the optional `nodemailer` package) |
| `LEDGER_BACKUPS` / `LEDGER_BACKUP_DAYS` | Daily encrypted DB snapshot in `<data dir>/backups` (on by default; `off` disables); days kept (default 14) |
| `LEDGER_TRUST_PROXY_HOPS` | Proxy hops in front of the app (default 1 for Railway); used for client IPs in rate limits |
| `LEDGER_SESSION_TTL_SECONDS` | Idle length of a normal sign-in (default 12 hours). Active requests renew it. Minimum 60 seconds, maximum 400 days |
| `LEDGER_REMEMBER_TTL_SECONDS` | Length when “Keep me signed in” is checked on `/app` (default 30 days). Never shorter than the normal session |
| `LEDGER_SESSION_ABSOLUTE_SECONDS` | Hard cap from the original sign-in for a normal session, even while it keeps renewing (default 7 days, never shorter than the idle length) |
| `LEDGER_REMEMBER_ABSOLUTE_SECONDS` | Hard cap for a “keep me signed in” session (default the remember length, so it ends 30 days after sign-in) |
| `LEDGER_RENT_BOOM_URL` | Where a Boom rent-reporting click goes (default `https://www.boompay.app/renters`, the consumer page). Set an https affiliate link later; anything else is ignored |
| `LEDGER_RENT_CRB_URL` | Where a Credit Rent Boost click goes (default `https://www.creditrentboost.com/`) |
| `LEDGER_RENT_SELF_URL` | Where a Self rent-reporting click goes (default `https://www.self.inc/rent-and-bills-reporting`) |
| `LEDGER_CREDIT_MFSN_URL` | Where a MyFreeScoreNow click goes (default `https://app.myfreescorenow.com/enroll/B04C9729`). The plan is $39.90/month after a 7-day trial. Only an https URL is used; anything else is ignored |
| `LEDGER_CREDIT_SMARTCREDIT_URL` | Where a SmartCredit click goes (default `https://www.smartcredit.com/?PID=72556`). Pricing is shown at sign-up. Only an https URL is used; anything else is ignored |

Deploy it like the main site: one Node service with a persistent volume mounted at `LEDGER_DATA_DIR`, served over HTTPS. Back up that volume.

On Railway, set the start command to `node ledger/server/index.js` (or `npm run ledger:start`; running node directly avoids npm's `production` config warning and the `npm error signal SIGTERM` lines on every redeploy) and the health check path to `/api/health`. The server shuts down gracefully on SIGTERM and flushes pending writes. Tests: `npm run test:ledger`.

## What's inside

**Day-to-day workflow (the M2Phenom-style tools):**
- **Client profiles:** search; filter by status and personal/business; select several for bulk email, export or tasks.
- **Row actions on each client:** **SMS**, **Email**, **Edit**, **Documents** and **Upload report**.
- **Client onboarding link:** a shareable `/apply` link, plus a tracked link for each referral source.
- **Upload report:** stores MyFreeScoreNow / IdentityIQ / SmartCredit report files (PDF/HTML), encrypted, then you enter tradelines by hand or by CSV. Automatic parsing of each provider's format needs sample exports.
- **Communication:** templates (welcome, report needed, ID and proof of address, round mailed, results, business next steps) and a per-client message log.
- **Send round:** print every approved letter in one batch, then mark them all mailed with deadlines and follow-up tasks.
- **Team & security:** owner and staff logins, invitations, an audit log, and client portal invitations.

**Ledger AI (built-in expert assistant):**
- Open it from **✦ Ledger AI** (bottom right) or **Ask AI** on any client.
- It reads the open client's reports, Metro 2 findings, cross-bureau differences, disputes, CROA status and business-credit setup.
- One-click prompts: explain the audit, plan the next round, draft a client update, build a 90-day rebuild plan, write a business credit plan. Also general questions: Metro 2 codes, marketing compliance review, consultation scripts.
- Guardrails: it separates provable errors from items the client must document and from accurate negatives, and it refuses mass disputes, CPNs and promised results. Identity theft disputes are out of scope; refer clients to IdentityTheft.gov. It also flags CROA problems it notices.
- Staff only. Runs on Claude Opus 5.5 with automatic fallback if a request is declined. Rate-limited to 60 questions per staff member per hour. Every question is logged in the audit trail (not the content).

**Uploading credit reports (Upload credit report button on the dashboard, client list and client page):**
- **✦ AI scan a file:** drag in one or more PDFs, saved web pages or screenshots from MyFreeScoreNow, IdentityIQ, SmartCredit or annualcreditreport.com. AI reads every account per bureau, and you review the table before importing.
- **✦ AI scan pasted text:** select all on the report page, copy, paste.
- **CSV import** and **manual entry**.
- **Ask the client to upload:** server mode. They upload in the portal, and you click Scan with AI in Documents.
- **Links to get a report:** MyFreeScoreNow ($39.90/month after a 7-day trial) and SmartCredit (pricing shown at sign-up) open through `/go/credit/…`, which records a signed-in client’s click. IdentityIQ stays on its own partner link. AnnualCreditReport.com is the no-charge weekly report. We may earn a commission on the paid plans. Clients do not have to use them.
- In the **master file**, AI scanning works with your own Anthropic API key (Settings → AI in this browser). The key stays in that browser and is never included in backups. This doesn't work inside a claude.ai preview link, which blocks outside connections.

**AI dispute engine:**
- **Scan with AI:** upload a MyFreeScoreNow, IdentityIQ or SmartCredit report (PDF, HTML or screenshot) and click **✦ Scan with AI** on the Documents tab. Claude reads every tradeline per bureau into Metro 2 fields, and you review the table before importing. The Metro 2 audit runs immediately.
- **AI plan next round:** on the Disputes tab, Claude reviews the reports, findings and dispute history and proposes the next round. That means which letters, to whom, for which items, at which strategy step, plus a list of accurate items *not* to dispute and a client update. You tick what to send, confirm the client agreed, and the drafts and letters are created.
- **Removal tracking:** whenever a newer report is imported (scanned, CSV or manual), Ledger compares it with the previous report from that bureau. Disputed items that disappeared are marked **Removed**, changed ones **Corrected**, and the rest **Still reporting**. Disputes close automatically, a task is created, and a ready-to-send "good news" text or email pops up. Clients see their results in the portal.
- **Strategy letters (Letter 1 → 2 → 3 → 4):**
  1. Bureau dispute (§ 611).
  2. Method of verification (§ 611(a)(7)) plus a direct dispute to the furnisher (§ 623).
  3. Final notice to the furnisher plus a CFPB complaint narrative.
  4. Attorney review (FCRA §§ 616–617).
  Each dispute shows where it stands, and **Draft Letter N** creates the next one.

**Letter templates and dispute sequences:**
- **Letter templates** (Library → Letter templates, or the button on any client's Disputes tab): 21 click-to-generate letters for judgments, evictions, student loans and collections. Answer a few questions; the letter is filled with the client's details and one letter is created per recipient.
- **Dispute sequences** (sidebar → Sequences): tick *Run as a sequence* on a template, or click *Run as sequence* on any dispute. Ledger drafts Letter 2 (method of verification + direct dispute to the furnisher), Letter 3 (final notice + CFPB complaint narrative) and an attorney-review task automatically when each step is due — when a response is recorded as verified, or the legal deadline plus mail time passes. Deleted or corrected items end their branch. *Preview all letters* shows every letter in the sequence in full. Each drafted letter still needs the client's confirmation and approval before it goes out in Send round.

**Running the business (added after the competitor review):**
- **One-click report import:** reports a client uploads in the portal are read by AI in the background and wait under *Credit reports → Ready to import*. The monthly re-pull automation asks active clients for a fresh report every ~35 days. (Pulling reports directly from IdentityIQ, MyFreeScoreNow or SmartCredit needs a partner agreement and API access from that provider.)
- **Mail online (Lob):** Settings → Print & mail. Approved letters are printed and mailed first-class, certified, or certified with return receipt, from the client's address, with photo ID and proof of address attached as pages. The tracking number, expected delivery and delivered date are saved, and the response deadline is counted from delivery. Test keys (`test_…`) never mail anything.
- **Online payments and automatic billing:** Billing → Automatic billing (per letter, pay per delete, or monthly after service). Invoices are created only for work already done and only after the cancellation period. Clients pay through a secure pay link on Authorize.net's hosted page (Settings → Online payments), or through your own payment link. Payments are matched automatically.
- **Side-by-side report comparison** on *Credit reports* (removed, changed and new accounts), plus a printable **monthly progress report** with a score chart.
- **Creditor address book** (Library → Creditor addresses): 71 researched dispute and correspondence addresses for banks, card issuers, auto lenders, student-loan servicers, collectors and specialty bureaus, each with a source link. Every address you type is saved and suggested next time.
- **Automations** (sidebar): emails, texts and tasks for new leads, follow-ups, signed agreements, missing reports, monthly re-pulls, mailed letters, removed items, overdue responses, invoices and monthly progress. Each rule fires once per event and never for events from before it was turned on.
- **Sales pipeline** (sidebar): lead stages, a 0–100 readiness score, a booking link, and a free **credit analysis** you can print for prospects.
- **Partner portal** (`/partner`): referral partners log in to get their sign-up link and see their referrals' stage and their commissions (flat per enrolled client, or a percentage of paid invoices). A client's progress is shown only if that client agreed to share it.
- **FCRA violation tracker** (sidebar): flags missed 30-day and 15-day deadlines, reinsertion without notice, accounts not marked disputed, and items reported past 7 years. It also prints an attorney packet with the timeline and every letter.
- **Buy a business** (client tab for business clients): open live BizBuySell listings by state, add target businesses, and work through a 24-point due-diligence checklist. It covers state standing, UCC liens, tax liens, judgments, PACER bankruptcy search, business credit reports, IRS transcripts (Form 8821), state tax clearance, financials, leases, licenses, contracts and deal structure, with links to the official searches. It also shows red flags and price-to-earnings multiples, and prints a report.
- **90-day business credit plan** (Business credit tab): dated steps from foundation and a free D-U-N-S Number through starter vendors that report, a credit-builder account, store/fleet accounts and a 90-day review. Each step becomes a task and completes automatically from the fundability checklist.
- **More letters:** unauthorized hard inquiries, wrong personal information, and authorized-user removal.

**Business credit:**
- Personal, business-only, or personal-plus-business clients.
- Business profile: entity, EIN last 4, NAICS, D-U-N-S, and more.
- A 14-point fundability checklist and a business score log covering PAYDEX, Intelliscore Plus, FSR, the Equifax Payment Index / Credit Risk / Failure scores, and FICO SBSS.
- Vendor (net-30) tradeline tracker with starter vendors, and business-bureau correction letters.
- Business-only work is outside CROA, so it isn't gated.

**Partner offers (referral income):**
- Researched programs for CreditStrong, CreditStrong Business, Nav, Credit Sesame, Self, Kikoff, IdentityIQ, MyFreeScoreNow, SmartCredit, MyScoreIQ, Experian Boost and D-U-N-S.
- Each program shows its bonus, network, cookie window, how well the terms were confirmed, and sources.
- Paste your affiliate link once. Then recommend offers to clients, share tracked links, and track stages (recommended → clicked → signed up → approved → paid) and the commissions you've earned.
- Recommendations appear in the portal with an FTC-style disclosure.

**Credit repair core:**

- **Dashboard.** Response deadlines, compliance alerts, outcomes, revenue, tasks and activity.
- **Clients.** Lead → onboarding → active pipeline, profile (SSN stored as last 4 only), score history and a printable progress report.
- **Credit reports.** One report per bureau, with tradelines stored as Metro 2 fields (status codes, 24-month payment grid, DOFD, ECOA, compliance condition, bankruptcy indicator). You can enter them by hand or import them from CSV.
- **Metro 2 audit.** Flags fields that contradict each other, compares each tradeline across bureaus, catches duplicate debts and dates obsolescence. It never flags an item just for being negative.
- **Disputes.** A pipeline board. Disputes are created from audit findings once the client confirms them. There are 9 statutory letter types, an approval gate, certified-mail tracking, 30/45-day and 4-business-day deadlines, outcomes, follow-up rounds, and a guard against frivolous repeat disputes.
- **Billing.** Invoices are tied to completed services. Ledger refuses to issue an advance fee (§ 1679b(b)) or bill during the cancellation window.
- **Compliance center.** Program checklist, per-client agreement status, records-retention dates, and printable § 1679c disclosure, agreement and duplicate Notice of Cancellation. It also has a checker that flags deceptive claims in letters and marketing copy.
- **Library.** Metro 2 code tables, dispute types and deadlines, bureau addresses, how the system works, and sources.
- **Referral sources** (brokers, realtors and others who send you clients), dark mode, and a mobile layout.

See [RESEARCH.md](RESEARCH.md) for the research behind each feature, with sources.

## Data & security

- **AI privacy:** every outbound AI call (Anthropic and OpenAI) goes through `server/redact.js`: SSN/ITIN, EIN, card/account numbers (last 4 kept), routing numbers, DOBs, emails, phones, street addresses and known names are masked, and a final guard refuses to send if an SSN or Luhn-valid card number remains. PDFs are text-extracted locally with `pdftotext` (poppler-utils) before redaction; images and scanned PDFs are never sent. See docs/assistant-spec.md §12.

In server mode everything is saved on your server:

- Passwords are hashed with scrypt.
- Sessions are signed HttpOnly cookies, and logins are rate-limited.
- Saves use version checks, so two people can't silently overwrite each other.
- The audit log records every save, login, signature, upload, download and referral click.
- The database and files are encrypted when `LEDGER_ENCRYPTION_KEY` is set.
- Only the last 4 digits of SSNs and EINs are stored.

In preview mode, data stays in the browser. The JSON-file database fits a small team on one server. Move `server/db.js` to Postgres when you outgrow it.

## Code layout

| File | Purpose |
|---|---|
| `js/metro2.js` | Metro 2 code tables, tradeline audit rules, cross-bureau comparison |
| `js/law.js` | Business days and holidays, CROA/FCRA deadlines, disclosure and cancellation text, claim checker |
| `js/letters.js` | Letter builder; refuses letters without a specific discrepancy |
| `js/store.js` | Workspace state, persistence, v1 → v2 migration, CROA status |
| `js/views.js`, `js/app.js`, `js/ui.js` | Pages, actions/modals, DOM helpers |
| `js/sample.js` | Synthetic demo workspace |
| `js/partners.js`, `js/business.js` | Partner program catalog; business-credit scores, checklist and vendors |
| `js/portal.js`, `portal.html`, `apply.html` | Client portal and public onboarding form |
| `server/` | Express API: auth, workspace sync, portal, e-sign, intake, uploads, messaging, tracked links, Ledger AI (`server/assistant.js`) |
| `js/assistant.js` | Ledger AI chat drawer |
| `js/disputereasons.js`, `kb/`, `js/kb.js` | Finding → dispute reason mapping, repeat/frivolous guard; versioned sourced knowledge base |
| `js/ledgerbot.js`, `js/helper.js` | Staff Metro 2 letters modal, Ledger Assistant chat, partner click report, sign-in settings; public/portal helper |
| `server/ledger-assistant.js`, `server/redact.js` | OpenAI assistant, letter drafting and helper (off by default); redaction |
| `server/client-auth.js`, `server/mailer.js` | Forgot/reset password, magic link, email sign-in code, client notifications; pluggable mailer (off by default) |
| `server/partner-links.js` | `/go/partner/:key` sub-ID redirect and click report |
| `server/rent.js` | `/go/rent/:provider` rent-reporting redirect and click counts |
| `server/credit-monitoring.js` | `/go/credit/:provider` MyFreeScoreNow and SmartCredit redirect and click counts |
| `docs/assistant-spec.md` | Assistant / letters / KB spec, guardrails, data flow, costs |

Tests: `npm run test:ledger`

*Ledger is workflow software, not legal advice. Before enrolling clients, confirm your state's registration and bond rules, and have counsel review your agreement.*
