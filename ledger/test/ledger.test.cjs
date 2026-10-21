// Run: node --test ledger/test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Set, Error, URLSearchParams };
ctx.globalThis = ctx;
vm.createContext(ctx);
['law.js', 'partners.js', 'business.js', 'library.js', 'metro2.js', 'results.js', 'letters.js', 'templates.js', 'sequences.js', 'furnishers.js', 'violations.js', 'billing.js', 'automations.js', 'sales.js', 'reports.js', 'invoices.js', 'acquisition.js', 'store.js', 'sample.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f }));
const { Law, Metro2, Letters, Store, Sample, Partners, Business, Results, Library, Templates, Sequences, Furnishers, Violations, Billing, Automations, Sales, Reports, Invoices, Acquisition } = ctx;
const codes = (t, today) => Metro2.auditTradeline(t, { today: today || '2026-10-14' }).map(f => f.code);

test('current account with past-due amount is flagged', () => {
  assert.ok(codes({ status: '11', balance: 240, pastDue: 75 }).includes('M2-CURRENT-PASTDUE'));
  assert.ok(!codes({ status: '11', balance: 240, pastDue: 0 }).includes('M2-CURRENT-PASTDUE'));
});

test('paid account with balance and past due greater than balance', () => {
  assert.ok(codes({ status: '13', balance: 10 }).includes('M2-PAID-BALANCE'));
  assert.ok(codes({ status: '71', balance: 100, pastDue: 150, dofd: '2026-01-01' }).includes('M2-PASTDUE-GT-BAL'));
});

test('derogatory account requires a DOFD', () => {
  assert.ok(codes({ status: '97', balance: 500 }).includes('M2-DOFD-MISSING'));
  assert.ok(!codes({ status: '97', balance: 500, dofd: '2024-01-01', chargeOff: 500 }).includes('M2-DOFD-MISSING'));
});

test('accurate negative item is not flagged as an error', () => {
  const f = Metro2.auditTradeline({ status: '97', balance: 500, pastDue: 500, chargeOff: 500, dofd: '2023-01-01', opened: '2020-01-01', paymentHistory: 'LLLL' }, { today: '2026-10-14' });
  assert.strictEqual(JSON.stringify(f.filter(x => x.severity === 'high').map(x => x.code)), '[]');
});

test('obsolescence is 7 years after DOFD + 180 days', () => {
  assert.strictEqual(Metro2.obsolescenceDate('2018-11-01').toISOString().slice(0, 10), '2026-04-30');
  assert.ok(codes({ status: '97', balance: 1, dofd: '2018-11-01', chargeOff: 1 }).includes('FCRA-OBSOLETE'));
  assert.ok(!codes({ status: '97', balance: 1, dofd: '2019-06-01', chargeOff: 1 }).includes('FCRA-OBSOLETE'));
});

test('payment history mismatch and bankruptcy balance', () => {
  assert.ok(codes({ status: '11', paymentHistory: '1000' }).includes('M2-HISTORY-MISMATCH'));
  assert.ok(!codes({ status: '11', paymentHistory: 'E000' }).includes('M2-HISTORY-MISMATCH'));
  assert.ok(codes({ status: '13', balance: 0, cii: 'E' }).length === 0);
  assert.ok(codes({ status: '97', balance: 300, cii: 'E', dofd: '2024-01-01', chargeOff: 300 }).includes('M2-BK-BALANCE'));
});

test('cross-bureau comparison finds differences', () => {
  const g = Metro2.compareBureaus([
    { id: 'a', bureau: 'Experian', accounts: [{ id: '1', creditor: 'Example Bank', accountNumber: 'XXXX1234', status: '11', balance: 10 }] },
    { id: 'b', bureau: 'Equifax', accounts: [{ id: '2', creditor: 'Example Bank N.A.', accountNumber: '****1234', status: '11', balance: 0 }] }
  ]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(JSON.stringify(g[0].differences.map(d => d.field)), '["balance"]');
});

test('duplicate debt detection', () => {
  const f = Metro2.auditReport({ id: 'r', bureau: 'Experian', accounts: [
    { id: '1', creditor: 'Collector LLC', originalCreditor: 'Demo Wireless', status: '93', balance: 600, dofd: '2023-01-01' },
    { id: '2', creditor: 'Demo Wireless', status: '97', balance: 600, chargeOff: 600, dofd: '2023-01-01' }] }, { today: '2026-10-14' });
  assert.ok(f.some(x => x.code === 'M2-DUPLICATE-DEBT'));
});

test('CROA cancellation deadline skips Sundays and federal holidays', () => {
  // Signed Thu 2026-10-08: Fri 9, Sat 10, (Sun 11 skipped), (Mon 12 Columbus Day skipped), Tue 13
  assert.strictEqual(Law.croaCancelDeadline('2026-10-08'), '2026-10-13');
  // Signed Mon 2026-10-05: Tue 6, Wed 7, Thu 8
  assert.strictEqual(Law.croaCancelDeadline('2026-10-05'), '2026-10-08');
});

test('FCRA deadlines', () => {
  assert.strictEqual(Law.responseDue('cra_611', '2026-10-01'), '2026-10-31');
  assert.strictEqual(Law.DISPUTE_TYPES.block_605b, undefined, 'identity-theft letters are out of scope');
  assert.strictEqual(Law.responseDue('goodwill', '2026-10-01'), null);
});

test('federal holiday observance', () => {
  const h = Law.federalHolidays(2027);
  assert.ok(h.has('2027-07-05')); // July 4 on a Sunday → observed Monday
  assert.ok(h.has('2027-12-24')); // Christmas on a Saturday → observed Friday
  assert.ok(h.has('2027-11-25')); // Thanksgiving
});

test('letters require a specific discrepancy', () => {
  const client = { name: 'Jordan Sample', address: '100 Example Street' };
  const bad = Letters.build('cra_611', { client, recipient: Law.BUREAUS.Experian, items: [{ creditor: 'X', discrepancy: 'wrong' }], today: 'Oct 14, 2026' });
  assert.strictEqual(bad.ok, false);
  const ok = Letters.build('cra_611', { client, recipient: Law.BUREAUS.Experian, items: [{ creditor: 'Example Bank', discrepancy: 'Reported balance of $240 but the account was paid to $0.', evidence: 'Statement' }], today: 'Oct 14, 2026' });
  assert.ok(ok.ok);
  assert.match(ok.text, /FCRA § 611/);
  assert.match(ok.text, /P\.O\. Box 4500/);
  assert.match(ok.text, /Supporting evidence: Statement/);
  assert.ok(Letters.build('disclosure_609', { client, recipient: Law.BUREAUS.Equifax, items: [], today: 'x' }).ok);
});

test('compliance linter flags deceptive claims', () => {
  const r = Law.lintText('We guarantee results and can get you a CPN.');
  assert.ok(r.length >= 2);
  assert.strictEqual(Law.lintText('Please investigate the balance reported.').length, 0);
});

test('v1 backup migrates to v2 with a tracked dispute', () => {
  const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v1-backup.json'), 'utf8'));
  const ws = Store.migrate(v1);
  assert.strictEqual(ws.version, 2);
  assert.strictEqual(ws.clients[0].name, 'Jordan Sample');
  assert.strictEqual(ws.reports[0].accounts[0].status, '11');
  assert.strictEqual(ws.reports[0].accounts[0].type, 'R');
  assert.strictEqual(ws.disputes.length, 1);
  assert.strictEqual(ws.disputes[0].status, 'ready');
  assert.strictEqual(ws.letters[0].disputeId, ws.disputes[0].id);
  assert.ok(ws.activity.length >= 5);
  assert.throws(() => Store.migrate({ version: 9 }));
});

test('CROA status gates services until the window closes', () => {
  const c = { onboarding: { disclosureSignedAt: '2026-10-08', contractSignedAt: '2026-10-08' } };
  assert.strictEqual(Store.croaStatus(c, '2026-10-13').cleared, false);
  assert.strictEqual(Store.croaStatus(c, '2026-10-13').inWindow, true);
  assert.strictEqual(Store.croaStatus(c, '2026-10-14').cleared, true);
  const late = { onboarding: { disclosureSignedAt: '2026-10-09', contractSignedAt: '2026-10-08' } };
  assert.strictEqual(Store.croaStatus(late, '2026-11-01').cleared, false);
});

test('demo workspace builds and audits', () => {
  const ws = Sample.build();
  assert.strictEqual(ws.clients.length, 4);
  assert.ok(ws.offers.length >= 10);
  assert.strictEqual(ws.partnerReferrals.length, 4);
  const findings = ws.reports.filter(r => r.accounts.length).flatMap(r => Metro2.auditReport(r));
  assert.ok(findings.some(f => f.code === 'M2-CURRENT-PASTDUE'));
  assert.ok(findings.some(f => f.code === 'M2-DOFD-MISSING'));
  assert.ok(findings.some(f => f.code === 'FCRA-OBSOLETE'));
});

test('business-only clients are outside CROA gating; fundability scores', () => {
  const biz = { kind: 'business', onboarding: {} };
  assert.strictEqual(Store.croaStatus(biz).cleared, true);
  assert.strictEqual(Store.croaStatus({ kind: 'both', onboarding: {} }).cleared, false);
  assert.strictEqual(Business.fundability({ businessChecklist: { ein: '2026-01-01', duns: '2026-01-01' } }).done, 2);
});

test('partner catalog covers requested programs with sources', () => {
  ['creditstrong', 'creditsesame', 'nav'].forEach(k => assert.ok(Partners.CATALOG.some(c => c.key === k), k));
  Partners.CATALOG.filter(c => c.status !== 'free').forEach(c => assert.ok(c.sources.length, c.key + ' needs a source'));
  assert.strictEqual(Partners.seedOffers().find(o => o.key === 'creditsesame').enabled, false);
  const ws = Store.migrate({ version: 2, clients: [], offers: [] });
  assert.ok(ws.offers.length >= 10, 'migration adds new catalog offers');
});

test('business correction letter', () => {
  const r = Letters.build('business_correction', { client: { name: 'Avery Placeholder' }, recipient: { name: 'Dun & Bradstreet', address: 'x' }, items: [{ creditor: 'Uline', discrepancy: 'Payment reported 30 days late; paid on invoice terms.' }], today: 'x', business: { legalName: 'Example Bakery LLC', duns: '00-000-0000' } });
  assert.ok(r.ok);
  assert.match(r.text, /Example Bakery LLC/);
});

test('new report marks disputed items removed or corrected and closes the dispute', () => {
  const prev = { id: 'p', clientId: 'c', bureau: 'Experian', date: '2026-08-01', accounts: [
    { id: 'a1', creditor: 'Example Bank', accountNumber: 'XXXX1111', status: '11', balance: 240, pastDue: 75 },
    { id: 'a2', creditor: 'Placeholder Recovery', accountNumber: 'XXXX2222', status: '93', balance: 600 },
    { id: 'a3', creditor: 'Demo Card', accountNumber: 'XXXX3333', status: '97', balance: 900, dofd: '2023-01-01' }] };
  const next = { id: 'n', clientId: 'c', bureau: 'Experian', date: '2026-10-01', accounts: [
    { id: 'b1', creditor: 'Example Bank', accountNumber: 'XXXX1111', status: '11', balance: 0, pastDue: 0 },
    { id: 'b3', creditor: 'Demo Card', accountNumber: 'XXXX3333', status: '97', balance: 900, dofd: '2023-01-01' }] };
  const ws = { reports: [prev, next], disputes: [
    { id: 'd1', clientId: 'c', type: 'cra_611', recipient: 'Experian', sentAt: '2026-08-05', outcome: null, items: [
      { accountId: 'a1', creditor: 'Example Bank', accountNumber: 'XXXX1111', bureau: 'Experian' },
      { accountId: 'a2', creditor: 'Placeholder Recovery', accountNumber: 'XXXX2222', bureau: 'Experian' }] },
    { id: 'd2', clientId: 'c', type: 'cra_611', recipient: 'Experian', sentAt: '2026-08-05', outcome: null, items: [
      { accountId: 'a3', creditor: 'Demo Card', accountNumber: 'XXXX3333', bureau: 'Experian' }] }] };
  const out = Results.applyNewReport(ws, next, '2026-10-02');
  assert.strictEqual(out.wins.length, 2);
  assert.strictEqual(ws.disputes[0].items[0].result, 'corrected');
  assert.strictEqual(ws.disputes[0].items[1].result, 'deleted');
  assert.strictEqual(ws.disputes[0].outcome, 'corrected');
  assert.strictEqual(ws.disputes[1].outcome, 'verified', 'unchanged item counts as still reporting');
  assert.match(Results.winsText('Jordan Sample', out.wins), /Placeholder Recovery was removed from your Experian report/);
});

test('strategy ladder escalates letter 1 → 2 → 3 → attorney review', () => {
  assert.strictEqual(Law.strategyStep('cra_611'), 1);
  const n1 = Law.nextStrategy('cra_611', 'verified', 'bureau');
  assert.strictEqual(n1.step, 2); assert.strictEqual(n1.type, 'mov_611a7'); assert.strictEqual(n1.alsoType, 'furnisher_623');
  const n2 = Law.nextStrategy('furnisher_623', 'verified', 'furnisher');
  assert.strictEqual(n2.step, 3); assert.strictEqual(n2.type, 'furnisher_final');
  const n3 = Law.nextStrategy('furnisher_final', 'verified', 'furnisher');
  assert.strictEqual(n3.step, 4); assert.strictEqual(n3.type, null);
  assert.strictEqual(Law.nextStrategy('cra_611', 'deleted', 'bureau'), null);
  const item = [{ creditor: 'Demo Card', discrepancy: 'Balance reported as $900 but it was paid in full in March.' }];
  assert.match(Letters.build('furnisher_final', { client: { name: 'J S' }, recipient: { name: 'Demo Card' }, items: item, today: 'x' }).text, /1681s-2/);
  assert.match(Letters.build('cfpb_complaint', { client: { name: 'J S' }, recipient: { name: 'Experian' }, recipientName: 'Experian', items: item, today: 'x' }).text, /consumerfinance\.gov/);
});

test('library has content for every section tab and search finds terms', () => {
  const sectionTabs = new Set(Library.SECTIONS.map(s => s.tab));
  ['fields', 'errors', 'laws', 'timelines', 'scores', 'business', 'contacts', 'glossary', 'scripts'].forEach(t => assert.ok(sectionTabs.has(t), t));
  assert.ok(Library.search('re-aging').some(h => h.tab === 'glossary'));
  assert.ok(Library.search('DOFD').length >= 5);
  assert.strictEqual(Library.search('x').length, 0);
  for (const t of ['collections', 'judgments', 'evictions']) assert.ok(Library.TABS.some(([k]) => k === t) && Library.SECTIONS.filter(x => x.tab === t).length === 3);
  assert.ok(Library.search('sealed').some(h => h.tab === 'evictions'));
  assert.ok(Library.search('satisfaction').some(h => h.tab === 'judgments'));
});

test('letter templates fill every situation and build a valid letter', () => {
  const client = { name: 'Jordan Example', address: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', dob: '1990-01-01', ssnLast4: '1234' };
  const sample = { plaintiff: 'Example Funding LLC', caseNumber: 'CV-2019-123', court: 'Example County Court', landlord: 'Example Apartments', property: '9 Elm St',
    creditor: 'Example Servicing', accountNumber: '9876', originalCreditor: 'Example Bank', months: 'November 2023', amount: '500', balance: '200', detail: 'paid 2024-01-02',
    reportedAmount: '3000', correctAmount: '0', newHolder: 'Example Consolidation' };
  for (const t of Templates.TEMPLATES) {
    assert.ok(Templates.CATS.some(([k]) => k === t.cat), t.id);
    const v = {};
    t.fields.forEach(f => { v[f.k] = sample[f.k] || (f.options ? f.options[0] : f.type === 'month' ? '2023-11' : f.type === 'date' ? '2024-01-15' : 'Example'); });
    const r = Templates.fill(t.id, v);
    assert.ok(r.ok, t.id);
    for (const kind of t.to) {
      const type = Templates.typeFor(t, kind);
      assert.ok(Law.DISPUTE_TYPES[type], t.id + ' ' + type);
      const out = Letters.build(type, { client, recipient: { name: 'X', address: 'Y' }, items: [r.item], today: 'October 14, 2026', recipientName: 'X' });
      assert.ok(out.ok, t.id + ' ' + kind);
      assert.ok(out.text.includes('Jordan Example') && out.text.includes('1234'));
      assert.ok(!/\bundefined\b/.test(out.text), t.id + ' has undefined');
    }
  }
  assert.strictEqual(Templates.fill('judgment_satisfied', { plaintiff: 'A' }).ok, false);
  const cats = new Set(Templates.TEMPLATES.map(t => t.cat));
  ['judgments', 'evictions', 'student', 'collections'].forEach(c => assert.ok(cats.has(c)));
});

test('dispute sequences escalate verified items and stop on deletion', () => {
  const ws = { disputes: [] };
  const seq = { id: 'q1', furnisher: { name: 'Example Servicing', address: 'P.O. Box 1' }, status: 'active' };
  const item = { creditor: 'Example Servicing', discrepancy: 'Reported late during deferment in March 2024.' };
  const mk = (id, type, recipient, extra) => Object.assign({ id, seqId: 'q1', type, recipient, items: [item], createdAt: id }, extra || {});
  ws.disputes.push(mk('a', 'cra_611', 'Experian'), mk('b', 'cra_611', 'Equifax'));
  assert.strictEqual(Sequences.status(ws, seq, '2026-01-01').state, 'active'); // not mailed yet
  Object.assign(ws.disputes[0], { sentAt: '2026-01-01', dueAt: '2026-02-05', outcome: 'verified' });
  Object.assign(ws.disputes[1], { sentAt: '2026-01-01', dueAt: '2026-02-05', outcome: 'deleted' });
  assert.strictEqual(Sequences.status(ws, seq, '2026-01-20').state, 'due');
  const p = Sequences.plan(ws, seq, '2026-01-20');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.map(x => [x.type, x.recipient, x.step]))), [['mov_611a7', 'Experian', 2], ['furnisher_623', 'Example Servicing', 2]]);
  // No response: due only after the deadline plus mail time.
  const ws2 = { disputes: [mk('c', 'cra_611', 'TransUnion', { sentAt: '2026-01-01', dueAt: '2026-02-05' })] };
  assert.strictEqual(Sequences.status(ws2, seq, '2026-02-06').state, 'active');
  assert.strictEqual(Sequences.status(ws2, seq, '2026-02-10').state, 'due');
  // Chain ends at the CFPB complaint -> attorney review.
  const ws3 = { disputes: [mk('d', 'mov_611a7', 'Experian', { sentAt: '2026-01-01', outcome: 'verified' }), mk('e', 'cfpb_complaint', 'Experian', { parentId: 'd', sentAt: '2026-02-01', outcome: 'verified' })] };
  assert.strictEqual(Sequences.status(ws3, { id: 'q1' }, '2026-03-01').state, 'attorney');
  // All deleted -> won.
  const ws4 = { disputes: [mk('f', 'cra_611', 'Experian', { sentAt: '2026-01-01', outcome: 'deleted' })] };
  assert.strictEqual(Sequences.status(ws4, seq, '2026-03-01').state, 'won');
  const rows = Sequences.outline(seq, [{ type: 'cra_611', recipient: 'Experian' }]);
  assert.ok(rows.some(r => r.type === 'mov_611a7') && rows.some(r => r.type === 'furnisher_final') && rows.some(r => r.type === 'cfpb_complaint'));
});

