/**
 * The permission catalogue: resource.action keys, each optionally scopeable
 * to the caller's own department. Split from the coarser 14-key catalogue
 * (see feat/org-structure-admin) wherever a real endpoint-level distinction
 * exists — view vs act vs configure. Two keys are NEW without a pre-existing
 * gate to split from (documented on each): `employees.view` (GET /employees
 * and GET /employees/:id were previously open to any authenticated user —
 * this migration deliberately closes that) and the whole `overtime.*` family
 * (feat/overtime was merged into develop immediately before this migration,
 * temporarily gated as `payroll.manage` — see the merge commit).
 */
export type Scope = 'ALL' | 'OWN_DEPARTMENT';

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  /** Which resource group this belongs to, for the grouped Roles UI. */
  resource: string;
  /**
   * Whether OWN_DEPARTMENT is a real, enforced option for this key. false
   * means the backend FORCES 'ALL' regardless of what's requested — never
   * offer OWN_DEPARTMENT in the UI for these; a scope picker that doesn't
   * actually filter anything is worse than no picker (it looks safe and isn't).
   */
  scopeable: boolean;
}

export interface GrantedPermission { key: string; scope: Scope; }

const RESOURCE = {
  EMPLOYEES: 'Employees', PII: 'PII', USERS: 'Users & roles', ORG: 'Organisation structure',
  LEAVE: 'Leave', OVERTIME: 'Overtime', SHIFTS: 'Shifts & holidays', ATTENDANCE: 'Attendance',
  COMPLIANCE: 'Compliance', SETTINGS: 'Settings', STATUTORY: 'Statutory rates',
  PAYROLL: 'Payroll', REPORTS: 'Reports',
} as const;

