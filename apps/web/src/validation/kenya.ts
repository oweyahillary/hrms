/**
 * Client-side mirror of apps/api/src/common/validation/kenya.ts.
 *
 * These are duplicated deliberately: the SPA and API are separate builds, so the
 * form can't import from the API package. The point is to fail fast in the
 * browser with a helpful message — the API remains the authority and re-checks
 * every one of these on submit. If you change a rule here, change it there too.
 */

/** Kenyan national ID: 7–8 digits. */
export const NATIONAL_ID_REGEX = /^\d{7,8}$/;
/** KRA PIN: A/P + 9 digits + a check letter, e.g. A012345678Z. */
export const KRA_PIN_REGEX = /^[AP]\d{9}[A-Z]$/;
/** Kenyan mobile: 07########, 01########, or +2547########/+2541########. */
export const KENYA_PHONE_REGEX = /^(?:\+254|0)(?:7|1)\d{8}$/;

/** KRA PINs are upper-case by definition; accept lower-case typing and fix it. */
export const normalizeKraPin = (v: string): string => v.trim().toUpperCase();

/** Phone numbers are commonly typed with spaces — strip them before validating. */
export const normalizePhone = (v: string): string => v.replace(/[\s-]/g, '');

export const errors = {
  nationalId: 'Enter a 7 or 8 digit national ID',
  kraPin: 'Enter a KRA PIN like A012345678Z',
  phone: 'Enter a Kenyan number like 0712345678',
} as const;
