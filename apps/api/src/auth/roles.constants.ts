/**
 * Roles allowed to manage HR data (employees, org structure) and to see
 * decrypted PII. Role-name based for Phase 1; swap for a permission flag later.
 */
export const HR_MANAGEMENT_ROLES: readonly string[] = ['Admin', 'HR Manager', 'HR Officer'];