export const PERMISSIONS: readonly PermissionDef[] = [
  // ── Employees / PII ──
  {
    key: 'employees.view', resource: RESOURCE.EMPLOYEES, scopeable: true,
    label: 'View employees', description: 'List the employee directory and view employee detail pages.',
  },
  {
    key: 'employees.write', resource: RESOURCE.EMPLOYEES, scopeable: false,
    label: 'Manage employees', description: 'Create, update and terminate employee records; upload or remove their documents; provision logins.',
  },
  {
    key: 'employees.anonymize', resource: RESOURCE.EMPLOYEES, scopeable: false,
    label: 'Erase employee data (DSR)', description: 'Anonymize a terminated employee’s PII to complete a data-subject erasure request. Admin-only today.',
  },
  {
    key: 'pii.view', resource: RESOURCE.PII, scopeable: false,
    label: 'View unmasked PII', description: 'See decrypted national ID, KRA PIN and bank account numbers instead of masked values; search by national ID.',
  },
  // ── Users / org structure (never department-scoped — org-wide by nature) ──
  {
    key: 'users.manage', resource: RESOURCE.USERS, scopeable: false,
    label: 'Manage users & roles', description: 'Create/deactivate logins, change roles, force password resets, and administer custom roles. Admin-only today.',
  },
  {
    key: 'org_structure.manage', resource: RESOURCE.ORG, scopeable: false,
    label: 'Manage departments & job titles', description: 'Create, rename, re-parent, deactivate and delete departments and job titles.',
  },
  // ── Leave ──
  {
    key: 'leave.view', resource: RESOURCE.LEAVE, scopeable: true,
    label: 'View leave requests', description: 'See leave requests and balances beyond your own.',
  },
  {
    key: 'leave.approve', resource: RESOURCE.LEAVE, scopeable: true,
    label: 'Approve leave', description: 'Approve or reject leave requests. Still requires being the assigned approver for that step.',
  },
  {
    key: 'leave.manage', resource: RESOURCE.LEAVE, scopeable: true,
    label: 'Manage leave', description: 'Administer leave types, balances, rollover and accrual runs; create or cancel leave on behalf of others.',
  },
  // ── Overtime ──
  {
    key: 'overtime.view', resource: RESOURCE.OVERTIME, scopeable: true,
    label: 'View overtime', description: 'See overtime entries beyond your own.',
  },
  {
    key: 'overtime.approve', resource: RESOURCE.OVERTIME, scopeable: true,
    label: 'Approve overtime', description: 'Approve, reject or bulk-approve overtime entries.',
  },
  {
    key: 'overtime.manage', resource: RESOURCE.OVERTIME, scopeable: true,
    label: 'Manage overtime', description: 'Derive entries from attendance, create/edit/delete manual entries, and configure overtime policy.',
  },
  // ── Shifts & holidays ──
  {
    key: 'shifts.view', resource: RESOURCE.SHIFTS, scopeable: false,
    label: 'View shifts', description: 'View the roster and shift definitions.',
  },
  {
    key: 'shifts.manage', resource: RESOURCE.SHIFTS, scopeable: false,
    label: 'Manage shifts', description: 'Create shift definitions, build the roster, and maintain the public holiday calendar.',
  },
  // ── Attendance ──
  {
    key: 'attendance.view', resource: RESOURCE.ATTENDANCE, scopeable: true,
    label: 'View attendance', description: 'See attendance records beyond your own.',
  },
  {
    key: 'attendance.manage', resource: RESOURCE.ATTENDANCE, scopeable: false,
    label: 'Manage attendance', description: 'Record and import attendance, and manage biometric devices.',
  },
  // ── Compliance ──
  {
    key: 'compliance.view', resource: RESOURCE.COMPLIANCE, scopeable: false,
    label: 'View compliance records', description: 'View consent, retention, DSR and breach records.',
  },
  {
    key: 'compliance.manage', resource: RESOURCE.COMPLIANCE, scopeable: false,
    label: 'Manage compliance', description: 'Grant/withdraw consent, set retention policy, action data-subject requests, and log/notify breaches.',
  },
  // ── Settings / statutory rates (org-wide by nature — never department-scoped) ──
  {
    key: 'settings.manage', resource: RESOURCE.SETTINGS, scopeable: false,
    label: 'Manage organisation settings', description: 'Branding, leave-approval policy, employee numbering, payroll rounding and attendance grace settings.',
  },
  {
    key: 'statutory_rates.manage', resource: RESOURCE.STATUTORY, scopeable: false,
    label: 'Manage statutory rates', description: 'Edit PAYE/NSSF/SHIF/AHL rate versions. Admin-only today — narrower than settings.manage.',
  },
  // ── Payroll ──
  {
    key: 'payroll.view', resource: RESOURCE.PAYROLL, scopeable: false,
    label: 'View payroll runs', description: 'View payroll runs and download payslips, without creating or changing anything.',
  },
  {
    key: 'payroll.run', resource: RESOURCE.PAYROLL, scopeable: false,
    label: 'Run payroll', description: 'Create, correct and discard payroll runs; preview statutory breakdowns.',
  },
  {
    key: 'payroll.finalize', resource: RESOURCE.PAYROLL, scopeable: false,
    label: 'Finalize payroll', description: 'Lock a draft payroll run so its payslips become immutable — separate from payroll.run for maker-checker control.',
  },
  {
    key: 'payroll.manage', resource: RESOURCE.PAYROLL, scopeable: false,
    label: 'Manage payroll configuration', description: 'Salary structures, loans/advances, one-off adjustments, severance and bank exports.',
  },
  // ── Reports ──
  {
    key: 'reports.view', resource: RESOURCE.REPORTS, scopeable: false,
    label: 'View reports', description: 'Payroll summary, statutory remittance, year trend, headcount, loan book, severance and adjustments registers.',
  },
];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);
const SCOPEABLE_KEYS = new Set(PERMISSIONS.filter((p) => p.scopeable).map((p) => p.key));
/** Whether OWN_DEPARTMENT is a real, enforced option for this key — see PermissionDef.scopeable. */
export function isScopeable(key: string): boolean {
  return SCOPEABLE_KEYS.has(key);
}
/** resource.action keys whose 'approve' or 'manage' level implies the resource's 'view' — the Roles UI auto-ticks these; the STORED array still lists every ticked key explicitly (see UpdateRoleDto — nothing is inferred at check time). */
export const IMPLIES_VIEW: Readonly<Record<string, string>> = {
  'leave.approve': 'leave.view', 'leave.manage': 'leave.view',
  'overtime.approve': 'overtime.view', 'overtime.manage': 'overtime.view',
  'attendance.manage': 'attendance.view',
  'shifts.manage': 'shifts.view',
  'employees.write': 'employees.view',
  'compliance.manage': 'compliance.view',
  'payroll.run': 'payroll.view', 'payroll.manage': 'payroll.view',
};

const ADMIN_ONLY = ['employees.anonymize', 'users.manage', 'statutory_rates.manage'];
/** Every permission except the three that were @Roles('Admin')-only before the org-structure-admin migration, each at scope ALL — HR Manager/HR Officer had unrestricted org-wide access, never department-limited. */
const HR_MANAGEMENT_SET: readonly GrantedPermission[] = PERMISSION_KEYS
  .filter((k) => !ADMIN_ONLY.includes(k))
  .map((key) => ({ key, scope: 'ALL' as const }));
const ADMIN_SET: readonly GrantedPermission[] = PERMISSION_KEYS.map((key) => ({ key, scope: 'ALL' as const }));

/**
 * The historically-known role names and the permission set that reproduces
 * their PRE-migration access exactly (see auth/permissions.ts's prior
 * revision, from feat/org-structure-admin, for the 14-key predecessor).
 *
 * 'Manager' and 'Employee' get nothing: neither was ever a member of the old
 * HR_MANAGEMENT_ROLES array, so a login granted the 'Manager' role today has
 * ZERO elevated access — identical to 'Employee'. Preserved exactly.
 */
export const ROLE_PERMISSION_DEFAULTS: Readonly<Record<string, readonly GrantedPermission[]>> = {
  Admin: ADMIN_SET,
  'HR Manager': HR_MANAGEMENT_SET,
  'HR Officer': HR_MANAGEMENT_SET,
  Manager: [],
  Employee: [],
};

