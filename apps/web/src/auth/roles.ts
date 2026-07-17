/** Roles allowed to manage the organisation (mirrors the API's HR_MANAGEMENT_ROLES). */
export const HR_MANAGEMENT_ROLES = ['Admin', 'HR Manager', 'HR Officer'];

export const canManageOrg = (role?: string): boolean =>
  role != null && HR_MANAGEMENT_ROLES.includes(role);

/**
 * Roles allowed to create/edit/terminate employees and see unmasked PII.
 * The API gates these on PII_PRIVILEGED_ROLES, which is the same list as
 * HR_MANAGEMENT_ROLES — but it's a different decision, so it gets its own name
 * here rather than reusing canManageOrg and hiding the intent.
 */
export const canManageEmployees = (role?: string): boolean =>
  role != null && HR_MANAGEMENT_ROLES.includes(role);
