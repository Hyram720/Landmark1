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
      url: 'https://www.myfreescorenow.com/', joinUrl: 'https://www.myfreescorenow.com/',
      program: 'Affiliate (direct; network listings vary)', bonus: '$6 per trial to $50–$60 per sale (reported)',
      bonusLow: 6, bonusHigh: 60, cookie: '1 day (reported)', status: 'verify',
      note: 'Common report source for Metro 2 software (“MFSN import”). Listings conflict and some network listings are closed. Ask MFSN about its credit-professional program.',
      sources: ['https://getlasso.co/affiliate/myfreescorenow-com/', 'https://www.flexoffers.com/affiliate-programs/myfreescorenow-com-affiliate-program/', 'https://www.affpaying.com/myfreescorenow'] },
    { key: 'smartcredit', name: 'SmartCredit', audience: 'personal', category: '3-bureau monitoring (report pulls)',
      url: 'https://www.smartcredit.com/', joinUrl: 'https://www.flexoffers.com/affiliate-programs/smartcredit-affiliate-program/',
      program: 'Affiliate (CJ, FlexOffers)', bonus: '$10–$24 per subscription (reported)',
      bonusLow: 10, bonusHigh: 24, cookie: '30–45 days (reported)', status: 'verify',
      note: 'Listings conflict and one shows the program as closed on a network. Check with SmartCredit directly.', sources: ['https://www.flexoffers.com/affiliate-programs/smartcredit-affiliate-program/', 'https://www.revshare.so/programs/advertiser/smartcredit-b3e2a826'] },
    { key: 'myscoreiq', name: 'MyScoreIQ', audience: 'personal', category: '3-bureau monitoring (report pulls)',
      url: 'https://www.myscoreiq.com/', joinUrl: 'https://www.idiq.com/partnerships/affiliate-partners',
      program: 'Affiliate (IDIQ, FlexOffers)', bonus: 'Up to $21–$100 per enrollment (reported)',
      bonusLow: 21, bonusHigh: 21, cookie: '—', status: 'verify',
      note: 'IDIQ brand.', sources: ['https://www.creator-hero.com/blog/myscoreiq-affiliate-program-in-depth-review-pros-and-cons'] },
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

  function seedOffers() {
    return CATALOG.map(c => Object.assign({ id: 'offer-' + c.key, affiliateUrl: '', enabled: c.status !== 'unconfirmed', verifiedAt: '2026-10-14' }, c));
  }

  const api = { CATALOG, STATUS_LABEL, REFERRAL_STAGES, DISCLOSURE, seedOffers };
  root.Partners = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
