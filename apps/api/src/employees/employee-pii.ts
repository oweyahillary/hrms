import { hasPermission, type GrantedPermission } from '../auth/permissions';

/**
 * Gates seeing DECRYPTED PII (national ID, KRA PIN, bank account) on the
 * pii.view permission. Everyone else sees masked values on reads. pii.view
 * is not scopeable — it's ALL-or-nothing regardless of department.
 */
export function isPiiPrivileged(permissions: readonly GrantedPermission[]): boolean {
  return hasPermission(permissions, 'pii.view');
}

/** Mask all but the last 4 characters (e.g. '12345678' -> '****5678'). */
export function maskLast4(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value);
  if (s.length <= 4) return '*'.repeat(s.length);
  return '*'.repeat(s.length - 4) + s.slice(-4);
}

/** Choose the visible form of a decrypted PII value based on the caller's permissions. */
export function presentPii(plaintext: string | null, privileged: boolean): string | null {
  if (plaintext == null) return null;
  return privileged ? plaintext : maskLast4(plaintext);
}
