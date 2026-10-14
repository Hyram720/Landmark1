/*
 * Creditor / collector / specialty-bureau address book. Seeded with researched dispute and
 * correspondence addresses (each with its source), plus every address staff type into a dispute,
 * so the book grows with use. Addresses change — verify before mailing.
 */
(function (root) {
  'use strict';

  // [name, aliases, category, address, phone, source, verifiedOn]
  const SEED = [
    ["Capital One", ["CAPITAL ONE", "CAPITAL ONE BANK USA NA", "CAP ONE"], "card issuer", "Capital One\nP.O. Box 31293\nSalt Lake City, UT 84131-1293", "", "https://www.capitalone.com/help-center/credit-cards/disputing-items-on-your-credit-report/", "2026-10-14"],
    ["Capital One Auto Finance", ["CAPITAL ONE AUTO FINANCE", "COAF"], "auto lender", "Credit Bureau Dispute\nP.O. Box 259407\nPlano, TX 75025-9407", "", "https://www.capitalone.com/help-center/credit-cards/disputing-items-on-your-credit-report/", "2026-10-14"],
    ["Capital One (personal loans / deposit accounts)", ["CAPITAL ONE NA"], "bank", "Capital One Consumer Services\nPO Box 30273\nSalt Lake City, UT 84130-0273", "", "https://www.capitalone.com/help-center/credit-cards/disputing-items-on-your-credit-report/", "2026-10-14"],
    ["Capital One (ChexSystems & Early Warning disputes)", [], "bank", "Capital One Bank, Attn: Loss Mitigation Dept\nPO Box 85026\nRichmond, VA 23285", "", "https://www.capitalone.com/help-center/credit-cards/disputing-items-on-your-credit-report/", "2026-10-14"],
    ["Chase Card Services", ["JPMCB CARD", "CHASE CARD", "JPMORGAN CHASE BANK NA", "CHASE", "JPMORGAN CHASE"], "card issuer (general correspondence)", "Chase Card Services\nP.O. Box 15298\nWilmington, DE 19850", "", "https://creditcards.chase.com/southwest/contact-us", "2026-10-14"],
    ["Chase (deposit accounts)", ["CHASE BANK"], "bank (general correspondence)", "PO Box 659809, Internal Mail TX3-7849\nSan Antonio, TX 78265-9109", "1-800-935-9935", "https://www.chase.com/content/dam/chase-ux/documents/personal/checking/deposit-account-agreement.pdf", "2026-10-14"],
    ["Citibank / Citi Cards", ["CITICARDS CBNA", "CITIBANK NA", "CBNA", "CITI", "CITIBANK"], "card issuer", "Citi Brands Credit Bureau Disputes\nPO Box 6241\nSioux Falls, SD 57117", "", "https://online.citi.com/JRS/forms/Credit_Bureau_Dispute_Reporting_Form.pdf", "2026-10-14"],
    ["Citi - Costco Anywhere Visa", ["COSTCO CITI"], "card issuer", "Costco Credit Bureau Disputes\nPO Box 6190\nSioux Falls, SD 57117", "", "https://online.citi.com/JRS/forms/Credit_Bureau_Dispute_Reporting_Form.pdf", "2026-10-14"],
    ["Discover (now Capital One)", ["DISCOVER", "DISCOVER BANK", "DISCOVER FIN SVCS LLC", "DISCOVERCARD"], "card issuer (general correspondence — accounts moving to Capital One)", "Capital One\nPO Box 71083\nCharlotte, NC 28272-1083", "1-800-347-2683", "https://www.discover.com/credit-cards/contact-us/", "2026-10-14"],
    ["American Express", ["AMEX", "AMERICAN EXPRESS NATIONAL BANK"], "card issuer (some business cards use P.O. Box 981556)", "American Express Credit Bureau Unit\nP.O. Box 981537\nEl Paso, TX 79998-1537", "", "https://www.americanexpress.com/content/dam/amex/en-us/company/legal/cardmember-agreements/public-site-2025-q1-pdf-cmas/cps-lending/delta-skymiles-gold-04-03-2025.pdf", "2026-10-14"],
    ["Bank of America", ["BK OF AMER", "BANK OF AMERICA NA"], "card issuer", "Bank of America, N.A., RE: Consumer Reporting Agencies\nP.O. Box 653059\nDallas, TX 75265-3059", "", "https://www.bankofamerica.com/content/documents/creditcard/bank_of_america_customized_cash_rewards_secured_english.pdf", "2026-10-14"],
    ["Wells Fargo - Credit Cards", ["WELLS FARGO CARD SER", "WELLS FARGO", "WELLS FARGO BANK NA"], "card issuer", "Wells Fargo Bank, N.A., Attn: Credit Bureau Disputes\nPO Box 393\nMinneapolis, MN 55480-0393", "", "https://www.wellsfargo.com/help/addresses/", "2026-10-14"],
    ["Wells Fargo - Auto / Personal Lending / Education", ["WELLS FARGO AUTO", "WELLS FARGO DEALER SVCS", "WELLS FARGO EDUCATION FINANCIAL SERVICES"], "auto lender", "Wells Fargo, Attn: Credit Bureau Operations, MAC D1127-028\nPO Box 71092\nCharlotte, NC 28272", "", "https://www.wellsfargo.com/help/addresses/", "2026-10-14"],
    ["Wells Fargo - Home Mortgage / Home Equity", ["WELLS FARGO HOME MORTGAGE", "WELLS FARGO HM MORTGAG"], "mortgage servicer", "Wells Fargo Bank, N.A., Attn: Credit Bureau Disputes\nPO Box 10335\nDes Moines, IA 50306", "", "https://www.wellsfargo.com/help/addresses/", "2026-10-14"],
    ["Wells Fargo - Checking/Savings (Early Warning disputes)", [], "bank", "Wells Fargo Bank, N.A., Attn: Deposit Furnishing Disputes, MAC F2304-019\nPO Box 50947\nDes Moines, IA 50340", "", "https://www.wellsfargo.com/help/addresses/", "2026-10-14"],
    ["Synchrony Bank", ["SYNCB", "SYNCB/AMAZON", "SYNCB/LOWES", "SYNCB/CARE CREDIT", "SYNCHRONY"], "card issuer (confirm against a current statement)", "Synchrony Bank\nP.O. Box 965036\nOrlando, FL 32896-5036", "", "https://consumercenter.mysynchrony.com/cs/groups/public/documents/cc_disclosure/dsc038865.pdf", "2026-10-14"],
    ["Credit One Bank", ["CREDIT ONE BANK NA", "CREDIT ONE"], "card issuer (general correspondence)", "Credit One Bank\nP.O. Box 98873\nLas Vegas, NV 89193-8873", "1-877-825-3242", "https://www.creditonebank.com/help", "2026-10-14"],
    ["Barclays US", ["BARCLAYS BANK DELAWARE", "BRCLYSBANKDE", "BARCLAYCARD", "BARCLAYS"], "card issuer", "Card Services, Credit Bureau Disputes\nP.O. Box 8803\nWilmington, DE 19899-8803", "888-232-0780", "https://www.barclaycardus.com/servicing/headerLinks?handleContactUs=", "2026-10-14"],
    ["U.S. Bank - Credit Cards / Personal Line of Credit", ["US BANK", "U S BANK", "US BANK NA", "ELAN FINANCIAL"], "card issuer", "U.S. Bank NA Consumer Recovery Department, Attn: CBR Disputes\nP.O. Box 108\nSt. Louis, MO 63166-0108", "", "https://www.usbank.com/customer-service/knowledge-base/KB0261207.html", "2026-10-14"],
    ["U.S. Bank - Checking/Savings, Personal & Auto Loans, HELOC", [], "bank", "U.S. Bank, Attn: Consumer Bureau Dispute Handling (CBDH)\nPO Box 3447\nOshkosh, WI 54903-3447", "844-624-8230", "https://www.usbank.com/customer-service/knowledge-base/KB0261207.html", "2026-10-14"],
    ["U.S. Bank - Home Mortgage", ["US BANK HOME MORTGAGE"], "mortgage servicer", "U.S. Bank, Attn: Consumer Bureau Management Department\nPO Box 21844\nEagan, MN 55121", "", "https://www.usbank.com/customer-service/knowledge-base/KB0261207.html", "2026-10-14"],
    ["Comenity Capital Bank (Bread Financial)", ["COMENITY CAPITAL BANK", "COMENITYCAPITAL", "CCB", "BREAD FINANCIAL", "COMENITY"], "card issuer", "Comenity Capital Bank\nP.O. Box 183003\nColumbus, OH 43218-3003", "", "https://breadfinancial.com/en/help-center/getintouch-creditcards.html", "2026-10-14"],
    ["TD Bank", ["TD BANK NA", "TD BANK USA", "TD AUTO FINANCE"], "bank", "TD Bank, Credit Disputes\nP.O. Box 71466\nPhiladelphia, PA 19176-1466", "", "https://www.td.com/content/dam/tdb/document/pdf/personal-banking/consumer-credit-report-dispute-form-en.pdf", "2026-10-14"],
    ["TD Retail Card Services (store cards)", ["TD RCS"], "card issuer", "TD Bank c/o Credit Dispute Processing\nP.O. Box 100270\nColumbia, SC 29202", "", "https://www.td.com/content/dam/tdb/document/pdf/personal-banking/consumer-credit-report-dispute-form-en.pdf", "2026-10-14"],
    ["Target Credit Card (TD Bank USA)", ["TD BANK USA/TARGETCRED", "TARGET NB", "TARGET"], "card issuer", "Target Card Services\nP.O. Box 9500\nMinneapolis, MN 55440", "", "https://www.td.com/content/dam/tdb/document/pdf/personal-banking/consumer-credit-report-dispute-form-en.pdf", "2026-10-14"],
    ["Navy Federal Credit Union", ["NAVY FCU", "NAVY FEDERAL CR UNION", "NFCU", "NAVY FEDERAL"], "credit union", "Navy Federal Credit Union (Credit Bureau Disputes)\nPO Box 3700\nMerrifield, VA 22119-3700", "1-888-842-6328", "https://www.navyfederal.org/contact-us/additional-mailing-addresses.html", "2026-10-14"],
    ["Merrick Bank", ["MERRICK BK"], "card issuer (general correspondence)", "Merrick Bank Customer Service\nP.O. Box 9201\nOld Bethpage, NY 11804-9001", "(800) 204-5936", "https://www.merrickbank.com/help", "2026-10-14"],
    ["OneMain Financial", ["ONEMAIN", "OMF", "SPRINGLEAF"], "personal lender", "OneMain Financial\nPO Box 3327\nEvansville, IN 47732-3327", "", "https://www.onemainfinancial.com/credit-bureau", "2026-10-14"],
    ["Mission Lane", ["MISSION LANE LLC", "MISSION LANE TAB BANK", "TAB BANK"], "card issuer", "Mission Lane LLC, Attn: Credit Reporting\nP.O. Box 105286\nAtlanta, GA 30348-5286", "1-855-790-8860", "https://www.missionlane.com/legal/the-mission-lane-visa-credit-card-issued-by-transportation-alliance-bank-inc-dba-tab-bank", "2026-10-14"],
    ["Upstart", ["UPSTART NETWORK INC", "UPST", "UPSTART FINANCE"], "personal lender", "Upstart Network\nP.O. Box 1503\nSan Carlos, CA 94070", "", "https://upstarthelp.upstart.com/i-see-a-discrepancy-in-my-credit-data-what-can-i-do", "2026-10-14"],
    ["LendingClub (now Happen Bank)", ["LENDINGCLUB", "LENDING CLUB CORP", "LENDINGCLUB BANK", "HAPPEN BANK"], "personal lender", "Happen Bank, Attn: Credit Dispute\n88 Kearny Street, Suite 600\nSan Francisco, CA 94108", "", "https://www.lendingclub.com/help/general-faq/how-do-i-correct-discrepancies-in-my-credit-report", "2026-10-14"],
    ["Ally Financial", ["ALLY BANK", "ALLY AUTO", "ALLY"], "auto lender (general correspondence)", "Ally Financial\nP.O. Box 380901\nBloomington, MN 55438", "1-888-925-2559", "https://www.ally.com/contact-us/", "2026-10-14"],
    ["Santander Consumer USA", ["SCUSA", "CHRYSLER CAPITAL", "SANTANDER CONSUMER", "SANTANDER"], "auto lender", "Santander Consumer USA Credit Bureau Disputes\nPO Box 961211\nFort Worth, TX 76161", "", "https://santanderconsumerusa.com/learning-center/about-your-credit", "2026-10-14"],
    ["Toyota Financial Services", ["TOYOTA MOTOR CREDIT", "TOYOTA MOTOR CREDIT CO", "TMCC", "LEXUS FINANCIAL SERVICES"], "auto lender", "Toyota Financial Services\nP.O. Box 661009\nDallas, TX 75265", "", "https://www.toyotafinancial.com/us/en/planning_tools/faq/about_credit/how_can_i_submit_a_dispute_about_incorrect_credit_information_reported_to_the_credit_bureaus.html", "2026-10-14"],
    ["Ford Credit", ["FORD CRED", "FORD MOTOR CREDIT", "FORD MOTOR CREDIT COMPANY LLC", "LINCOLN AUTOMOTIVE FINANCIAL"], "auto lender", "Ford Credit, Credit Dispute Department\nPO Box 35910\nCleveland, OH 44135-0910", "1-800-727-7000", "https://www.ford.com/finance/customer-support/special-situations/how-can-i-dispute-an-inaccuracy-on-my-credit-report/", "2026-10-14"],
    ["GM Financial", ["AMERICREDIT", "GENERAL MOTORS FINANCIAL", "AMCR"], "auto lender", "GM Financial, Credit Disputes\nP.O. Box 181145\nArlington, TX 76096-1145", "1-800-284-2271", "https://www.gmfinancial.com/content/dam/gmf/myaccount/documents/Sample-Statement.pdf", "2026-10-14"],
    ["Westlake Financial", ["WESTLAKE FINANCIAL SERVICES", "WESTLAKE FIN SVCS"], "auto lender", "Westlake Financial\nP.O. Box 76814\nLos Angeles, CA 90076", "(888) 739-9192", "https://www.westlakefinancial.com/contact-us/", "2026-10-14"],
    ["Credit Acceptance", ["CREDIT ACCEPTANCE CORP", "CAC"], "auto lender", "Credit Acceptance\nPO Box 5070\nSouthfield, MI 48086-5070", "1-877-523-4044", "https://www.creditacceptance.com/customers/faq", "2026-10-14"],
    ["Exeter Finance", ["EXETER FINANCE LLC", "EXETER FINANCE CORP"], "auto lender", "Exeter Finance LLC\nP.O. Box 166097\nIrving, TX 75016", "(800) 321-9637", "https://www.exeterfinance.com/faqs", "2026-10-14"],
    ["MOHELA", ["DEPT OF ED/MOHELA", "MOHELA/DOFED", "NAVIENT"], "student loan servicer (general correspondence; now services Navient loans)", "MOHELA\nP.O. Box 9500\nWilkes-Barre, PA 18773-9500", "888-272-5543", "https://servicing.mohela.com/contact-us/", "2026-10-14"],
    ["Nelnet", ["DEPT OF EDUCATION/NELN", "DEPT OF ED/NELNET"], "student loan servicer (general correspondence)", "Nelnet\nP.O. Box 82561\nLincoln, NE 68501-2561", "", "https://nelnet.studentaid.gov/content/contactus", "2026-10-14"],
    ["Aidvantage", ["DEPT OF ED/AIDVANTAGE"], "student loan servicer (general correspondence)", "Aidvantage - Federal Student Aid Loan Servicing\nP.O. Box 300001\nGreenville, TX 75403-3001", "800-722-1300", "https://aidvantage.studentaid.gov/contact-us", "2026-10-14"],
    ["Edfinancial Services", ["EDFINANCIAL", "DEPT OF ED/EDFINANCIAL"], "student loan servicer", "Edfinancial Services, Attention: Credit Disputes\nP.O. Box 30159\nKnoxville, TN 37930-0159", "", "https://edfinancial.studentaid.gov/credit-reporting", "2026-10-14"],
    ["U.S. Department of Education - Default Resolution Group", ["US DEPT OF ED", "DEPT OF EDUCATION", "DEFAULT RESOLUTION GROUP", "US DEPT ED DRG"], "student loan servicer", "U.S. Department of Education, Default Resolution Group\nP.O. Box 5609\nGreenville, TX 75403-5609", "", "https://studentaid.gov/help-center/answers/article/how-to-contact-default-resolution-group", "2026-10-14"],
    ["Sallie Mae", ["SALLIE MAE BANK", "SLM"], "student loan servicer", "Sallie Mae\nP.O. Box 3229\nWilmington, DE 19804-0229", "855-756-5626", "https://www.salliemae.com/contact-us/", "2026-10-14"],
    ["Midland Credit Management", ["MIDLAND FUNDING", "MCM", "ENCORE CAPITAL", "MIDLAND"], "debt buyer", "Attn: Consumer Support Services\n320 E Big Beaver Rd, Suite 300\nTroy, MI 48083", "(800) 296-2657", "https://www.midlandcredit.com/sms/", "2026-10-14"],
    ["Portfolio Recovery Associates", ["PORTFOLIO RECOVERY ASSOCIATES LLC", "PORTFOLIO RECOVERY", "PRA"], "debt buyer", "ATTN: Disputes, Portfolio Recovery Associates, LLC\n120 Corporate Blvd\nNorfolk, VA 23502", "1-800-772-1413", "https://www.portfoliorecovery.com/prapay/contact-us", "2026-10-14"],
    ["LVNV Funding / Resurgent Capital Services", ["LVNV FUNDING LLC", "LVNV", "RESURGENT CAPITAL SERVICES", "RESURGENT", "CACH LLC"], "debt buyer", "Resurgent Capital Services\nP.O. Box 10497\nGreenville, SC 29603", "1-888-665-0374", "https://www.resurgent.com/", "2026-10-14"],
    ["Jefferson Capital Systems", ["JEFFERSON CAPITAL SYSTEMS LLC", "JEFFERSON CAPITAL", "JCAP"], "debt buyer", "Jefferson Capital\n200 14th Ave E\nSartell, MN 56377", "1-833-851-5552", "https://www.jcap.com/contact-us", "2026-10-14"],
    ["Cavalry SPV / Cavalry Portfolio Services", ["CAVALRY SPV I LLC", "CAVALRY PORTFOLIO SERVICES", "CAVALRY SPV II", "CAVALRY"], "debt buyer", "Cavalry Portfolio Services, Attn: Customer Care\n1 American Lane, Suite 220\nGreenwich, CT 06831-2200", "1-866-483-5139", "https://www.cavalryportfolioservices.com/faq", "2026-10-14"],
    ["Enhanced Recovery Company (ERC)", ["ENHANCED RECOVERY CO L", "ENHANCED RECOVERY COMPANY LLC", "ERC"], "collection agency", "ERC\nP.O. Box 57610\nJacksonville, FL 32241", "800-383-5979", "https://ercglobalcx.com/faqs/how-to-make-a-payment/", "2026-10-14"],
    ["IC System", ["I C SYSTEM INC", "ICS"], "collection agency", "IC System\n444 Highway 96 E, PO Box 64378\nSt. Paul, MN 55164-0378", "800-279-7244", "https://pay.icsystem.com/", "2026-10-14"],
    ["Credit Collection Services (CCS)", ["CREDIT COLLECTION SERVICES", "CCS", "THE CCS COMPANIES"], "collection agency", "Credit Collection Services\n725 Canton Street\nNorwood, MA 02062", "(617) 965-2000", "https://www.ccsusa.com/contact_us.html", "2026-10-14"],
    ["Transworld Systems Inc (TSI)", ["TRANSWORLD SYSTEMS INC", "TSI", "TRANSWORLD SYS INC"], "collection agency", "Transworld Systems Inc\nP.O. Box 15618\nWilmington, DE 19850-5618", "866-228-9034", "https://payments.tsico.com/", "2026-10-14"],
    ["National Credit Systems", ["NATIONAL CREDIT SYSTEMS INC", "NCS"], "collection agency", "National Credit Systems, Inc.\nPO Box 672288\nMarietta, GA 30006", "800-367-1050", "https://www.nationalcreditsystems.com/Contactus.aspx", "2026-10-14"],
    ["Credence Resource Management", ["CREDENCE RESOURCE MANAGEMENT LLC", "CREDENCE RM", "CREDENCE"], "collection agency", "Credence Resource Management (Correspondence)\nPO Box 2300\nSouthgate, MI 48195-4300", "855-880-4791", "https://credencerm.com/contact-us", "2026-10-14"],
    ["Waypoint Resource Group", ["WAYPOINT RESOURCE GROUP LLC", "WAYPOINT RESOURCE GRP"], "collection agency", "Waypoint Resource Group LLC\n1065 W Levoy Dr, Ste 100\nTaylorsville, UT 84123", "(866) 447-4163", "https://waypoint.com/help/disputes/contact-form-dispute/", "2026-10-14"],
    ["Southwest Credit Systems", ["SOUTHWEST CREDIT SYSTEMS LP", "SOUTHWEST CREDIT", "SWC GROUP"], "collection agency", "Southwest Credit Systems\n4120 International Parkway, Suite 1100\nCarrollton, TX 75007", "800-637-7439", "https://www.swcconsumer.com/contact-us", "2026-10-14"],
    ["Radius Global Solutions", ["RADIUS GLOBAL SOLUTIONS LLC", "RADIUS GS"], "collection agency (corporate HQ only)", "Radius Global Solutions\n7505 Metro Blvd, Suite 400\nEdina, MN 55439", "", "https://www.radiusgs.com/contact/", "2026-10-14"],
    ["Innovis", ["INNOVIS DATA SOLUTIONS", "CBC INNOVIS"], "specialty bureau", "Innovis Consumer Assistance\nP.O. Box 530088\nAtlanta, GA 30353-0088", "800-540-2505", "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/consumer-reporting-companies/companies-list/innovis/", "2026-10-14"],
    ["ChexSystems", ["CHEX SYSTEMS INC", "CHEX SYSTEMS"], "specialty bureau", "Chex Systems, Inc., Attn: Consumer Relations\nP.O. Box 583399\nMinneapolis, MN 55458", "800-428-9623", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"],
    ["Early Warning Services", ["EARLY WARNING SERVICES LLC", "EWS", "EARLY WARNING"], "specialty bureau", "Early Warning, Attn: Consumer Services Department\n5801 N. Pima Rd\nScottsdale, AZ 85250", "800-745-1560", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"],
    ["LexisNexis Risk Solutions Consumer Center", ["LEXISNEXIS", "LEXISNEXIS RISK SOLUTIONS", "LEXISNEXIS C.L.U.E."], "specialty bureau", "LexisNexis Risk Solutions, Consumer Center\nP.O. Box 105108\nAtlanta, GA 30348-5108", "866-897-8126", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"],
    ["SageStream (LexisNexis)", ["SAGESTREAM LLC", "SAGESTREAM"], "specialty bureau", "SageStream, LLC, LexisNexis Risk Solutions Consumer Center\nP.O. Box 105108\nAtlanta, GA 30348-5108", "866-897-8126", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"],
    ["Clarity Services (Experian)", ["CLARITY SERVICES INC", "CLARITY"], "specialty bureau", "Clarity Services, Inc., Consumer Support Division\nP.O. Box 16\nAllen, TX 75013", "866-390-3118", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"],
    ["CoreLogic Credco (Cotality)", ["CORELOGIC CREDCO", "CREDCO", "COTALITY CREDCO"], "specialty bureau", "Credco Consumer Services Department\nP.O. Box 509124\nSan Diego, CA 92150", "(800) 637-2422", "https://www.cotality.com/legal/credco-consumer-assistance", "2026-10-14"],
    ["SafeRent Solutions", ["SAFERENT", "CORELOGIC SAFERENT"], "tenant screening", "SafeRent Solutions, Consumer Relations\nP.O. Box 3890\nCoppell, TX 75019", "888-333-2413", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"],
    ["TransUnion Rental Screening Solutions (SmartMove)", ["TRANSUNION RENTAL SCREENING", "SMARTMOVE", "TURSS"], "tenant screening", "TransUnion Rental Screening Solutions, Attention: Consumer Dispute Team\nP.O. Box 800\nWoodlyn, PA 19094", "800-230-9376", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"],
    ["RealPage Screening (LeasingDesk)", ["REALPAGE", "LEASINGDESK SCREENING", "LEASINGDESK"], "tenant screening", "LeasingDesk Screening, Attn: Consumer Relations\n2201 Lakeside Blvd.\nRichardson, TX 75082", "866-934-1124", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"],
    ["National Consumer Telecom & Utilities Exchange (NCTUE)", ["NCTUE", "EXCHANGE SERVICE CENTER"], "specialty bureau", "Exchange Service Center - NCTUE\nP.O. Box 105161\nAtlanta, GA 30348", "866-343-2821", "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/consumer-reporting-companies/companies-list/national-consumer-telecom-utilities-exchange/", "2026-10-14"],
    ["MicroBilt / PRBC", ["MICROBILT", "PRBC", "MICROBILT CORPORATION"], "specialty bureau", "MicroBilt, Attn: Consumer Affairs Department\nP.O. Box 440693\nKennesaw, GA 30160", "888-222-7621", "https://files.consumerfinance.gov/f/documents/cfpb_consumer-reporting-companies_list_2025.pdf", "2026-10-14"]
  ];

  const STOP = new Set(['llc', 'inc', 'na', 'n', 'a', 'co', 'corp', 'corporation', 'company', 'the', 'usa', 'us', 'of', 'and', 'services', 'service', 'financial', 'bank', 'card', 'cards', 'credit', 'lp', 'ltd']);
  const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).join(' ');

  const seed = () => SEED.map(([name, aliases, category, address, phone, source, verifiedOn]) => ({ name, aliases, category, address, phone, source, verifiedOn, origin: 'research' }));

  /** All entries: researched seed + saved book + addresses used on past disputes. */
  function all(ws) {
    const out = seed();
    (ws && ws.addressBook || []).forEach(e => out.push(Object.assign({ origin: 'saved', aliases: [] }, e)));
    const seen = new Set(out.map(e => norm(e.name)));
    (ws && ws.disputes || []).forEach(d => {
      if (!d.recipientAddress || !d.recipient || /consumerfinance\.gov/.test(d.recipientAddress)) return;
      const k = norm(d.recipient);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push({ name: d.recipient, aliases: [], category: 'used before', address: d.recipientAddress, origin: 'history' });
    });
    return out;
  }

  /** Best match for a creditor name, or null. Exact normalized match on name or alias first, then prefix. */
  function lookup(ws, name) {
    const k = norm(name);
    if (!k) return null;
    const list = all(ws);
    const keys = e => [e.name].concat(e.aliases || []).map(norm).filter(Boolean);
    return list.find(e => keys(e).includes(k)) || list.find(e => keys(e).some(x => x.length > 3 && (k.startsWith(x + ' ') || x.startsWith(k + ' ')))) || null;
  }

  function search(ws, q) {
    const k = norm(q);
    const list = all(ws);
    if (!k) return list;
    return list.filter(e => [e.name].concat(e.aliases || []).some(n => norm(n).includes(k)) || String(e.category || '').toLowerCase().includes(String(q).toLowerCase()));
  }

  /** Save or update an address in the workspace book. */
  function remember(ws, name, address, category) {
    if (!name || !address) return;
    ws.addressBook = ws.addressBook || [];
    const k = norm(name);
    const hit = ws.addressBook.find(e => norm(e.name) === k);
    if (hit) Object.assign(hit, { address, category: category || hit.category });
    else ws.addressBook.push({ name, address, category: category || 'saved', aliases: [] });
  }

  const api = { SEED, all, lookup, search, remember, norm };
  root.Furnishers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
