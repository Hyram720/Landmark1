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
| `/go/<id>` | Tracked partner links: counts the click, then redirects to your affiliate link |

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
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Sends texts through Twilio. Texts go only to clients with SMS consent on file (TCPA). Business texting also needs A2P 10DLC registration |

Deploy it like the main site: one Node service with a persistent volume mounted at `LEDGER_DATA_DIR`, served over HTTPS. Back up that volume.

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
- Guardrails: it separates provable errors from items the client must document and from accurate negatives, and it refuses mass disputes, CPNs, false identity-theft claims and promised results. It also flags CROA problems it notices.
- Staff only. Runs on Claude Opus 5.5 with automatic fallback if a request is declined. Rate-limited to 60 questions per staff member per hour. Every question is logged in the audit trail (not the content).

**Uploading credit reports (Upload credit report button on the dashboard, client list and client page):**
- **✦ AI scan a file:** drag in one or more PDFs, saved web pages or screenshots from MyFreeScoreNow, IdentityIQ, SmartCredit or annualcreditreport.com. AI reads every account per bureau, and you review the table before importing.
- **✦ AI scan pasted text:** select all on the report page, copy, paste.
- **CSV import** and **manual entry**.
- **Ask the client to upload:** server mode. They upload in the portal, and you click Scan with AI in Documents.
- **Links to get a report:** monitoring partners and the free AnnualCreditReport.com.
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

Tests: `npm run test:ledger`

*Ledger is workflow software, not legal advice. Before enrolling clients, confirm your state's registration and bond rules, and have counsel review your agreement.*
