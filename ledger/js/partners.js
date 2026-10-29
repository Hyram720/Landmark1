/*
 * Partner offer catalog: credit-builder, monitoring and business-credit services you can refer
 * clients to. Program terms were researched in October 2026 from the sources listed on each offer.
 * Affiliate terms change often — every offer carries a "verify" status. Confirm terms with the
 * program before you promote it.
 */
(function (root) {
  'use strict';

  const CATALOG = [
    { key: 'creditstrong', name: 'CreditStrong', audience: 'personal', category: 'Credit builder',
      url: 'https://www.creditstrong.com/', joinUrl: 'https://creditstrong.referralrock.com/v2/3/register',
      program: 'Refer-a-friend (Referral Rock)', bonus: '$25 per successful referral',
      bonusLow: 25, bonusHigh: 25, cookie: '90 days (reported)', status: 'confirmed',
      note: 'Official page: “For every successful referral using your unique link, we will pay you $25.” Its page description still says $10, so confirm in your Referral Rock dashboard.',
      sources: ['https://www.creditstrong.com/refer-a-friend/'] },
    { key: 'creditstrong-business', name: 'CreditStrong Business', audience: 'business', category: 'Business credit builder',
      url: 'https://www.creditstrong.com/business/', joinUrl: 'https://creditstrong.referralrock.com/v2/3/register',
      program: 'Refer-a-friend (Referral Rock)', bonus: 'Same referral program as personal — confirm business payout',
      bonusLow: 25, bonusHigh: 25, cookie: '90 days (reported)', status: 'verify',
      note: 'Business credit-builder account. Company pages list Equifax Business, PayNet and SBFE reporting; D&B reporting is not confirmed.',
      sources: ['https://www.creditstrong.com/business/business-faq', 'https://support.creditstrong.com/hc/en-us/articles/39229874363540-Do-you-report-to-all-three-major-credit-bureaus'] },
    { key: 'nav', name: 'Nav', audience: 'business', category: 'Business credit monitoring',
      url: 'https://www.nav.com/', joinUrl: 'https://www.nav.com/partner-program/',
      program: 'Affiliate (impact.com)', bonus: '$5–$50 per sale reported by networks; up to ~$40 for Nav Prime',
      bonusLow: 5, bonusHigh: 50, cookie: '45 days (reported)', status: 'confirmed-program',
      note: 'Nav’s official partner page confirms an affiliate program for “small business service providers.” Rates aren’t published, so get them from the impact.com campaign.',
      sources: ['https://www.nav.com/partner-program/', 'https://getlasso.co/affiliate/nav/', 'https://www.flexoffers.com/affiliate-programs/nav-affiliate-program/'] },
    { key: 'creditsesame', name: 'Credit Sesame', audience: 'personal', category: 'Free score & monitoring',
      url: 'https://www.creditsesame.com/', joinUrl: 'https://www.flexoffers.com/affiliate-programs/credit-sesame-free-credit-score-free-credit-monitoring-affiliate-program/',
      program: 'Affiliate (FlexOffers / networks)', bonus: '$3–$6 per approved sign-up (reported)',
      bonusLow: 3, bonusHigh: 6, cookie: '30 days (reported)', status: 'unconfirmed',
      note: 'Credit Sesame still operates. I couldn’t confirm whether its affiliate program is open in 2026 — listings conflict and one regional campaign shows as paused. Ask the network before promoting.',
      sources: ['https://commissiondex.com/programs/credit-sesame/', 'https://uppromote.com/affiliate-program-directory/credit-sesame/', 'https://www.creator-hero.com/blog/credit-sesame-affiliate-program-in-depth-review-pros-and-cons'] },
    { key: 'self', name: 'Self', audience: 'personal', category: 'Credit builder',
      url: 'https://www.self.inc/', joinUrl: 'https://www.flexoffers.com/affiliate-programs/self-inc-affiliate-program',
      program: 'Affiliate (FlexOffers, Rakuten)', bonus: '$10–$12 per Credit Builder account (reported)',
      bonusLow: 10, bonusHigh: 12, cookie: '30 days (reported)', status: 'verify',
      note: 'Credit-builder loan and secured card.', sources: ['https://www.flexoffers.com/affiliate-programs/self-inc-affiliate-program', 'https://www.rakuten.com/shop/self'] },
    { key: 'kikoff', name: 'Kikoff', audience: 'personal', category: 'Credit builder',
      url: 'https://kikoff.com/', joinUrl: 'https://about.kikoff.com/affiliate',
      program: 'Affiliate (impact.com)', bonus: '$5–$33 per paid sign-up (reported)',
      bonusLow: 5, bonusHigh: 33, cookie: '—', status: 'confirmed-program',
      note: 'Kikoff’s own affiliate page confirms the impact.com program; rates are shown after you join.', sources: ['https://about.kikoff.com/affiliate', 'https://www.flexoffers.com/affiliate-programs/kikoff-affiliate-program/'] },
    { key: 'identityiq', name: 'IdentityIQ', audience: 'personal', category: '3-bureau monitoring (report pulls)',
      url: 'https://www.identityiq.com/', joinUrl: 'https://www.idiq.com/partnerships/affiliate-partners',
      program: 'Affiliate (IDIQ, Awin)', bonus: '$35–$40 per enrollment typical (reported up to $100)',
      bonusLow: 35, bonusHigh: 40, cookie: '30 days (reported)', status: 'confirmed-program',
      note: 'Widely used by credit repair firms to pull 3-bureau reports. IDIQ also runs MyScoreIQ.', sources: ['https://www.idiq.com/partnerships/affiliate-partners', 'https://ui.awin.com/merchant-profile/18765', 'https://getlasso.co/affiliate/idiq/'] },
    { key: 'myfreescorenow', name: 'MyFreeScoreNow (MFSN)', audience: 'personal', category: '3-bureau monitoring (report pulls)',
      url: 'https://app.myfreescorenow.com/enroll/B04C9729', joinUrl: 'https://app.myfreescorenow.com/enroll/B04C9729',
      affiliateUrl: 'https://app.myfreescorenow.com/enroll/B04C9729',
      program: 'Direct affiliate enroll link', bonus: '$6 per trial to $50–$60 per sale (reported)',
      bonusLow: 6, bonusHigh: 60, cookie: '1 day (reported)', status: 'confirmed-program', network: 'direct', subIdParam: '',
      note: 'Common report source for Metro 2 imports. $39.90 per month after a 7-day trial. We may earn a commission if a client signs up. Clients do not have to use it.',
      sources: ['https://getlasso.co/affiliate/myfreescorenow-com/', 'https://www.flexoffers.com/affiliate-programs/myfreescorenow-com-affiliate-program/', 'https://www.affpaying.com/myfreescorenow'] },
    { key: 'smartcredit', name: 'SmartCredit', audience: 'personal', category: '3-bureau monitoring (report pulls)',
      url: 'https://www.smartcredit.com/?PID=72556', joinUrl: 'https://www.smartcredit.com/?PID=72556',
      affiliateUrl: 'https://www.smartcredit.com/?PID=72556',
      program: 'Direct affiliate link (PID)', bonus: '$10–$24 per subscription (reported)',
      bonusLow: 10, bonusHigh: 24, cookie: '30–45 days (reported)', status: 'confirmed-program', network: 'direct', subIdParam: '',
      note: '3-bureau monitoring for report pulls. Pricing is shown at sign-up. We may earn a commission if a client signs up. Clients do not have to use it.', sources: ['https://www.flexoffers.com/affiliate-programs/smartcredit-affiliate-program/', 'https://www.revshare.so/programs/advertiser/smartcredit-b3e2a826'] },
    { key: 'myscoreiq', name: 'MyScoreIQ', audience: 'personal', category: '3-bureau monitoring (report pulls)',
      url: 'https://www.myscoreiq.com/', joinUrl: 'https://www.idiq.com/partnerships/affiliate-partners',
      program: 'Affiliate (IDIQ, FlexOffers)', bonus: 'Up to $21–$100 per enrollment (reported)',
      bonusLow: 21, bonusHigh: 21, cookie: '—', status: 'verify',
      note: 'IDIQ brand.', sources: ['https://www.creator-hero.com/blog/myscoreiq-affiliate-program-in-depth-review-pros-and-cons'] },
    { key: 'tillful', name: 'Tillful', audience: 'business', category: 'Business credit score & monitoring',
      url: 'https://www.tillful.com/', joinUrl: 'https://form.typeform.com/to/G81buasO',
      program: 'Affiliate partner program (application form)', bonus: 'Not published — terms given after approval',
      bonusLow: 0, bonusHigh: 0, cookie: '—', status: 'confirmed-program', network: 'direct', subIdParam: '',
      note: 'Tillful’s own application form confirms an affiliate partner program; commission terms are not public.', sources: ['https://form.typeform.com/to/G81buasO'] },
    { key: 'crown-net30', name: 'Crown Office Supplies (net-30)', audience: 'business', category: 'Net-30 vendor tradeline',
      url: 'https://crownofficesupplies.com/net30-application/', joinUrl: 'https://crownofficesupplies.com/affiliates/',
      program: 'Affiliate (on-site “Get rewarded” program)', bonus: 'Paid only when the referral buys the $99 annual membership; amount not published',
      bonusLow: 0, bonusHigh: 0, cookie: '—', status: 'confirmed-program', network: 'direct', subIdParam: '',
      note: 'Net-30 account that reports to business bureaus; $99 annual membership. Only Net 30 referrals qualify.', sources: ['https://crownofficesupplies.com/affiliates/', 'https://www.nav.com/business-credit/net-30-accounts/'] },
    { key: 'crc-software', name: 'Credit Repair Cloud (software, B2B)', audience: 'partner', category: 'Software for other credit repair businesses',
      url: 'https://www.creditrepaircloud.com/', joinUrl: 'https://market.partnerstack.com/page/creditrepaircloud',
      program: 'Affiliate (PartnerStack)', bonus: '30% recurring on referred accounts paying $179+/mo (listing)',
      bonusLow: 0, bonusHigh: 0, cookie: '90 days (listing)', status: 'verify', network: 'partnerstack', subIdParam: '',
      note: 'Only relevant for referring other credit repair businesses, never consumers. It’s a Ledger competitor, so think before promoting it.', sources: ['https://openaffiliate.dev/programs/credit-repair-cloud'] },
    { key: 'experian-boost', name: 'Experian Boost', audience: 'personal', category: 'Free — adds utility/streaming payments',
      url: 'https://www.experian.com/consumer-products/score-boost.html', joinUrl: '', program: 'None (free consumer tool)', bonus: 'No referral bonus',
      bonusLow: 0, bonusHigh: 0, cookie: '—', status: 'free', note: 'Free. Recommend it on merit, not for commission.', sources: [] },
    { key: 'duns', name: 'D-U-N-S Number (Dun & Bradstreet)', audience: 'business', category: 'Free — business credit file',
      url: 'https://www.dnb.com/duns/get-a-duns.html', joinUrl: '', program: 'None (free)', bonus: 'No referral bonus',
      bonusLow: 0, bonusHigh: 0, cookie: '—', status: 'free', note: 'A free D-U-N-S Number is the starting point for a D&B business credit file. Paid expedite isn’t required.', sources: [] }
  ];

  const STATUS_LABEL = {
    confirmed: ['Bonus confirmed on official page', 'b-ok'],
    'confirmed-program': ['Program confirmed · rate via network', 'b-info'],
    verify: ['Verify terms', 'b-med'],
    unconfirmed: ['Program status unconfirmed', 'b-high'],
    free: ['Free resource', 'b-low']
  };

  const REFERRAL_STAGES = [['recommended', 'Recommended'], ['clicked', 'Clicked'], ['signed_up', 'Signed up'], ['approved', 'Commission approved'], ['paid', 'Paid out'], ['declined', 'Not interested']];

  const DISCLOSURE = 'We may receive a referral fee from some companies we recommend. It does not change the price you pay, and you are never required to sign up for any product to use our services.';

  // Sub-ID parameter by affiliate network, so each click can be tied to a client or staff member
  // without putting their name or id in the URL (a short one-way hash is sent).
  const SUBID_PARAM = { impact: 'subId1', flexoffers: 'fobs', awin: 'clickref', cj: 'sid', rakuten: 'u1', partnerstack: '', referralrock: '', direct: '' };
  function networkOf(c) {
    if (c.network) return c.network;
    const p = String(c.program || '').toLowerCase();
    return p.includes('impact') ? 'impact' : p.includes('flexoffers') ? 'flexoffers' : p.includes('awin') ? 'awin' : p.includes('cj') ? 'cj' : p.includes('referral rock') ? 'referralrock' : 'direct';
  }
  function seedOffers() {
    return CATALOG.map(c => Object.assign({ id: 'offer-' + c.key, affiliateUrl: '', enabled: c.status !== 'unconfirmed' && c.audience !== 'partner', verifiedAt: '2026-10-19', network: networkOf(c), subIdParam: c.subIdParam !== undefined ? c.subIdParam : SUBID_PARAM[networkOf(c)] || '' }, c));
  }
  /** Adds the sub-ID to an affiliate URL when the network supports one. */
  function withSubId(url, param, sub) {
    if (!param || !sub) return url;
    try { const u = new URL(url); if (!u.searchParams.has(param)) u.searchParams.set(param, sub); return u.toString(); } catch { return url; }
  }
  const AFFILIATE_NOTE = 'Affiliate link — we may earn a commission if you sign up. It doesn’t change your price, and you never have to use it to work with us.';

  // Client-portal redirects. The server records the click, then sends the browser to url above.
  const CREDIT_GO = { myfreescorenow: '/go/credit/myfreescorenow', smartcredit: '/go/credit/smartcredit' };

  const api = { CATALOG, STATUS_LABEL, REFERRAL_STAGES, DISCLOSURE, AFFILIATE_NOTE, SUBID_PARAM, CREDIT_GO, seedOffers, withSubId, networkOf };
  root.Partners = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
