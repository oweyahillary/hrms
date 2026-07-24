/**
 * The permission catalogue that replaces role-NAME matching (the deprecated
 * HR_MANAGEMENT_ROLES / PII_PRIVILEGED_ROLES / @Roles('Admin')) as the
 * authorization mechanism. Every key here corresponds to a real @Roles()
 * gate that existed before this migration — derived from an audit of every
 * @Roles() call site and every inline role-name check in the codebase, not
 * invented. See the org-structure-admin PR description for the full
 * before/after access matrix.
 */
export interface PermissionDef { key: string; label: string; description: string; }

export const PERMISSIONS: readonly PermissionDef[] = [
  {
    key: 'employees.write',
    label: 'Manage employees',
    description: 'Create, update and terminate employee records; upload or remove their documents; provision logins.',
  },
  {
    key: 'employees.anonymize',
    label: 'Erase employee data (DSR)',
    description: 'Anonymize a terminated employee’s PII to complete a data-subject erasure request. Admin-only today.',
  },
  {
    key: 'pii.view',
    label: 'View unmasked PII',
    description: 'See decrypted national ID, KRA PIN and bank account numbers instead of masked values; search by national ID.',
  },
  {
    key: 'users.manage',
    label: 'Manage users & roles',
    description: 'Create/deactivate logins, change roles, force password resets, and administer custom roles. Admin-only today.',
  },
  {
    key: 'org_structure.manage',
    label: 'Manage departments & job titles',
    description: 'Create, rename, re-parent, deactivate and delete departments and job titles.',
  },
  {
    key: 'leave.manage',
    label: 'Manage leave',
    description: 'Administer leave types, balances, rollover and accrual runs; act on any employee’s leave requests; be assigned as an approver.',
  },
  {
    key: 'shifts.manage',
    label: 'Manage shifts & holidays',
    description: 'Create shift definitions, build the roster, and maintain the public holiday calendar.',
  },
  {
    key: 'attendance.manage',
    label: 'Manage attendance',
    description: 'Record and import attendance, and manage biometric devices.',
  },
  {
    key: 'compliance.manage',
    label: 'Manage compliance',
    description: 'Consent, data retention, data-subject requests and breach incidents.',
  },
  {
    key: 'settings.manage',
    label: 'Manage organisation settings',
    description: 'Branding, leave-approval policy, employee numbering, payroll rounding and attendance grace settings.',
  },
  {
    key: 'statutory_rates.manage',
    label: 'Manage statutory rates',
    description: 'Edit PAYE/NSSF/SHIF/AHL rate versions. Admin-only today — narrower than settings.manage.',
  },
  {
    key: 'payroll.run',
    label: 'Run payroll',
    description: 'Create, view and correct payroll runs; preview statutory breakdowns.',
  },
  {
    key: 'payroll.finalize',
    label: 'Finalize payroll',
    description: 'Lock a draft payroll run so its payslips become immutable.',
  },
  {
    key: 'payroll.manage',
    label: 'Manage payroll configuration & reports',
    description: 'Salary structures, loans/advances, one-off adjustments, severance, bank exports, P9/P10 and payroll reports.',
  },
];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);

const ADMIN_ONLY = ['employees.anonymize', 'users.manage', 'statutory_rates.manage'];
/** Every permission except the three that were @Roles('Admin')-only before this migration. */
const HR_MANAGEMENT_SET = PERMISSION_KEYS.filter((k) => !ADMIN_ONLY.includes(k));

/**
 * The historically-known role names and the permission set that reproduces
 * their PRE-migration access exactly.
 *
 * 'Manager' and 'Employee' get nothing: neither was ever a member of the old
 * HR_MANAGEMENT_ROLES array, so a login granted the 'Manager' role today has
 * ZERO elevated access — identical to 'Employee'. That's very likely not
 * what "Manager" was meant to imply, but changing it would NOT be a pure
 * refactor, so it's preserved exactly and flagged separately.
 */
export const ROLE_PERMISSION_DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  Admin: PERMISSION_KEYS,
  'HR Manager': HR_MANAGEMENT_SET,
  'HR Officer': HR_MANAGEMENT_SET,
  Manager: [],
  Employee: [],
};

/**
 * Normalize a Role.permissions JSON value into an array of permission keys.
 * Accepts the legacy `{ all: true }` shape (how seed.ts wrote the Admin role
 * before this migration) as a superuser wildcard, so an un-backfilled Admin
 * row from before this change keeps working with zero data migration.
 */
export function resolveRolePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === 'string');
  if (raw && typeof raw === 'object' && (raw as { all?: unknown }).all === true) return [...PERMISSION_KEYS];
  return [];
}

export function hasPermission(permissions: readonly string[], required: string): boolean {
  return permissions.includes(required);
}
