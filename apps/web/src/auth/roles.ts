/** Roles allowed to manage the organisation (mirrors the API's HR_MANAGEMENT_ROLES). */
export const HR_MANAGEMENT_ROLES = ['Admin', 'HR Manager', 'HR Officer'];

export const canManageOrg = (role?: string): boolean =>
  role != null && HR_MANAGEMENT_ROLES.includes(role);
