/**
 * Employee number auto-numbering.
 *
 * Format is a fixed prefix plus a zero-padded per-organisation counter:
 *   prefix "VIVO",   padding 4, seq 1  -> VIVO0001
 *   prefix "RCLFIN", padding 3, seq 1  -> RCLFIN001
 *   prefix "EMP-",   padding 3, seq 1  -> EMP-001
 *
 * Kept free of Nest/Prisma so it can be reasoned about and tested on its own.
 */

/**
 * Prefixes are short, human-typed identifiers that appear on payslips and bank
 * files. Letters, digits, hyphen and underscore only — no whitespace (it would
 * be invisible in a payslip and break CSV exports).
 */
export const EMPLOYEE_NUMBER_PREFIX_REGEX = /^[A-Za-z0-9_-]{1,12}$/;

export const MIN_PADDING = 1;
export const MAX_PADDING = 8;

/**
 * Build an employee number. Note `padStart` widens but never truncates: once the
 * counter outgrows the padding, numbers simply get longer (VIVO99999) rather
 * than silently colliding by losing digits.
 */
export function formatEmployeeNumber(prefix: string, padding: number, seq: number): string {
  return `${prefix}${String(seq).padStart(padding, '0')}`;
}

export const isValidPrefix = (v: string): boolean => EMPLOYEE_NUMBER_PREFIX_REGEX.test(v);

export const isValidPadding = (v: number): boolean =>
  Number.isInteger(v) && v >= MIN_PADDING && v <= MAX_PADDING;
