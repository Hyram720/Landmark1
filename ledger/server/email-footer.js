// Email footer only. The public legal pages use a different street.
export const CAN_SPAM_POSTAL_ADDRESS = 'Sun Marketing Enterprises LLC, d/b/a Credit Ledger, 2230 Route 70 W Ste 2 PMB 1194, Cherry Hill, NJ 08002';

// Statutory notices. This is the principal address already printed on the public
// legal pages. It is not the email footer above. Fred confirms which street
// belongs on the cancellation notice.
export const LEGAL_COMPANY_NAME = 'Sun Marketing Enterprises LLC';
export const LEGAL_COMPANY_ADDRESS = '2435 Patton St, Camden, NJ 08104';
export const EMAIL_SENDER_NAME = 'Credit Ledger';

export function emailFooter() {
  return CAN_SPAM_POSTAL_ADDRESS;
}
