/**
 * Permission checks against the set the API embeds in the session (see
 * apps/api/src/auth/permissions.ts — the single source of truth for what
 * each key means; this file only reads the array, never redefines it).
 */
export function hasPermission(permissions: string[] | undefined, key: string): boolean {
  return !!permissions?.includes(key);
}

export function hasAnyPermission(permissions: string[] | undefined, keys: string[]): boolean {
  return keys.some((k) => hasPermission(permissions, k));
}

/**
 * "Is this user an HR-capable actor at all" — for broad UI branching
 * (which dashboard to show, whether the self-service nav gets a top-level
 * or a nested "My space" presentation) rather than gating one specific
 * feature. A plain self-service login (Employee/Manager) holds zero
 * permissions, so any non-empty set means the caller has SOME elevated
 * access — mirrors the old canManageEmployees()'s role of a coarse
 * "am I staff or HR" signal, not a specific capability check.
 */
export function isHrCapable(permissions: string[] | undefined): boolean {
  return (permissions?.length ?? 0) > 0;
}
