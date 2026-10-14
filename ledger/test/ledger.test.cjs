// Run: node --test ledger/test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Set, Error, URLSearchParams };
ctx.globalThis = ctx;
vm.createContext(ctx);
['law.js', 'partners.js', 'business.js', 'library.js', 'metro2.js', 'results.js', 'letters.js', 'store.js', 'sample.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f }));
const { Law, Metro2, Letters, Store, Sample, Partners, Business, Results, Library } = ctx;
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
  // § 605B: 4 business days, skipping weekend and Columbus Day
  assert.strictEqual(Law.responseDue('block_605b', '2026-10-08'), '2026-10-15');
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
