/** Kenyan national ID: 7–8 digits. */
export const NATIONAL_ID_REGEX = /^\d{7,8}$/;
/** KRA PIN: A/P + 9 digits + a check letter, e.g. A012345678Z. */
export const KRA_PIN_REGEX = /^[AP]\d{9}[A-Z]$/;
/** Kenyan mobile: 07########, 01########, or +2547########/+2541########. */
export const KENYA_PHONE_REGEX = /^(?:\+254|0)(?:7|1)\d{8}$/;
