/**
 * DPA erasure = anonymize-in-place. We overwrite identifying PII on the employee
 * row while preserving the row itself (and its payslip/audit history, which the
 * law requires us to retain). firstName is set to this marker as the sentinel
 * for "already anonymized" (idempotency + gating erasure-request completion).
 */
export const EMPLOYEE_ANON_MARKER = '[ERASED]';

export function isEmployeeAnonymized(firstName: string | null | undefined): boolean {
  return firstName === EMPLOYEE_ANON_MARKER;
}