/**
 * Ready-made permission sets for the Settings > Roles "New role" picker —
 * fully editable after creation, not locked presets. Each reflects a real
 * job function; none is constrained by "identical to a seeded role" (these
 * are new, not a refactor of anything).
 */
export interface RoleTemplate { name: string; description: string; permissions: readonly GrantedPermission[]; }
const ALL = (key: string): GrantedPermission => ({ key, scope: 'ALL' });
const OWN_DEPT = (key: string): GrantedPermission => ({ key, scope: 'OWN_DEPARTMENT' });

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    name: 'Payroll Officer',
    description: 'Prepares payroll but cannot finalize it — a second person locks the run (maker-checker).',
    permissions: [ALL('payroll.view'), ALL('payroll.run'), ALL('payroll.manage'), ALL('reports.view')],
  },
  {
    name: 'Line Supervisor',
    description: "Sees and approves their own department's leave, overtime and attendance — nothing outside it.",
    permissions: [
      OWN_DEPT('employees.view'), OWN_DEPT('leave.view'), OWN_DEPT('leave.approve'),
      OWN_DEPT('overtime.view'), OWN_DEPT('overtime.approve'), OWN_DEPT('attendance.view'),
    ],
  },
  {
    name: 'HR Assistant',
    description: 'Processes employee records and leave administration, but does not approve leave or touch payroll.',
    permissions: [
      ALL('employees.view'), ALL('employees.write'), ALL('pii.view'),
      ALL('leave.view'), ALL('leave.manage'), ALL('attendance.view'), ALL('shifts.view'),
    ],
  },
  {
    name: 'Accountant',
    description: 'Runs payroll and manages statutory rates, but a separate approver finalizes each run.',
    permissions: [ALL('payroll.view'), ALL('payroll.run'), ALL('payroll.manage'), ALL('reports.view'), ALL('statutory_rates.manage')],
  },
  {
    name: 'Compliance Officer',
    description: 'Handles consent, retention, data-subject requests and breach incidents; can see PII to verify identity.',
    permissions: [ALL('compliance.view'), ALL('compliance.manage'), ALL('employees.view'), ALL('pii.view')],
  },
];

/**
 * Normalize a Role.permissions JSON value into granted permissions.
 * Accepts three shapes, oldest first:
 *  - `{ all: true }` — pre-org-structure-admin Admin rows: superuser, scope ALL.
 *  - `string[]` — org-structure-admin's 14-key shape: each key, scope ALL
 *    (that catalogue had no scope concept, so ALL is the only faithful read).
 *  - `{ key, scope }[]` — the current shape.
 * A scope of anything other than 'OWN_DEPARTMENT' (including a corrupt/
 * missing value) reads as 'ALL' — fail OPEN on shape, fail CLOSED on access
 * (an unrecognized scope must not silently grant department-wide data it
 * wasn't asked to; ALL is what every non-scopeable key requires anyway, and
 * a scopeable key with a bad scope value getting ALL is a data bug to fix
 * loudly via the verify suite, not a silent under-grant).
 */
export function resolveRolePermissions(raw: unknown): GrantedPermission[] {
  if (Array.isArray(raw)) {
    const out: GrantedPermission[] = [];
    for (const entry of raw) {
      if (typeof entry === 'string') { out.push({ key: entry, scope: 'ALL' }); continue; }
      if (entry && typeof entry === 'object' && typeof (entry as { key?: unknown }).key === 'string') {
        const key = (entry as { key: string }).key;
        const scope = (entry as { scope?: unknown }).scope === 'OWN_DEPARTMENT' ? 'OWN_DEPARTMENT' : 'ALL';
        out.push({ key, scope: SCOPEABLE_KEYS.has(key) ? scope : 'ALL' });
      }
    }
    return out;
  }
  if (raw && typeof raw === 'object' && (raw as { all?: unknown }).all === true) {
    return PERMISSION_KEYS.map((key) => ({ key, scope: 'ALL' as const }));
  }
  return [];
}

export function hasPermission(granted: readonly GrantedPermission[], key: string): boolean {
  return granted.some((g) => g.key === key);
}

/** The scope of a held permission, or null if not held at all. */
export function scopeFor(granted: readonly GrantedPermission[], key: string): Scope | null {
  return granted.find((g) => g.key === key)?.scope ?? null;
}

/**
 * The scope of the FIRST held key among `keys` (checked in the given order),
 * or null if none are held. For a resource with view/approve/manage split,
 * the UI always ticks 'view' alongside 'approve'/'manage' (see IMPLIES_VIEW)
 * — but a role built directly against the API might hold only 'approve' or
 * only 'manage'. Widening/list-visibility decisions should still work for
 * that role, so callers pass all three keys rather than checking 'view' alone.
 */
export function effectiveScope(granted: readonly GrantedPermission[], keys: readonly string[]): Scope | null {
  for (const key of keys) {
    const scope = scopeFor(granted, key);
    if (scope) return scope;
  }
  return null;
}
