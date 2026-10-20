# Ledger Assistant, Metro 2 letters and knowledge base — spec

Version: KB `2026-10-19.3` · spec written 2026-10-19 · branch `ledger-qa-2026-10-19`

This is not legal advice. Items marked **needs lawyer** must be confirmed by counsel before they are relied on in marketing or client-facing copy.

## 1. What it is

| Piece | Where | Who sees it | Needs AI? |
|---|---|---|---|
| Rules engine (Metro 2 / FCRA) | `js/metro2.js`, `js/disputereasons.js` | Staff | No |
| Knowledge base (versioned, sourced) | `kb/ledger-kb.json` → generated `js/kb.js` (`python3 kb/build-kb.py`) | Staff (cards + citations), AI grounding | No |
| Metro 2 letters ("unlimited") | `POST /api/letters/draft` · staff UI **✦ Metro 2 letters** on a client's Audit and Disputes cards (`js/ledgerbot.js`) | Staff | Optional polish |
| Ledger Assistant (staff chat) | `POST /api/assistant/staff` · floating **Ledger Assistant** button | Staff | Optional (offline rules summary otherwise) |
| Website/portal helper | `POST /api/assistant/public` · **Questions?** button on `/apply` and `/portal` (`js/helper.js`) | Prospects, clients | Optional (canned FAQ otherwise) |
| Partner links | `GET /go/partner/:key`, `GET /api/partners/clicks` (`server/partner-links.js`) | Everyone / staff report | No |

The older Anthropic-based **Ledger AI** (`server/assistant.js`, `ANTHROPIC_API_KEY`) is unchanged and still works alongside.

## 2. Switches and env vars (names only)

| Variable | Default | Effect |
|---|---|---|
| `LEDGER_AI_ENABLED` | off | Must be exactly `true` **and** `OPENAI_API_KEY` set for any OpenAI call |
| `OPENAI_API_KEY` | — | Read at runtime from the server environment only; never stored in the workspace, logs or responses |
| `LEDGER_OPENAI_MODEL` | `gpt-5-mini` | Model id for all three features |
| `LEDGER_AI_LETTERS_PER_HOUR` | 300 | Per-staff-user abuse ceiling for AI-polished letters. Above it the template letter is returned (letters stay unlimited) |

With AI off, every feature still works: letters come from the statutory templates, staff chat returns the rules-engine summary and deadlines, and the helper answers from the approved FAQ.

## 3. Data flow and privacy

1. **Letters:** browser → `/api/letters/draft` with `{clientId, recipient, items:[{accountId, code}], letterType?, newEvidence?}`.
   - Server recomputes the rules-engine suggestions for that client. Every requested item must match one (**no letter without an identified inaccuracy** → 400).
   - `checkRepeat` blocks pending duplicates, items already deleted/corrected, and near-identical repeats after a "verified" result unless it is an escalation letter (MOV § 611(a)(7), direct § 623 / Reg V 1022.43, final notice, CFPB) or new evidence is supplied (→ 409 with reasons). More than 6 items warns (template-spam risk).
   - `Letters.build` produces the letter. If AI is on, **only the body between "Re:" and "Sincerely,"** is sent, after `redact()` (SSN, EIN, labelled DOB, emails, phones, routing and card/account numbers → `****1234`). The header (name, address, DOB, SSN last 4) and signature never leave the server.
   - Output is rejected and the template used if it is empty, contains promise/guarantee language (BANNED + `Law.lintText`), or drops an account reference.
   - The response carries `citations` (KB ids, statute, URL), `warnings`, `lint`, `requiresApproval: true`. The browser saves it as a **draft** dispute; mailing through Lob still requires the existing staff **Approve** step.
2. **Staff chat:** last 12 messages, each redacted, plus a redacted client digest (no name/contact; findings, deadlines with days left, dispute history, suggestions) and the full KB digest as the system prompt.
3. **Public helper:** the visitor's question only (redacted). No client file, ever. 20 questions per browser session per hour (`ledger_helper` cookie) and 60 per IP per hour; then a hand-off message.
4. **Logging:** audit entries hold metadata only — actor, feature, client id, mode (template/ai/offline/faq), token counts, fallback flag. Never prompt or answer text.

## 4. Guardrails (system prompt rails, enforced in code where possible)

- Never promise or predict deletions, score changes or approval timelines ("may", not "will").
- Not a lawyer/CPA; flags questions that need one.
- Only disputes items with a specific inaccuracy, obsolescence, or a consumer-asserted inaccuracy with an explanation (`[CONFIRM with the client …]` markers stay in the letter until staff confirm).
- Never suggests CPNs, new identities, EIN-for-SSN, mass/template disputes or untrue statements.
- Identity theft disputes are out of scope; refer clients to IdentityTheft.gov.
- CROA: no fees before services are fully performed; written contract; 3-business-day cancel; § 1679c disclosure.
- Business credit is mostly outside the FCRA; uses each business bureau's own dispute path.
- Buying a company: misrepresenting time in business or another company's history to a lender can be bank fraud (18 U.S.C. §§ 1014, 1344). No "instant fundable" or "aged corp" claims.
- Partner products are optional, never a condition of service, and always carry the FTC affiliate disclosure.
- Every legal statement cites a KB id in brackets, e.g. `[fcra-611]`, which the UI links to the source.

