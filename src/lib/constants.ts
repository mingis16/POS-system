/** Identifies the phone/tablet/laptop in the audit trail. */
export const DEVICE_COOKIE = "sl_device";
/** The business the user is working in, when they belong to more than one. */
export const BUSINESS_COOKIE = "sl_business";
/** Synthetic e-mail domain for staff logins created by the owner (no e-mail needed). */
export const STAFF_LOGIN_DOMAIN = "staff.saloneledger.app";
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "SaloneLedger";
