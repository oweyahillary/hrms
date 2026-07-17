/**
 * Client mirror of apps/api/src/employees/employee-number.ts.
 *
 * Same deal as validation/kenya.ts: the SPA can't import from the API package,
 * so these rules are duplicated to give instant feedback and a live preview.
 * The API re-validates everything. Change one, change the other.
 */

export const EMPLOYEE_NUMBER_PREFIX_REGEX = /^[A-Za-z0-9_-]{1,12}$/;

export const MIN_PADDING = 1;
export const MAX_PADDING = 8;

/** Widens rather than truncating once the counter outgrows the padding. */
export function formatEmployeeNumber(prefix: string, padding: number, seq: number): string {
  return `${prefix}${String(seq).padStart(padding, '0')}`;
}

export const prefixError = 'Use 1-12 letters, digits, hyphen or underscore — no spaces';
