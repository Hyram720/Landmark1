/* Synthetic demo workspace. Every name, number and address is fictional. */
(function (root) {
  'use strict';
  const { Store, Law } = root;

  function build() {
    const ws = Store.empty();
    const t = Store.today();
    const d = n => Law.addDays(t, n);
    ws.settings.company = { name: 'Ledger Credit Advocates (demo)', address: '200 Example Plaza, Suite 4\nSpringfield, IL 62701', phone: '(555) 010-0100', email: 'help@example.test', website: 'example.test', state: 'IL', bondNumber: 'DEMO-BOND-0001', registration: 'DEMO-REG-0001' };

    const c1 = { id: Store.uid(), name: 'Jordan Sample', firstName: 'Jordan', lastName: 'Sample', kind: 'personal', email: 'jordan@example.test', phone: '(555) 010-0101', address: '100 Example Street', city: 'Springfield', state: 'IL', zip: '62701', dob: '1988-04-12', ssnLast4: '0000', status: 'active', createdAt: d(-101) + 'T15:00:00Z', notes: 'Prefers email. Mortgage pre-approval target in Q1.', referralId: '',
      onboarding: { disclosureSignedAt: d(-100), contractSignedAt: d(-100), idReceived: d(-99), addressProofReceived: d(-99), authorizationAt: d(-100) } };
    const c2 = { id: Store.uid(), name: 'Riley Example', firstName: 'Riley', lastName: 'Example', kind: 'personal', email: 'riley@example.test', phone: '(555) 010-0102', address: '42 Placeholder Ave', city: 'Columbus', state: 'OH', zip: '43004', dob: '1979-09-30', ssnLast4: '1111', status: 'onboarding', createdAt: d(-1) + 'T15:00:00Z', notes: '', referralId: '',
      onboarding: { disclosureSignedAt: d(-1), contractSignedAt: d(-1) } };
    const c3 = { id: Store.uid(), name: 'Casey Testcase', firstName: 'Casey', lastName: 'Testcase', kind: 'personal', email: 'casey@example.test', phone: '', address: '9 Fictional Rd', city: 'Austin', state: 'TX', zip: '73301', dob: '1992-02-02', ssnLast4: '2222', status: 'lead', createdAt: d(-3) + 'T15:00:00Z', notes: 'Consult booked.', referralId: '', onboarding: {} };
    ws.clients.push(c1, c2, c3);

    const ref = { id: Store.uid(), name: 'Morgan Broker (demo)', email: 'morgan@example.test', company: 'Example Mortgage Co.', commission: 'Flat $25 per enrolled client', createdAt: d(-90) };
    ws.referrals.push(ref);
    c1.referralId = ref.id;

    const acct = (o) => Object.assign({ id: Store.uid(), accountNumber: '', type: 'R', status: '11', balance: 0, limit: '', highCredit: '', pastDue: 0, chargeOff: '', opened: '', closed: '', lastPayment: '', dofd: '', reportedDate: d(-20), ecoa: '1', complianceCode: '', cii: '', paymentHistory: '', originalCreditor: '', issue: '', evidence: '', consumerDisputed: false }, o);

    const base = [
      { creditor: 'Example Bank', accountNumber: 'XXXX4821', type: 'R', status: '11', balance: 240, limit: 1000, highCredit: 820, pastDue: 75, opened: '2016-03-01', lastPayment: d(-35), paymentHistory: '000000000000000000000000', issue: 'Balance should be $0 — paid in full on statement date', evidence: 'Statement showing $0 balance' },
      { creditor: 'Sample Auto Finance', accountNumber: 'XXXX1190', type: 'I', status: '13', balance: 1350, highCredit: 18000, pastDue: 0, opened: '2019-06-15', closed: d(-200), lastPayment: d(-200), paymentHistory: 'EEEEEE000000000000000000' },
      { creditor: 'Placeholder Recovery LLC', accountNumber: 'XXXX7781', type: 'O', status: '93', balance: 612, pastDue: 612, opened: '2023-02-10', dofd: '', originalCreditor: 'Demo Wireless', paymentHistory: 'GGGGGGGGGGGG' },
      { creditor: 'Demo Wireless', accountNumber: 'XXXX3300', type: 'O', status: '97', balance: 612, pastDue: 612, chargeOff: 612, opened: '2020-01-05', dofd: '2022-08-01', paymentHistory: 'LLLLLL654321000000000000' },
      { creditor: 'Fictional Card Services', accountNumber: 'XXXX5512', type: 'R', status: '97', balance: 1890, pastDue: 1890, chargeOff: 1700, limit: 2000, opened: '2014-05-20', dofd: '2018-11-01', paymentHistory: 'LLLLLLLLLLLL' }
    ];
    const variants = {
      Experian: {},
      Equifax: { 'Fictional Card Services': { dofd: '2019-03-01' }, 'Example Bank': { pastDue: 0 } },
      TransUnion: { 'Sample Auto Finance': { balance: 0 }, 'Placeholder Recovery LLC': { balance: 702 } }
    };
    const scores = { Experian: 612, Equifax: 598, TransUnion: 621 };
    Object.keys(variants).forEach(bureau => {
      ws.reports.push({
        id: Store.uid(), clientId: c1.id, bureau, source: 'Synthetic tri-merge (demo)', date: d(-20), scores: { [bureau]: scores[bureau] },
        accounts: base.map(b => acct(Object.assign({}, b, variants[bureau][b.creditor] || {})))
      });
    });
    ws.reports.push({ id: Store.uid(), clientId: c1.id, bureau: 'Experian', source: 'Synthetic QA report', date: d(-90), scores: { Experian: 571 }, accounts: [] });

    const exp = ws.reports[0];
    const item = exp.accounts[0];
    const disp = { id: Store.uid(), clientId: c1.id, type: 'cra_611', round: 1, recipient: 'Experian', status: 'sent',
      items: [{ reportId: exp.id, accountId: item.id, creditor: item.creditor, accountNumber: item.accountNumber, bureau: 'Experian', discrepancy: 'Account Status is current (11) but an amount past due of $75 is reported, and the balance should be $0.', fields: ['Account Status (Base 17A)', 'Amount Past Due (Base 22)', 'Current Balance (Base 21)'], requested: 'Report $0 balance and $0 past due', evidence: 'Statement showing $0 balance' }],
      letterId: null, createdAt: d(-34) + 'T12:00:00Z', sentAt: d(-33), receivedAt: d(-28), dueAt: Law.addDays(d(-28), 30), tracking: '9400 0000 0000 0000 0000 00', outcome: null, respondedAt: null, notes: '' };
    ws.disputes.push(disp);
    ws.letters.push({ id: Store.uid(), clientId: c1.id, disputeId: disp.id, type: 'cra_611', status: 'sent', text: '(Generated letter — open the dispute to regenerate.)', createdAt: disp.createdAt, approvedAt: d(-34), sentAt: d(-33) });
    disp.letterId = ws.letters[0].id;

    const disp2 = { id: Store.uid(), clientId: c1.id, type: 'furnisher_623', round: 1, recipient: 'Sample Auto Finance', recipientAddress: 'Attn: Credit Reporting Disputes\nP.O. Box 0000\nExample City, ST 00000', status: 'closed',
      items: [{ creditor: 'Sample Auto Finance', accountNumber: 'XXXX1190', discrepancy: 'Loan was paid off and closed, but a $1,350 balance is still reported.', fields: ['Account Status (Base 17A)', 'Current Balance (Base 21)'], evidence: 'Lien release and payoff letter' }],
      createdAt: d(-80) + 'T12:00:00Z', sentAt: d(-79), receivedAt: d(-74), dueAt: d(-44), tracking: '', outcome: 'corrected', respondedAt: d(-50), notes: 'Furnisher updated to $0 with two of three bureaus.' };
    ws.disputes.push(disp2);

    ws.tasks.push(
      { id: Store.uid(), clientId: c1.id, title: 'Request Equifax report refresh after round 1', due: d(3), done: false, createdAt: Store.now() },
      { id: Store.uid(), clientId: c2.id, title: 'Collect photo ID and proof of address', due: d(2), done: false, createdAt: Store.now() },
      { id: Store.uid(), clientId: c3.id, title: 'Consultation call — review rights disclosure', due: d(1), done: false, createdAt: Store.now() }
    );
    ws.invoices.push(
      { id: Store.uid(), clientId: c1.id, description: 'Dispute letter prepared and mailed — Sample Auto Finance (round 1)', amount: 49, serviceCompletedAt: d(-79), disputeId: disp2.id, status: 'paid', issuedAt: d(-78), paidAt: d(-70) },
      { id: Store.uid(), clientId: c1.id, description: 'Dispute letter prepared and mailed — Experian (round 1)', amount: 49, serviceCompletedAt: d(-33), disputeId: disp.id, status: 'issued', issuedAt: d(-32), paidAt: null }
    );
    [['Added Casey Testcase as a lead', c3.id, -3], ['Riley Example signed agreement — cancellation window open', c2.id, -1], ['Imported 3-bureau report', c1.id, -20], ['Round 1 dispute mailed to Experian', c1.id, -33], ['Sample Auto Finance corrected balance to $0', c1.id, -50]]
      .sort((a, b) => b[2] - a[2]).forEach(([text, cid, n]) => ws.activity.push({ id: Store.uid(), at: d(n) + 'T15:00:00Z', text, clientId: cid }));
    return ws;
  }
  root.Sample = { build };
})(typeof window !== 'undefined' ? window : globalThis);
