# Ledger — credit dispute workspace

Ledger is a rebuild of the Ledger workspace (backup format v1). It is a credit dispute workspace that understands Metro 2 and builds in CROA and FCRA safeguards. It runs entirely in the browser with no build step and no server.

**Open it:** double-click `ledger/index.html`, or serve the folder (`python3 -m http.server -d ledger 8080`) and visit http://localhost:8080. To explore, choose **Settings → Load demo data**. Every name, number and address in the demo is fictional.

**Bring your old data:** go to **Settings → Import backup** and pick your `ledger-workspace-backup.json`. A v1 backup is upgraded automatically: clients, reports, letters and activity carry over, and each v1 letter becomes a round-1 dispute so its deadline can be tracked.

## What's inside

- **Dashboard.** Response deadlines, compliance alerts, outcomes, revenue, tasks and activity.
- **Clients.** Lead → onboarding → active pipeline, profile (SSN stored as last 4 only), score history and a printable progress report.
- **Credit reports.** One report per bureau, with tradelines stored as Metro 2 fields (status codes, 24-month payment grid, DOFD, ECOA, compliance condition, bankruptcy indicator). You can enter them by hand or import them from CSV.
- **Metro 2 audit.** Flags fields that contradict each other, compares each tradeline across bureaus, catches duplicate debts and dates obsolescence. It never flags an item just for being negative.
- **Disputes.** A pipeline board. Disputes are created from audit findings once the client confirms them. There are 9 statutory letter types, an approval gate, certified-mail tracking, 30/45-day and 4-business-day deadlines, outcomes, follow-up rounds, and a guard against frivolous repeat disputes.
- **Billing.** Invoices are tied to completed services. Ledger refuses to issue an advance fee (§ 1679b(b)) or bill during the cancellation window.
- **Compliance center.** Program checklist, per-client agreement status, records-retention dates, and printable § 1679c disclosure, agreement and duplicate Notice of Cancellation. It also has a checker that flags deceptive claims in letters and marketing copy.
- **Library.** Metro 2 code tables, dispute types and deadlines, bureau addresses, how the system works, and sources.
- **Referral partners**, dark mode, and a mobile layout.

See [RESEARCH.md](RESEARCH.md) for the research behind each feature, with sources.

## Data & security

All data is stored in the browser's `localStorage` on the device in use. Export backups regularly from Settings, and keep the backup files encrypted, because they contain personal information. Using Ledger with more than one staff member or across devices needs a backend with authentication and encrypted storage. The `Store` module in `js/store.js` is the single place to swap in that persistence.

## Code layout

| File | Purpose |
|---|---|
| `js/metro2.js` | Metro 2 code tables, tradeline audit rules, cross-bureau comparison |
| `js/law.js` | Business days and holidays, CROA/FCRA deadlines, disclosure and cancellation text, claim checker |
| `js/letters.js` | Letter builder; refuses letters without a specific discrepancy |
| `js/store.js` | Workspace state, persistence, v1 → v2 migration, CROA status |
| `js/views.js`, `js/app.js`, `js/ui.js` | Pages, actions/modals, DOM helpers |
| `js/sample.js` | Synthetic demo workspace |

Tests: `npm run test:ledger`

*Ledger is workflow software, not legal advice. Before enrolling clients, confirm your state's registration and bond rules, and have counsel review your agreement.*