test('billing creates invoices only for performed work after the cancellation period', () => {
  const ws = Sample.build();
  const c = ws.clients[0];
  ws.settings.billing = { model: 'per_letter', perLetter: 40 };
  ws.invoices = [];
  const due = Billing.due(ws, Store.today());
  assert.ok(due.length >= 1 && due.every(i => i.clientId === c.id && i.amount === 40 && i.disputeId && i.payToken));
  ws.invoices.push(...due);
  assert.strictEqual(Billing.due(ws, Store.today()).length, 0, 'no double billing');
  // Inside the cancellation window nothing is billed.
  const c2 = ws.clients[1];
  ws.disputes.push({ id: 'x1', clientId: c2.id, type: 'cra_611', recipient: 'Experian', round: 1, items: [], sentAt: Store.today() });
  assert.ok(!Billing.due(ws, Store.today()).some(i => i.clientId === c2.id));
  // Pay per delete.
  ws.settings.billing = { model: 'per_delete', perDelete: 75 };
  ws.invoices = [];
  const del = Billing.due(ws, Store.today());
  assert.ok(del.length >= 1 && del.every(i => i.amount === 75 && i.itemKey));
});

test('billing enforces the 12-month agreement term and the $1,188 total cap', () => {
  assert.strictEqual(Billing.DEFAULTS.termMonths, 12);
  assert.strictEqual(Billing.DEFAULTS.termCap, 1188);
  assert.strictEqual(Billing.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(Billing.addMonths('2026-10-21', 12), '2027-10-21');
  const c = { id: 'cap1', name: 'Cap Client', kind: 'personal', status: 'active', onboarding: { disclosureSignedAt: '2026-01-05', contractSignedAt: '2026-01-05' } };
  const ws = { settings: {}, clients: [c], disputes: [], invoices: [] };
  const t = Billing.term(ws, c);
  assert.strictEqual([t.start, t.end, t.cap].join(' '), '2026-01-05 2027-01-05 1188');
  for (let k = 0; k < 11; k++) ws.invoices.push({ id: 'm' + k, clientId: c.id, amount: 99, status: 'paid', serviceCompletedAt: Billing.addMonths('2026-01-20', k) });
  assert.strictEqual(Billing.termTotal(ws, c, t), 1089);
  assert.ok(Billing.capCheck(ws, c, 99, '2026-12-20').ok, 'the 12th $99 month exactly reaches the cap');
  const over = Billing.capCheck(ws, c, 100, '2026-12-20');
  assert.ok(!over.ok && /over the \$1188\.00 cap/.test(over.reason) && over.remaining === 99);
  const late = Billing.capCheck(ws, c, 10, '2027-01-05');
  assert.ok(!late.ok && /ended 2027-01-05/.test(late.reason), 'no billing after the term ends');
  ws.invoices.push({ id: 'v1', clientId: c.id, amount: 500, status: 'void', serviceCompletedAt: '2026-06-01' });
  assert.strictEqual(Billing.termTotal(ws, c, t), 1089, 'void invoices do not count');
  // capViolations: only new / increased invoices are judged; unchanged ones are accepted as-is.
  const prev = JSON.parse(JSON.stringify(ws));
  const next = JSON.parse(JSON.stringify(ws));
  next.invoices.push({ id: 'n1', clientId: c.id, amount: 99, status: 'issued', serviceCompletedAt: '2026-12-20' });
  assert.strictEqual(Billing.capViolations(prev, next).length, 0);
  next.invoices.push({ id: 'n2', clientId: c.id, amount: 49, status: 'issued', serviceCompletedAt: '2026-12-21' });
  const v = Billing.capViolations(prev, next);
  assert.strictEqual(v.map(x => x.invoice.id).join(','), 'n2');
  const bumped = JSON.parse(JSON.stringify(ws)); bumped.invoices[0].amount = 300;
  assert.strictEqual(Billing.capViolations(prev, bumped).map(x => x.invoice.id).join(','), 'm0', 'raising an amount is re-checked');
  // Automatic billing stops at the cap and reports what it held back.
  const ws2 = { settings: { billing: { model: 'per_letter', perLetter: 400 } }, clients: [Object.assign({}, c, { id: 'cap2' })], disputes: [], invoices: [] };
  for (let k = 0; k < 4; k++) ws2.disputes.push({ id: 'dl' + k, clientId: 'cap2', type: 'cra_611', recipient: 'Experian', round: k + 1, items: [], sentAt: Billing.addMonths('2026-02-01', k) });
  const blocked = [];
  const due = Billing.due(ws2, '2026-10-21', blocked);
  assert.strictEqual(due.length, 2, '2 x $400 fit, the 3rd would pass $1,188');
  assert.strictEqual(blocked.length, 2);
  assert.ok(due.reduce((n, i) => n + i.amount, 0) <= 1188);
});

test('automations fire once, only after being turned on, and fill templates', () => {
  const ws = Sample.build();
  const today = Store.today();
  assert.strictEqual(Automations.due(ws, today, {}).length, 0, 'off by default');
  ws.automations = Automations.DEFAULT_RULES.map(r => Object.assign({}, r, { enabled: true, enabledAt: Law.addDays(today, -1) + 'T00:00:00Z' }));
  ws.clients.push({ id: 'lead1', name: 'Pat Lead', firstName: 'Pat', status: 'lead', createdAt: today + 'T10:00:00Z', onboarding: {} });
  ws.settings.company.bookingUrl = 'https://book.example.test';
  const acts = Automations.due(ws, today, { origin: 'https://app.example.test' });
  const welcome = acts.find(a => a.rule.id === 'welcome-lead' && a.client.id === 'lead1');
  assert.ok(welcome && welcome.body.includes('Pat') && welcome.body.includes('https://book.example.test'));
  assert.ok(!acts.some(a => a.client.name === 'Casey Testcase' && a.rule.trigger === 'lead_new'), 'history before enabling is ignored');
  ws.automationLog = Object.fromEntries(acts.map(a => [a.key, { at: today }]));
  assert.strictEqual(Automations.due(ws, today, {}).length, 0, 'each event fires once');
});

test('violation tracker flags missed deadlines and reinsertion', () => {
  const ws = Sample.build();
  const today = Store.today();
  const d = ws.disputes[0]; // Experian dispute mailed 33 days ago, due 2 days ago
  assert.ok(!Violations.scan(ws, today).some(v => v.key === 'noresp:' + d.id), 'grace period for mail');
  const later = Law.addDays(today, 10);
  assert.ok(Violations.scan(ws, later).some(v => v.key === 'noresp:' + d.id && /611/.test(v.law)));
  // Reinsertion: item deleted, then a newer report shows it again.
  d.outcome = 'deleted'; d.items[0].result = 'deleted'; d.items[0].resultAt = Law.addDays(today, -5);
  const exp = ws.reports[0];
  ws.reports.push(Object.assign({}, exp, { id: 'newrep', date: today, accounts: exp.accounts.slice() }));
  const v = Violations.scan(ws, today).find(x => x.key.startsWith('reinsert:'));
  assert.ok(v && /611\(a\)\(5\)\(B\)/.test(v.law));
  const pkt = Violations.packet(ws, d.clientId, null, today, ws.settings.company);
  assert.ok(pkt.includes('ATTORNEY REVIEW PACKET') && pkt.includes('reappeared'));
});

test('sales pipeline scores leads and computes partner commissions', () => {
  const ws = Sample.build();
  const lead = ws.clients.find(c => c.status === 'lead');
  const s = Sales.score(ws, lead, Store.today());
  assert.ok(s.score >= 0 && s.score <= 100 && ['hot', 'warm', 'cold'].includes(s.heat));
  assert.strictEqual(Sales.stageOf(lead), 'new');
  lead.leadStage = 'consult';
  assert.ok(Sales.score(ws, lead, Store.today()).score > s.score);
  const r = ws.referrals[0];
  r.commissionType = 'flat'; r.commissionAmount = 25; r.payouts = [{ amount: 10 }];
  const k = Sales.commissions(ws, r, Store.today());
  assert.strictEqual(k.earned, 25); assert.strictEqual(k.owed, 15);
});

test('reports: progress, analysis and side-by-side comparison', () => {
  const ws = Sample.build();
  const c = ws.clients[0];
  const html = Reports.progress(ws, c.id, Store.today());
  assert.ok(html.includes('Credit progress report') && html.includes(c.name) && html.includes('<svg'));
  const an = Reports.analysis(ws, c.id, Store.today());
  assert.ok(an.includes('Credit report analysis') && /do not promise/i.test(an));
  const exp = ws.reports[0];
  const next = Object.assign({}, exp, { id: 'n', accounts: exp.accounts.slice(1).concat([Object.assign({}, exp.accounts[1], { id: 'z', creditor: 'Brand New Card', accountNumber: 'XXXX9999' })]) });
  next.accounts[0] = Object.assign({}, next.accounts[0], { balance: 0 });
  const rows = Reports.sideBySide(exp, next);
  assert.strictEqual(rows[0].kind, 'deleted');
  assert.ok(rows.some(r => r.kind === 'changed') && rows.some(r => r.kind === 'new'));
});

test('address book finds researched furnishers by aliases and learns new ones', () => {
  assert.ok(Furnishers.SEED.length >= 60);
  assert.ok(Furnishers.SEED.every(e => /,\s*[A-Z]{2}\s+\d{5}/.test(e[3]) && /^https:\/\//.test(e[5])), 'every seed address ends with City, ST ZIP and has a source');
  const ws = { disputes: [], addressBook: [] };
  assert.ok(/Norfolk, VA/.test(Furnishers.lookup(ws, 'PORTFOLIO RECOVERY ASSOCIATES LLC').address));
  assert.ok(/Greenville, SC/.test(Furnishers.lookup(ws, 'LVNV Funding LLC').address));
  assert.strictEqual(Furnishers.lookup(ws, 'Totally Unknown Collector'), null);
  Furnishers.remember(ws, 'Totally Unknown Collector', 'PO Box 1\nTown, TX 75001');
  assert.ok(Furnishers.lookup(ws, 'totally unknown collector').address.includes('Town, TX'));
});

test('new letter types: inquiry, personal info, authorized user', () => {
  const client = { name: 'Jordan Example', address: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' };
  ['inquiry_604', 'pii_611', 'au_removal'].forEach(t => {
    const out = Letters.build(t, { client, recipient: { name: 'X', address: 'Y' }, items: [{ creditor: 'Example Bank', discrepancy: 'I did not authorize this inquiry dated March 2026.' }], today: 'today' });
    assert.ok(out.ok && Law.DISPUTE_TYPES[t], t);
  });
});

test('invoices render as a valid PDF with number, client and total', () => {
  const ws = Sample.build();
  const inv = ws.invoices[1];
  const pdf = Invoices.pdf(ws, inv, { payLink: 'https://pay.example.test/x' });
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.strictEqual(pdf.slice(xref, xref + 4), 'xref', 'xref offset is exact');
  const offs = [...pdf.matchAll(/(\d{10}) 00000 n /g)].map(m => Number(m[1]));
  offs.forEach((o, i) => assert.strictEqual(pdf.slice(o, o + String(i + 1).length + 6), `${i + 1} 0 obj`));
  assert.ok(pdf.includes(Invoices.number(inv)) && pdf.includes('Jordan Sample') && pdf.includes('$49.00') && pdf.includes('pay.example.test'));
  const len = Number(pdf.match(/\/Length (\d+)/)[1]);
  const start = pdf.indexOf('stream\n') + 7;
  assert.strictEqual(pdf.slice(start + len, start + len + 10), '\nendstream');
  assert.match(Invoices.text(ws, inv), /TOTAL: \$49\.00/);
});

test('acquisition due diligence: progress, red flags, official search links, report', () => {
  const d = { id: 'd1', name: 'Example Bakery LLC', state: 'TX', formedOn: '2025-06-01', askingPrice: 500000, sde: 100000, checks: { filing: { status: 'clear' }, ucc: { status: 'issue', note: 'UCC-1 by Example Bank' } } };
  const e = Acquisition.evaluate(d, '2026-10-14');
  assert.strictEqual(e.done, 1); assert.strictEqual(e.issues, 1); assert.strictEqual(e.multiple, 5);
  assert.ok(e.flags.some(f => /UCC-1/.test(f.text)) && e.flags.some(f => /5× seller/.test(f.text)) && e.flags.some(f => /years since formation/.test(f.text)));
  assert.match(Acquisition.LINKS.opencorporates(d), /opencorporates\.com\/companies\?q=Example%20Bakery%20LLC&jurisdiction_code=us_tx/);
  assert.strictEqual(Acquisition.LINKS.listings('NY'), 'https://www.bizbuysell.com/new-york-businesses-for-sale/');
  const r = Acquisition.report(d, { name: 'Avery' }, '2026-10-14', { name: 'Co' });
  assert.ok(r.includes('[Issue found] UCC lien search') && r.includes('not legal, tax or accounting advice'));
  assert.ok(Acquisition.CHECKS.some(c => c.key === 'disclose'));
});

test('90-day business credit plan dates steps and completes them from the checklist', () => {
  const c = { creditPlan: { startedAt: '2026-10-01', done: { vendors1: '2026-10-09' } }, businessChecklist: { duns: '2026-10-02' } };
  const ps = Business.planStatus(c, '2026-10-14');
  const duns = ps.steps.find(s => s.key === 'duns');
  assert.ok(duns.complete && duns.due === '2026-10-02' && duns.url.includes('dnb.com'));
  assert.ok(ps.steps.find(s => s.key === 'vendors1').complete);
  assert.ok(ps.steps.find(s => s.key === 'monitor').overdue);
  assert.strictEqual(ps.steps.find(s => s.key === 'next').due, '2026-12-30');
  assert.strictEqual(Business.planStatus({}, '2026-10-14'), null);
});
