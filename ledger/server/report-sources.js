// Where clients get a credit report to bring into Ledger.
// MyCreditIQ has no public API, partner feed or webhook we could find, so the report cannot come back
// on its own: the client (or staff) downloads it there and uploads it here. See RESEARCH.md → MyCreditIQ.

export const REPORT_SOURCES = ['MyCreditIQ', 'MyFreeScoreNow', 'IdentityIQ', 'SmartCredit', 'MyScoreIQ', 'AnnualCreditReport.com', 'Other'];

export const MYCREDITIQ_DEFAULT_URL = 'https://www.mycreditiq.com/';

/** Normalises a report source from a form field; unknown values become '' (not tagged). */
export function reportSource(v) {
  const s = String(v || '').trim().toLowerCase();
  return REPORT_SOURCES.find(x => x.toLowerCase() === s) || '';
}

/**
 * The MyCreditIQ link shown to staff and clients.
 * MYCREDITIQ_URL overrides the address (https only). MYCREDITIQ_REF adds an affiliate/referral code as
 * ?ref=… (or the parameter named in MYCREDITIQ_REF_PARAM). Anything invalid falls back to the default.
 */
export function myCreditIqUrl(env = process.env) {
  let u;
  try { u = new URL(String(env.MYCREDITIQ_URL || '').trim() || MYCREDITIQ_DEFAULT_URL); } catch { u = new URL(MYCREDITIQ_DEFAULT_URL); }
  if (u.protocol !== 'https:' || u.username || u.password) u = new URL(MYCREDITIQ_DEFAULT_URL);
  const ref = String(env.MYCREDITIQ_REF || '').trim();
  const param = String(env.MYCREDITIQ_REF_PARAM || 'ref').trim();
  if (ref && /^[\w.-]{1,64}$/.test(ref) && /^[A-Za-z][\w-]{0,31}$/.test(param)) u.searchParams.set(param, ref);
  return u.toString();
}

/** Public, non-secret info the staff app and client portal use to show the MyCreditIQ steps. */
export function reportSourcesInfo(env = process.env) {
  return {
    mycreditiq: {
      name: 'MyCreditIQ',
      url: myCreditIqUrl(env),
      // No public API or partner feed exists, so the report never comes back automatically.
      autoReturn: false,
      formats: ['PDF', 'HTML (saved web page)']
    }
  };
}
