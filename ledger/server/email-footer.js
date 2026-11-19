// Postal address for CAN-SPAM footers on this app's email.
// Email only. Do not copy this into the CROA contract placeholder.
export const CAN_SPAM_POSTAL_ADDRESS = 'Credit Ledger, 2230 Route 70 W Ste 2 PMB 1194, Cherry Hill, NJ 08002';
export const EMAIL_SENDER_NAME = 'Credit Ledger';

export function emailFooter() {
  return `${EMAIL_SENDER_NAME}\n${CAN_SPAM_POSTAL_ADDRESS}`;
}
