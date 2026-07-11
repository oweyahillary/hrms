/**
 * Roles allowed to see DECRYPTED PII (national ID, KRA PIN, bank account) and to
 * create/update/terminate employees. Everyone else sees masked values on reads.
 * Role-name based for Phase 1; a permission flag can replace this later.
 */
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

export const PII_PRIVILEGED_ROLES = HR_MANAGEMENT_ROLES;

export function isPiiPrivileged(role?: string): boolean {
  return !!role && PII_PRIVILEGED_ROLES.includes(role);
}

/** Mask all but the last 4 characters (e.g. '12345678' -> '****5678'). */
export function maskLast4(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value);
  if (s.length <= 4) return '*'.repeat(s.length);
  return '*'.repeat(s.length - 4) + s.slice(-4);
}

/** Choose the visible form of a decrypted PII value based on the caller's role. */
export function presentPii(plaintext: string | null, privileged: boolean): string | null {
  if (plaintext == null) return null;
  return privileged ? plaintext : maskLast4(plaintext);
}