## 5. Knowledge base (44 rules, each with cite, URL, verifiedAt)

**PERSONAL** — FCRA §§ 605 (obsolescence 7/10 years, DOFD + 180 days), 609/612 (file disclosure, free weekly reports), 611 (30 days, 45 with consumer-supplied info during the period; 5-business-day notice to furnisher), 611(a)(3) frivolous, 611(a)(6)-(7) method of verification (15 days), 611(a)(5)(B) reinsertion (5 business days' notice), 623 furnisher duties incl. (a)(5) DOFD; Reg V 12 CFR 1022.43 direct disputes; FDCPA § 809 / Reg F 1006.34 validation; FCBA / Reg Z 1026.13 (60 days); ECOA / Reg B 1002.9 adverse action; Metro 2 CRRG fields (status 17A, payment history 18, CCC 20 incl. XB/XC/XH, DOFD 25); score building (utilization, authorized users, goodwill without false statements).

**COMPLIANCE** — CROA §§ 404(a) misrepresentation, 404(b) advance fees (+ TSR 310.4(a)(2) for phone sales), 405 disclosure, 406 contract (incl. the bold cancel statement next to the signature), 407-408 cancellation and no waiver; FTC Endorsement Guides (affiliate disclosure); TCPA for texts; **NJ** — no stand-alone credit services statute found; NJ DCA points consumers to CROA; N.J.S.A. 17:16G (debt adjustment) and the NJ Consumer Fraud Act may apply depending on the service mix (**needs lawyer**).

**BUSINESS** — FCRA mostly does not cover business-entity reports (§ 603 definitions); dispute paths: D&B D-U-N-S Profile Manager / iUpdate, Experian business (BusinessDisputes@Experian.com), Equifax business support; SBFE is a lender data exchange, not a bureau; Reg B 1002.9(a)(3) business adverse action; CFPB § 1071 status (revised final rule May 1, 2026, effective June 30, 2026; earliest compliance Jan 1, 2028 for lenders with 1,000+ covered originations in each of 2026 and 2027; "small business" ≤ $1M revenue); EIN/DUNS/net-30 building; personal guarantees put the owner's personal credit at risk.

**BUY A CORPORATION** — stock vs. asset purchase (liabilities follow the entity in a stock deal; **needs lawyer**); diligence (good standing, liens/UCC, judgments/PACER, IRS Form 8821 transcripts, existing tradelines); ownership-change filings (IRS 8822-B, D&B update); FinCEN BOI: the 2026 final rule exempts domestic companies and U.S. persons from BOI reporting (31 CFR 1010.380); fraud warning (**needs lawyer**).

Maintenance: edit `kb/ledger-kb.json`, bump `version`, update `verifiedAt` per rule, run `python3 kb/build-kb.py`, commit both files.

Identity theft: Identity theft disputes are out of scope; refer clients to IdentityTheft.gov.

## 6. Rules engine additions (v2)

New Metro 2 checks: paid/closed with past-due (`M2-PAID-PASTDUE`), DOFD in the future, DOFD on a current account, re-aging (DOFD later than the payment grid implies, > 62 days), collection without original creditor, stale XB after the dispute closed, obsolete-without-DOFD, duplicate collections for the same original debt, and over-time checks (DOFD moved between reports, deleted item reinserted). Findings that are informational only (`NOT_DISPUTABLE`) never produce a letter.

## 7. Cost estimates (verify current OpenAI pricing)

Assumes `gpt-5-mini` at about **$0.25 per 1M input tokens and $2.00 per 1M output tokens** (reasoning tokens bill as output). Measured prompt sizes: full KB ≈ 4,000 tokens; public KB slice ≈ 2,100 tokens.

| Use | Tokens per call (in / out incl. reasoning) | Per call | Typical unit |
|---|---|---|---|
| AI-polished letter | ~1,200 / ~1,000–3,000 | ~$0.002–0.006 | **≈ $0.005 per letter** |
| Staff chat turn | ~5,500–8,000 / ~1,000–2,500 | ~$0.004–0.007 | **≈ $0.03–0.06 per 8-turn conversation** |
| Website/portal helper | ~2,800 / ~400–1,200 | ~$0.001–0.003 | **≈ $0.01 per 5-question visit** |

Prompt caching (repeat system prompts) can lower input cost further. At 1,000 letters a month that is about $5.

## 8. Changes in this spec (vs. the previous assistant)

- Added the OpenAI provider behind `LEDGER_AI_ENABLED` (off by default) next to the existing Anthropic Ledger AI.
- Grounded on a versioned, sourced KB with three sections (personal, business, buy-a-corp) plus compliance and Metro 2; answers cite KB ids.
- Redaction before any model call; header/signature kept local for letters; metadata-only audit logging.
- Letters only for engine-identified (or client-documented) inaccuracies; repeat/frivolous guard; staff approval before mailing.
- Client-facing helper on `/apply` and `/portal` with FAQ fallback, per-session/IP rate limits and staff hand-off.
- Partner recommendations always carry the affiliate disclosure and are never required.
- Empty or unsafe model output always falls back to the template/FAQ.
