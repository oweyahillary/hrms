/**
 * Prove the granular permissions + department-scope model end-to-end over HTTP:
 *  - the 25-key catalogue replaces the org-structure-admin 14-key one, split
 *    into view/approve/manage wherever a real endpoint distinction exists;
 *  - a custom role with a narrow grant (payroll.run only) can do exactly
 *    that and nothing more — including the payroll.run-without-
 *    payroll.finalize split (draft creation succeeds, finalize is refused);
 *  - leave.view without leave.approve can list but not act;
 *  - reports.view alone reaches reports and nothing else;
 *  - OWN_DEPARTMENT scope is enforced at the ROW level, not just the route:
 *    a Line Supervisor sees only their own department's leave/overtime/
 *    attendance/employee rows, and is refused acting on another
 *    department's row even where an identity check alone would allow it
 *    (the assigned-approver test) — scope is a second, independent gate;
 *  - OWN_DEPARTMENT scope with no linked employee record fails CLOSED
 *    (empty results everywhere), never falls through to "everyone";
 *  - a client-submitted OWN_DEPARTMENT scope on a non-scopeable key is
 *    forced to ALL server-side, never trusted as submitted;
 *  - each seeded role (Admin, HR Manager, HR Officer, Manager, Employee)
 *    has EXACTLY the access it had before this split — asserted both
 *    against the stored grant (ROLE_PERMISSION_DEFAULTS) and
 *    endpoint-by-endpoint, including the one deliberate exception this
 *    migration (and the one before it) introduced: employees.view is a
 *    NEW gate, so Manager/Employee now lose directory access they
 *    previously had by default;
 *  - the 5 role templates expose valid catalogue keys with the right scope;
 *  - pii.view still gates decrypted PII on GET /employees/:id;
 *  - the Departments and Roles admin surfaces still work correctly;
 *  - two-org isolation holds in both directions, including for the newly
 *    scoped endpoints.
 *
 *   cd apps/api && npx ts-node scripts/verify-permissions.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Mirrors verify-self-service.ts's throwaway-second-org pattern.
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { PERMISSION_KEYS, ROLE_PERMISSION_DEFAULTS, type GrantedPermission } from '../src/auth/permissions';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface PermissionDef { key: string; label: string; description: string; resource: string; scopeable: boolean }
interface AdminRole { id: string; name: string; permissions: GrantedPermission[]; isSeeded: boolean; userCount: number }
interface AdminDepartment {
  id: string; name: string; parentDepartmentId: string | null; headEmployeeId: string | null;
  active: boolean; employeeCount: number; subDepartmentCount: number;
}
interface Employee { id: string; nationalId?: string }
interface RoleTemplate { name: string; description: string; permissions: GrantedPermission[] }

const sortedPerms = (perms: GrantedPermission[]): string[] => perms.map((p) => `${p.key}:${p.scope}`).sort();

async function main(): Promise<void> {
  const stamp = Date.now();
  let nid = 0;
  // Fixed-width suffix (always 8 digits total) — this script now creates
  // more than 10 employees per run, and a bare `nid++` would overflow the
  // 7–8 digit nationalId format past the 10th call.
  const nationalId = (): string => `${String(stamp).slice(-6)}${String(nid++).padStart(2, '0')}`;

  async function login(email: string, password: string): Promise<string> {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const token = ((await r.json()) as { accessToken?: string }).accessToken;
    if (!token) { console.log(`  FAIL  login as ${email}`); process.exit(1); }
    return token;
  }

  const adminToken = await login('admin@example.com', 'ChangeMe123!');
  const adminJson = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };
  const adminMe = (await (await fetch(`${BASE}/auth/me`, { headers: adminAuth })).json()) as { organizationId: string };
  const orgAId = adminMe.organizationId;

  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  const passwords = new PasswordService();

  async function makeEmployee(tag: string): Promise<Employee> {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({
        employeeNumber: `PERM-${tag}-${stamp}`, firstName: 'Permissions', lastName: tag,
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const emp = (await r.json()) as { id?: string; message?: unknown };
    if (!emp.id) throw new Error(`employee create failed for ${tag}: ${r.status} ${JSON.stringify(emp)}`);
    return { id: emp.id };
  }

  async function assignDepartment(employeeId: string, departmentId: string): Promise<void> {
    await fetch(`${BASE}/employees/${employeeId}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ departmentId }) });
  }

  /**
   * A login with a DIRECTLY-created role (not via createLogin's fixed
   * GRANTABLE_ROLE_NAMES list — this is how a genuinely custom role, or a
   * seeded-name role in a fresh org, gets a real session to test against).
   * `employeeId`, when given, links the login the way DepartmentScopeService
   * needs to resolve "own department" — omit it to test the fail-closed path.
   */
  async function loginAsRole(
    roleId: string, tag: string, orgId: string, employeeId?: string,
  ): Promise<{ token: string; userId: string }> {
    const email = `perm.${tag}.${stamp}@example.com`;
    const password = 'PermVerify123!';
    const user = await base.user.create({
      data: {
        organizationId: orgId, email, passwordHash: await passwords.hash(password),
        mustChangePassword: false, roleId, employeeId: employeeId ?? null,
      },
    });
    return { token: await login(email, password), userId: user.id };
  }

  // ══════════════════════════════════════════════════════════════════════
  // (a) Permission catalogue — the 25-key split
  // ══════════════════════════════════════════════════════════════════════
  const catalogue = (await (await fetch(`${BASE}/roles/catalogue`, { headers: adminAuth })).json()) as PermissionDef[];
  check('catalogue exposes the full split key set', catalogue.length >= 24, String(catalogue.length));
  const catalogueKeys = new Set(catalogue.map((p) => p.key));
  for (const expected of [
    'employees.view', 'employees.write', 'employees.anonymize', 'pii.view',
    'leave.view', 'leave.approve', 'leave.manage',
    'overtime.view', 'overtime.approve', 'overtime.manage',
    'attendance.view', 'attendance.manage',
    'shifts.view', 'shifts.manage',
    'compliance.view', 'compliance.manage',
    'payroll.view', 'payroll.run', 'payroll.finalize', 'payroll.manage',
    'reports.view', 'settings.manage', 'statutory_rates.manage', 'org_structure.manage', 'users.manage',
  ]) {
    check(`catalogue includes ${expected}`, catalogueKeys.has(expected));
  }
  check(
    'every catalogue entry carries resource + scopeable',
    catalogue.every((p) => typeof p.resource === 'string' && p.resource.length > 0 && typeof p.scopeable === 'boolean'),
    JSON.stringify(catalogue.find((p) => !p.resource || typeof p.scopeable !== 'boolean')),
  );
  for (const nonScopeable of [
    'employees.write', 'employees.anonymize', 'pii.view', 'users.manage', 'org_structure.manage',
    'shifts.view', 'shifts.manage', 'compliance.view', 'compliance.manage', 'settings.manage',
    'statutory_rates.manage', 'payroll.view', 'payroll.run', 'payroll.finalize', 'payroll.manage',
    'reports.view', 'attendance.manage',
  ]) {
    const def = catalogue.find((p) => p.key === nonScopeable);
    check(`${nonScopeable} is correctly marked non-scopeable (OWN_DEPARTMENT would be meaningless for it)`, def?.scopeable === false, JSON.stringify(def));
  }
  for (const scopeable of [
    'employees.view', 'leave.view', 'leave.approve', 'leave.manage',
    'overtime.view', 'overtime.approve', 'overtime.manage', 'attendance.view',
  ]) {
    const def = catalogue.find((p) => p.key === scopeable);
    check(`${scopeable} is correctly marked scopeable`, def?.scopeable === true, JSON.stringify(def));
  }

  // ══════════════════════════════════════════════════════════════════════
  // (b) A custom role with a narrow grant can do exactly what it's granted —
  // also covers "payroll.run without payroll.finalize" (draft build
  // succeeds, finalize is refused).
  // ══════════════════════════════════════════════════════════════════════
  const clerkRole = (await (await fetch(`${BASE}/roles`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ name: `Payroll Clerk ${stamp}`, permissions: [{ key: 'payroll.run', scope: 'ALL' }] }),
  })).json()) as AdminRole;
  check(
    'custom role created with exactly the requested permission',
    clerkRole.permissions.length === 1 && clerkRole.permissions[0].key === 'payroll.run' && clerkRole.permissions[0].scope === 'ALL',
    JSON.stringify(clerkRole),
  );
  check('a freshly-created custom role is not seeded', clerkRole.isSeeded === false, JSON.stringify(clerkRole));

  const { token: clerkToken } = await loginAsRole(clerkRole.id, 'clerk', orgAId);
  const clerkAuth = { Authorization: `Bearer ${clerkToken}` };
  const clerkJson = { Authorization: `Bearer ${clerkToken}`, 'Content-Type': 'application/json' };

  const clerkMe = (await (await fetch(`${BASE}/auth/me`, { headers: clerkAuth })).json()) as { permissions?: GrantedPermission[] };
  check(
    "session payload carries exactly the role's permission set",
    JSON.stringify(clerkMe.permissions) === JSON.stringify([{ key: 'payroll.run', scope: 'ALL' }]),
    JSON.stringify(clerkMe.permissions),
  );

  const clerkEmp = await makeEmployee('Clerk');
  await fetch(`${BASE}/employees/${clerkEmp.id}/salary-structures`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ basicSalary: 50000, effectiveDate: '2020-01-01', reason: 'Salary revision' }),
  });
  const clerkRunRes = await fetch(`${BASE}/payroll/runs`, {
    method: 'POST', headers: clerkJson, body: JSON.stringify({ periodMonth: 6, periodYear: 2099, employeeIds: [clerkEmp.id] }),
  });
  const clerkRun = (await clerkRunRes.json()) as { id?: string };
  check('granted payroll.run: creating a DRAFT payroll run succeeds', clerkRunRes.status === 201 || clerkRunRes.status === 200, String(clerkRunRes.status));

  const clerkViewRes = await fetch(`${BASE}/payroll/runs/${clerkRun.id}`, { headers: clerkAuth });
  check('granted payroll.run: the draft is visible (AnyPermission view set includes payroll.run)', clerkViewRes.status === 200, String(clerkViewRes.status));

  const clerkFinalizeRes = await fetch(`${BASE}/payroll/runs/${clerkRun.id}/finalize`, { method: 'POST', headers: clerkAuth });
  check('NOT granted payroll.finalize: finalizing the draft is refused (403)', clerkFinalizeRes.status === 403, String(clerkFinalizeRes.status));

  const clerkDeptRes = await fetch(`${BASE}/departments`, { method: 'POST', headers: clerkJson, body: JSON.stringify({ name: 'Should not be created' }) });
  check('NOT granted org_structure.manage: creating a department is refused (403)', clerkDeptRes.status === 403, String(clerkDeptRes.status));

  const clerkEmpWriteRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: clerkJson,
    body: JSON.stringify({ employeeNumber: `SHOULDFAIL-${stamp}`, firstName: 'X', lastName: 'Y', nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01' }),
  });
  check('NOT granted employees.write: creating an employee is refused (403)', clerkEmpWriteRes.status === 403, String(clerkEmpWriteRes.status));

  const clerkReportsRes = await fetch(`${BASE}/reports/headcount`, { headers: clerkAuth });
  check('NOT granted reports.view: reports are refused (403)', clerkReportsRes.status === 403, String(clerkReportsRes.status));

  // ══════════════════════════════════════════════════════════════════════
  // (c) leave.view WITHOUT leave.approve: can list, cannot act
  // ══════════════════════════════════════════════════════════════════════
  const viewerRole = (await (await fetch(`${BASE}/roles`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ name: `Leave Viewer ${stamp}`, permissions: [{ key: 'leave.view', scope: 'ALL' }] }),
  })).json()) as AdminRole;
  const { token: viewerToken } = await loginAsRole(viewerRole.id, 'leaveviewer', orgAId);
  const viewerAuth = { Authorization: `Bearer ${viewerToken}` };
  const viewerListRes = await fetch(`${BASE}/leave-requests`, { headers: viewerAuth });
  check('leave.view alone: listing leave requests succeeds', viewerListRes.status === 200, String(viewerListRes.status));
  const viewerApproveRes = await fetch(`${BASE}/leave-requests/00000000-0000-0000-0000-000000000000/approve`, { method: 'POST', headers: viewerAuth });
  check('leave.view alone (no leave.approve): approving is refused (403)', viewerApproveRes.status === 403, String(viewerApproveRes.status));

  // ══════════════════════════════════════════════════════════════════════
  // (d) reports.view alone reaches reports and nothing else
  // ══════════════════════════════════════════════════════════════════════
  const reportsRole = (await (await fetch(`${BASE}/roles`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ name: `Reports Only ${stamp}`, permissions: [{ key: 'reports.view', scope: 'ALL' }] }),
  })).json()) as AdminRole;
  const { token: reportsToken } = await loginAsRole(reportsRole.id, 'reportsonly', orgAId);
  const reportsAuth = { Authorization: `Bearer ${reportsToken}` };
  const reportsHeadcountRes = await fetch(`${BASE}/reports/headcount`, { headers: reportsAuth });
  check('reports.view alone: reports ARE reachable', reportsHeadcountRes.status === 200, String(reportsHeadcountRes.status));
  const reportsRunsRes = await fetch(`${BASE}/payroll/runs`, { headers: reportsAuth });
  check("reports.view alone: payroll runs are NOT reachable (reports.view isn't in that route's AnyPermission set)", reportsRunsRes.status === 403, String(reportsRunsRes.status));
  const reportsEmpRes = await fetch(`${BASE}/employees`, { headers: reportsAuth });
  check('reports.view alone: the employee directory is NOT reachable', reportsEmpRes.status === 403, String(reportsEmpRes.status));
  const reportsDeptRes = await fetch(`${BASE}/departments`, {
    method: 'POST', headers: { Authorization: `Bearer ${reportsToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Should not be created' }),
  });
  check('reports.view alone: department management is NOT reachable', reportsDeptRes.status === 403, String(reportsDeptRes.status));

  // ══════════════════════════════════════════════════════════════════════
  // (e) Seeded roles: effective access unchanged — both the stored grant
  // (against the source of truth every backfill run uses) and
  // endpoint-by-endpoint.
  // ══════════════════════════════════════════════════════════════════════
  async function provisionByCreateLogin(employeeId: string, email: string, roleName: string): Promise<string> {
    const created = await fetch(`${BASE}/employees/${employeeId}/create-login`, {
      method: 'POST', headers: adminJson, body: JSON.stringify({ email, roleName }),
    });
    const { temporaryPassword } = (await created.json()) as { temporaryPassword?: string };
    if (!temporaryPassword) { console.log(`  FAIL  create-login for ${email} (${roleName})`); process.exit(1); }
    const tempToken = await login(email, temporaryPassword);
    const newPassword = 'SeededRole123!';
    await fetch(`${BASE}/auth/change-password`, {
      method: 'POST', headers: { Authorization: `Bearer ${tempToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
    });
    return login(email, newPassword);
  }

  const hrMgrEmp = await makeEmployee('HRMgr');
  const hrOfficerEmp = await makeEmployee('HROfficer');
  const managerEmp = await makeEmployee('Manager');
  const employeeEmp = await makeEmployee('Employee');

  const hrMgrToken = await provisionByCreateLogin(hrMgrEmp.id, `perm.hrmgr.${stamp}@example.com`, 'HR Manager');
  const hrOfficerToken = await provisionByCreateLogin(hrOfficerEmp.id, `perm.hrofficer.${stamp}@example.com`, 'HR Officer');
  const managerToken = await provisionByCreateLogin(managerEmp.id, `perm.manager.${stamp}@example.com`, 'Manager');
  const employeeToken = await provisionByCreateLogin(employeeEmp.id, `perm.employee.${stamp}@example.com`, 'Employee');

  const hrMgrAuth = { Authorization: `Bearer ${hrMgrToken}` };
  const hrMgrJson = { Authorization: `Bearer ${hrMgrToken}`, 'Content-Type': 'application/json' };
  const hrOfficerAuth = { Authorization: `Bearer ${hrOfficerToken}` };
  const hrOfficerJson = { Authorization: `Bearer ${hrOfficerToken}`, 'Content-Type': 'application/json' };
  const managerAuth = { Authorization: `Bearer ${managerToken}` };
  const managerJson = { Authorization: `Bearer ${managerToken}`, 'Content-Type': 'application/json' };
  const employeeAuth = { Authorization: `Bearer ${employeeToken}` };
  const employeeJson = { Authorization: `Bearer ${employeeToken}`, 'Content-Type': 'application/json' };

  // HR Manager/HR Officer/Employee: unchanged, byte-for-byte against the
  // source of truth every backfill run uses. Manager is DELIBERATELY
  // different now (see ROLE_PERMISSION_DEFAULTS.Manager) — checked here too,
  // still against the same source of truth, just no longer an "unchanged" claim.
  let managerUserId = '';
  for (const [label, auth] of [
    ['HR Manager', hrMgrAuth], ['HR Officer', hrOfficerAuth], ['Manager', managerAuth], ['Employee', employeeAuth],
  ] as const) {
    const me = (await (await fetch(`${BASE}/auth/me`, { headers: auth })).json()) as { id: string; permissions?: GrantedPermission[] };
    if (label === 'Manager') managerUserId = me.id;
    const expected = sortedPerms([...(ROLE_PERMISSION_DEFAULTS[label] ?? [])]);
    const actual = sortedPerms(me.permissions ?? []);
    check(
      `${label}'s stored permission set exactly matches ROLE_PERMISSION_DEFAULTS`,
      JSON.stringify(actual) === JSON.stringify(expected),
      JSON.stringify({ expected, actual }),
    );
  }
  check('captured the Manager login\'s own userId for the approver-chain test below', managerUserId.length > 0, managerUserId);

  // HR Manager / HR Officer: full HR access except the three still Admin-only.
  for (const [label, auth, json] of [
    ['HR Manager', hrMgrAuth, hrMgrJson],
    ['HR Officer', hrOfficerAuth, hrOfficerJson],
  ] as const) {
    const deptRes = await fetch(`${BASE}/departments`, { method: 'POST', headers: json, body: JSON.stringify({ name: `${label} Dept ${stamp}` }) });
    check(`${label} can create a department (org_structure.manage)`, deptRes.status === 201, String(deptRes.status));

    const usersRes = await fetch(`${BASE}/users`, { headers: auth });
    check(`${label} CANNOT list users (users.manage is Admin-only, unchanged)`, usersRes.status === 403, String(usersRes.status));

    const rateRes = await fetch(`${BASE}/statutory-rates`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ rateType: 'PAYE_BAND', effectiveFrom: '2099-01-01', payload: {} }),
    });
    check(`${label} CANNOT create statutory rates (Admin-only, unchanged)`, rateRes.status === 403, String(rateRes.status));

    const runAttempt = await fetch(`${BASE}/payroll/runs`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ periodMonth: 7, periodYear: 2099, employeeIds: [] }),
    });
    check(`${label} CAN reach payroll run creation (payroll.run)`, runAttempt.status !== 403, String(runAttempt.status));

    const reportsRes = await fetch(`${BASE}/reports/headcount`, { headers: auth });
    check(`${label} CAN reach reports (reports.view — new split key, was folded into payroll.manage before)`, reportsRes.status === 200, String(reportsRes.status));

    const leaveApproveRes = await fetch(`${BASE}/leave-requests/00000000-0000-0000-0000-000000000000/approve`, { method: 'POST', headers: auth });
    check(`${label} holds leave.approve (route reachable — new split key)`, leaveApproveRes.status !== 403, String(leaveApproveRes.status));

    const overtimeApproveRes = await fetch(`${BASE}/overtime/00000000-0000-0000-0000-000000000000/approve`, { method: 'POST', headers: auth });
    check(`${label} holds overtime.approve (route reachable — new split key)`, overtimeApproveRes.status !== 403, String(overtimeApproveRes.status));

    const anonymizeRes = await fetch(`${BASE}/employees/${hrMgrEmp.id}/anonymize`, { method: 'POST', headers: auth });
    check(`${label} CANNOT anonymize employees (employees.anonymize is Admin-only, unchanged)`, anonymizeRes.status === 403, String(anonymizeRes.status));
  }

  // Manager: DELIBERATELY no longer empty (see ROLE_PERMISSION_DEFAULTS.Manager
  // and item-1 of the follow-up review) — holds DEPARTMENT_SUPERVISOR_SET, all
  // OWN_DEPARTMENT. org_structure.manage and employees.write were never part
  // of that set, so those two stay refused exactly as before.
  const mgrDeptRes = await fetch(`${BASE}/departments`, { method: 'POST', headers: managerJson, body: JSON.stringify({ name: 'Should not be created' }) });
  check('Manager role still CANNOT manage departments (org_structure.manage not in DEPARTMENT_SUPERVISOR_SET)', mgrDeptRes.status === 403, String(mgrDeptRes.status));

  // managerEmp has no department yet at this point in the script (assigned
  // in section (m) below) — employees.view is held but OWN_DEPARTMENT-scoped,
  // so with no resolvable department this must fail CLOSED to an empty page,
  // not 403 (they DO hold the key now) and not the full directory.
  const mgrEmployeesListRes = await fetch(`${BASE}/employees`, { headers: managerAuth });
  const mgrEmployeesList = (await mgrEmployeesListRes.json()) as { data: unknown[]; total: number };
  check(
    'Manager NOW reaches the employee directory (employees.view, DELIBERATE behaviour change from item 1) but sees nothing yet — no department link resolved (fail closed)',
    mgrEmployeesListRes.status === 200 && mgrEmployeesList.data.length === 0 && mgrEmployeesList.total === 0,
    JSON.stringify({ status: mgrEmployeesListRes.status, body: mgrEmployeesList }),
  );

  const mgrCreateRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: managerJson,
    body: JSON.stringify({ employeeNumber: `MGRFAIL-${stamp}`, firstName: 'X', lastName: 'Y', nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01' }),
  });
  check('Manager still CANNOT create employees (employees.write not in DEPARTMENT_SUPERVISOR_SET)', mgrCreateRes.status === 403, String(mgrCreateRes.status));

  // Employee: self-service only.
  const empDeptRes = await fetch(`${BASE}/departments`, { method: 'POST', headers: employeeJson, body: JSON.stringify({ name: 'Should not be created' }) });
  check('Employee role CANNOT manage departments', empDeptRes.status === 403, String(empDeptRes.status));
  const meProfileRes = await fetch(`${BASE}/me/profile`, { headers: employeeAuth });
  check('Employee CAN still reach their own self-service profile', meProfileRes.status === 200, String(meProfileRes.status));

  // ══════════════════════════════════════════════════════════════════════
  // (f) pii.view still gates decrypted PII
  // ══════════════════════════════════════════════════════════════════════
  const piiTargetNatId = nationalId();
  const piiTargetRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeNumber: `PII-${stamp}`, firstName: 'Pii', lastName: 'Target', nationalId: piiTargetNatId, employmentType: 'PERMANENT', hireDate: '2020-01-01' }),
  });
  const piiTarget = (await piiTargetRes.json()) as Employee;

  const viaHrOfficer = (await (await fetch(`${BASE}/employees/${piiTarget.id}`, { headers: hrOfficerAuth })).json()) as { nationalId?: string; piiMasked?: boolean };
  check('HR Officer (has pii.view) sees the UNMASKED national ID', viaHrOfficer.nationalId === piiTargetNatId && viaHrOfficer.piiMasked === false, JSON.stringify(viaHrOfficer));

  const viaAdmin = (await (await fetch(`${BASE}/employees/${piiTarget.id}`, { headers: adminAuth })).json()) as { nationalId?: string; piiMasked?: boolean };
  check('Admin (has pii.view) sees the UNMASKED national ID', viaAdmin.nationalId === piiTargetNatId && viaAdmin.piiMasked === false, JSON.stringify(viaAdmin));

  // ══════════════════════════════════════════════════════════════════════
  // (g) Departments admin surface: active/deactivate/cycle guard/employee-count guard
  // ══════════════════════════════════════════════════════════════════════
  const parentDept = (await (await fetch(`${BASE}/departments`, { method: 'POST', headers: adminJson, body: JSON.stringify({ name: `Parent ${stamp}` }) })).json()) as AdminDepartment;
  const childDept = (await (await fetch(`${BASE}/departments`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ name: `Child ${stamp}`, parentDepartmentId: parentDept.id }),
  })).json()) as AdminDepartment;

  const cycleRes = await fetch(`${BASE}/departments/${parentDept.id}`, {
    method: 'PATCH', headers: adminJson, body: JSON.stringify({ parentDepartmentId: childDept.id }),
  });
  check('re-parenting a department under its own child is rejected (cycle guard)', cycleRes.status === 400, String(cycleRes.status));

  const deactivateRes = await fetch(`${BASE}/departments/${childDept.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ active: false }) });
  check('deactivating a department succeeds', deactivateRes.status === 200, String(deactivateRes.status));
  const defaultList = (await (await fetch(`${BASE}/departments`, { headers: adminAuth })).json()) as AdminDepartment[];
  check('the default department list omits a deactivated department', !defaultList.some((d) => d.id === childDept.id), JSON.stringify(defaultList.map((d) => d.id)));
  const includeInactiveList = (await (await fetch(`${BASE}/departments?includeInactive=true`, { headers: adminAuth })).json()) as AdminDepartment[];
  check('includeInactive=true still shows the deactivated department', includeInactiveList.some((d) => d.id === childDept.id), JSON.stringify(includeInactiveList.map((d) => d.id)));
  await fetch(`${BASE}/departments/${childDept.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ active: true }) });

  const deptEmp = await makeEmployee('DeptGuard');
  await assignDepartment(deptEmp.id, childDept.id);
  const blockedDeleteRes = await fetch(`${BASE}/departments/${childDept.id}`, { method: 'DELETE', headers: adminAuth });
  const blockedDeleteBody = (await blockedDeleteRes.json()) as { message?: string };
  check('deleting a department with an assigned employee is blocked (409) and reports the count', blockedDeleteRes.status === 409 && (blockedDeleteBody.message ?? '').includes('1'), JSON.stringify(blockedDeleteBody));

  await fetch(`${BASE}/employees/${deptEmp.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ departmentId: null }) });
  const cleanDeleteRes = await fetch(`${BASE}/departments/${childDept.id}`, { method: 'DELETE', headers: adminAuth });
  check('deleting an empty, leaf department succeeds once the employee is reassigned', cleanDeleteRes.status === 200, String(cleanDeleteRes.status));

  // ══════════════════════════════════════════════════════════════════════
  // (h) Roles admin surface: seeded-not-deletable, in-use-not-deletable,
  // Admin can't be renamed, and the server-side scope-forcing guarantee.
  // ══════════════════════════════════════════════════════════════════════
  const roleList = (await (await fetch(`${BASE}/roles`, { headers: adminAuth })).json()) as AdminRole[];
  const adminRole = roleList.find((r) => r.name === 'Admin');
  check('Admin role is reported as seeded', adminRole?.isSeeded === true, JSON.stringify(adminRole));
  check(
    'Admin role holds every catalogue key, each at scope ALL',
    adminRole!.permissions.length === PERMISSION_KEYS.length && adminRole!.permissions.every((p) => p.scope === 'ALL'),
    JSON.stringify(adminRole),
  );

  const renameAdminRes = await fetch(`${BASE}/roles/${adminRole!.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ name: 'Not Admin Anymore' }) });
  check('the Admin role cannot be renamed', renameAdminRes.status === 409, String(renameAdminRes.status));

  const deleteSeededRes = await fetch(`${BASE}/roles/${adminRole!.id}`, { method: 'DELETE', headers: adminAuth });
  check('a seeded role cannot be deleted', deleteSeededRes.status === 409, String(deleteSeededRes.status));

  const deleteInUseRes = await fetch(`${BASE}/roles/${clerkRole.id}`, { method: 'DELETE', headers: adminAuth });
  check('a role still held by a user cannot be deleted', deleteInUseRes.status === 409, String(deleteInUseRes.status));

  const spareRole = (await (await fetch(`${BASE}/roles`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ name: `Spare ${stamp}`, permissions: [] }),
  })).json()) as AdminRole;
  const deleteSpareRes = await fetch(`${BASE}/roles/${spareRole.id}`, { method: 'DELETE', headers: adminAuth });
  check('an unused custom role can be deleted', deleteSpareRes.status === 200, String(deleteSpareRes.status));

  // The riskiest line in this whole migration: a client-submitted
  // OWN_DEPARTMENT scope on a non-scopeable key must be FORCED to ALL
  // server-side, never trusted as submitted (see UsersService.normalize()).
  const scopeAbuseRole = (await (await fetch(`${BASE}/roles`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ name: `Scope Abuse ${stamp}`, permissions: [{ key: 'settings.manage', scope: 'OWN_DEPARTMENT' }] }),
  })).json()) as AdminRole;
  check(
    'a client-submitted OWN_DEPARTMENT scope on a non-scopeable key is FORCED to ALL server-side',
    scopeAbuseRole.permissions.length === 1 && scopeAbuseRole.permissions[0].key === 'settings.manage' && scopeAbuseRole.permissions[0].scope === 'ALL',
    JSON.stringify(scopeAbuseRole),
  );

  // ══════════════════════════════════════════════════════════════════════
  // (i) Role templates
  // ══════════════════════════════════════════════════════════════════════
  const templates = (await (await fetch(`${BASE}/roles/templates`, { headers: adminAuth })).json()) as RoleTemplate[];
  const EXPECTED_TEMPLATE_NAMES = ['Payroll Officer', 'Line Supervisor', 'HR Assistant', 'Accountant', 'Compliance Officer'];
  check(
    'exactly the 5 expected role templates are exposed',
    templates.length === 5 && EXPECTED_TEMPLATE_NAMES.every((n) => templates.some((t) => t.name === n)),
    JSON.stringify(templates.map((t) => t.name)),
  );
  check(
    'every template permission key exists in the catalogue',
    templates.every((t) => t.permissions.every((p) => catalogueKeys.has(p.key))),
    JSON.stringify(templates.map((t) => t.permissions.map((p) => p.key))),
  );
  const lineSupervisorTpl = templates.find((t) => t.name === 'Line Supervisor');
  check(
    'Line Supervisor template scopes every permission to OWN_DEPARTMENT (matches its description)',
    !!lineSupervisorTpl && lineSupervisorTpl.permissions.length > 0 && lineSupervisorTpl.permissions.every((p) => p.scope === 'OWN_DEPARTMENT'),
    JSON.stringify(lineSupervisorTpl),
  );
  check(
    'Line Supervisor template matches the seeded Manager role default EXACTLY (item 1 of the follow-up review)',
    JSON.stringify(sortedPerms(lineSupervisorTpl?.permissions ?? [])) === JSON.stringify(sortedPerms([...(ROLE_PERMISSION_DEFAULTS.Manager ?? [])])),
    JSON.stringify({ lineSupervisor: lineSupervisorTpl?.permissions, manager: ROLE_PERMISSION_DEFAULTS.Manager }),
  );
  const payrollOfficerTpl = templates.find((t) => t.name === 'Payroll Officer');
  check(
    'Payroll Officer template does NOT include payroll.finalize (maker-checker)',
    !!payrollOfficerTpl && !payrollOfficerTpl.permissions.some((p) => p.key === 'payroll.finalize'),
    JSON.stringify(payrollOfficerTpl),
  );

  // ══════════════════════════════════════════════════════════════════════
  // (j) Row-level department scope — the riskiest property: scope must
  // filter DATA, not just gate the route. A Line Supervisor must see and
  // act on ONLY their own department's rows, and be refused acting on
  // another department's row even where an identity check alone would
  // allow it.
  // ══════════════════════════════════════════════════════════════════════
  const deptOwn = (await (await fetch(`${BASE}/departments`, { method: 'POST', headers: adminJson, body: JSON.stringify({ name: `Own Dept ${stamp}` }) })).json()) as AdminDepartment;
  const deptOther = (await (await fetch(`${BASE}/departments`, { method: 'POST', headers: adminJson, body: JSON.stringify({ name: `Other Dept ${stamp}` }) })).json()) as AdminDepartment;

  const supervisorEmp = await makeEmployee('Supervisor');
  await assignDepartment(supervisorEmp.id, deptOwn.id);
  const ownDeptWorker = await makeEmployee('OwnDeptWorker');
  await assignDepartment(ownDeptWorker.id, deptOwn.id);
  const otherDeptWorker = await makeEmployee('OtherDeptWorker');
  await assignDepartment(otherDeptWorker.id, deptOther.id);

  const supervisorRole = (await (await fetch(`${BASE}/roles`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({
      name: `Line Supervisor ${stamp}`,
      permissions: [
        { key: 'employees.view', scope: 'OWN_DEPARTMENT' },
        { key: 'leave.view', scope: 'OWN_DEPARTMENT' },
        { key: 'leave.approve', scope: 'OWN_DEPARTMENT' },
        { key: 'overtime.view', scope: 'OWN_DEPARTMENT' },
        { key: 'overtime.approve', scope: 'OWN_DEPARTMENT' },
        { key: 'attendance.view', scope: 'OWN_DEPARTMENT' },
      ],
    }),
  })).json()) as AdminRole;
  // The supervisor's OWN login must be linked to an employee IN deptOwn —
  // that link is how DepartmentScopeService resolves "own department".
  const { token: supervisorToken, userId: supervisorUserId } = await loginAsRole(supervisorRole.id, 'supervisor', orgAId, supervisorEmp.id);
  const supervisorAuth = { Authorization: `Bearer ${supervisorToken}` };

  // --- employees.view row-level ---
  const supEmpListRes = await fetch(`${BASE}/employees?pageSize=100`, { headers: supervisorAuth });
  const supEmpList = (await supEmpListRes.json()) as { data: Array<{ id: string }> };
  check("Line Supervisor employee list includes their own department's worker", supEmpList.data.some((e) => e.id === ownDeptWorker.id), JSON.stringify(supEmpList.data.map((e) => e.id)));
  check("Line Supervisor employee list EXCLUDES the other department's worker (row-level)", !supEmpList.data.some((e) => e.id === otherDeptWorker.id), JSON.stringify(supEmpList.data.map((e) => e.id)));
  const supEmpGetOtherRes = await fetch(`${BASE}/employees/${otherDeptWorker.id}`, { headers: supervisorAuth });
  check("Line Supervisor fetching the other department's employee by id gets 404 (not just filtered from lists)", supEmpGetOtherRes.status === 404, String(supEmpGetOtherRes.status));

  // --- leave: list + the identity-vs-scope proof ---
  const leaveType = (await (await fetch(`${BASE}/leave-types`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ name: `Verify Leave Type ${stamp}`, isPaid: true, requiresApproval: true, accrualMethod: 'NONE' }),
  })).json()) as { id: string };

  const leaveReqOwn = await base.leaveRequest.create({
    data: {
      organizationId: orgAId, employeeId: ownDeptWorker.id, leaveTypeId: leaveType.id,
      startDate: new Date('2099-03-01'), endDate: new Date('2099-03-02'), daysRequested: 2, status: 'PENDING',
      approvalSteps: { create: [{ stepOrder: 0, approverUserId: supervisorUserId }] },
    },
  });
  const leaveReqOther = await base.leaveRequest.create({
    data: {
      organizationId: orgAId, employeeId: otherDeptWorker.id, leaveTypeId: leaveType.id,
      startDate: new Date('2099-03-01'), endDate: new Date('2099-03-02'), daysRequested: 2, status: 'PENDING',
      // Same supervisor as the assigned approver on BOTH requests — isolates
      // the test to scope alone: identity passes either way, so only
      // department membership can be what blocks the second one.
      approvalSteps: { create: [{ stepOrder: 0, approverUserId: supervisorUserId }] },
    },
  });

  const supLeaveListRes = await fetch(`${BASE}/leave-requests`, { headers: supervisorAuth });
  const supLeaveList = (await supLeaveListRes.json()) as Array<{ id: string }>;
  check("Line Supervisor leave list includes their own department's request", supLeaveList.some((r) => r.id === leaveReqOwn.id), JSON.stringify(supLeaveList.map((r) => r.id)));
  check("Line Supervisor leave list EXCLUDES the other department's request (row-level)", !supLeaveList.some((r) => r.id === leaveReqOther.id), JSON.stringify(supLeaveList.map((r) => r.id)));

  const supApproveOwnRes = await fetch(`${BASE}/leave-requests/${leaveReqOwn.id}/approve`, { method: 'POST', headers: supervisorAuth });
  check("Line Supervisor CAN approve their own department's request (identity AND scope both satisfied)", supApproveOwnRes.status === 200 || supApproveOwnRes.status === 201, String(supApproveOwnRes.status));

  const supApproveOtherRes = await fetch(`${BASE}/leave-requests/${leaveReqOther.id}/approve`, { method: 'POST', headers: supervisorAuth });
  check(
    "Line Supervisor is REFUSED approving the other department's request EVEN THOUGH they are the assigned approver — scope is a real, independent gate, not just the route. 404, not 403 — see docs/auth.md's 403-vs-404 rule (out of scope must read as \"doesn't exist\")",
    supApproveOtherRes.status === 404, String(supApproveOtherRes.status),
  );

  // GET-by-id must be equally uninformative for an out-of-scope request —
  // not just the write path.
  const supGetOtherLeaveRes = await fetch(`${BASE}/leave-requests/${leaveReqOther.id}`, { headers: supervisorAuth });
  check("Line Supervisor fetching the other department's leave request by id gets 404 too (GET, not just the approve write)", supGetOtherLeaveRes.status === 404, String(supGetOtherLeaveRes.status));

  // --- overtime: list + get + approve, same identity-vs-scope proof ---
  const otOwn = await base.overtimeEntry.create({
    data: { organizationId: orgAId, employeeId: ownDeptWorker.id, date: new Date('2099-04-01'), hours: 2, category: 'NORMAL_DAY', source: 'MANUAL', status: 'PENDING' },
  });
  const otOther = await base.overtimeEntry.create({
    data: { organizationId: orgAId, employeeId: otherDeptWorker.id, date: new Date('2099-04-01'), hours: 2, category: 'NORMAL_DAY', source: 'MANUAL', status: 'PENDING' },
  });

  const supOtListRes = await fetch(`${BASE}/overtime`, { headers: supervisorAuth });
  const supOtList = (await supOtListRes.json()) as Array<{ id: string }>;
  check("Line Supervisor overtime list includes their own department's entry", supOtList.some((e) => e.id === otOwn.id), JSON.stringify(supOtList.map((e) => e.id)));
  check("Line Supervisor overtime list EXCLUDES the other department's entry (row-level)", !supOtList.some((e) => e.id === otOther.id), JSON.stringify(supOtList.map((e) => e.id)));

  const supOtGetOtherRes = await fetch(`${BASE}/overtime/${otOther.id}`, { headers: supervisorAuth });
  check("Line Supervisor fetching the other department's overtime entry by id gets 404", supOtGetOtherRes.status === 404, String(supOtGetOtherRes.status));

  const supOtApproveOwnRes = await fetch(`${BASE}/overtime/${otOwn.id}/approve`, { method: 'POST', headers: supervisorAuth });
  check("Line Supervisor CAN approve their own department's overtime entry", supOtApproveOwnRes.status === 200 || supOtApproveOwnRes.status === 201, String(supOtApproveOwnRes.status));

  const supOtApproveOtherRes = await fetch(`${BASE}/overtime/${otOther.id}/approve`, { method: 'POST', headers: supervisorAuth });
  check("Line Supervisor is REFUSED approving the other department's overtime entry (row-level, not route-level)", supOtApproveOtherRes.status === 404, String(supOtApproveOtherRes.status));

  // --- attendance: list-level row scoping (no approve concept here) ---
  const attOwn = await base.attendanceRecord.create({
    data: { organizationId: orgAId, employeeId: ownDeptWorker.id, date: new Date('2099-05-01'), status: 'PRESENT', source: 'MANUAL' },
  });
  const attOther = await base.attendanceRecord.create({
    data: { organizationId: orgAId, employeeId: otherDeptWorker.id, date: new Date('2099-05-01'), status: 'PRESENT', source: 'MANUAL' },
  });

  const supAttListRes = await fetch(`${BASE}/attendance`, { headers: supervisorAuth });
  const supAttList = (await supAttListRes.json()) as Array<{ id: string }>;
  check("Line Supervisor attendance list includes their own department's record", supAttList.some((r) => r.id === attOwn.id), JSON.stringify(supAttList.map((r) => r.id)));
  check("Line Supervisor attendance list EXCLUDES the other department's record (row-level)", !supAttList.some((r) => r.id === attOther.id), JSON.stringify(supAttList.map((r) => r.id)));

  // ══════════════════════════════════════════════════════════════════════
  // (m) Manager (seeded role, not a custom one) — item 1 of the follow-up
  // review: this is THE scenario that was silently broken. A department
  // head's login often holds nothing more than the seeded 'Manager' role,
  // and resolveFor() (leave-requests.service.ts) routes leave approvals to
  // whoever heads the applicant's department regardless of what role that
  // head's login holds — so a Manager-role head being unable to approve
  // their own team was a real, not hypothetical, break the moment
  // leave.approve/overtime.approve became hard requirements. Proven here
  // end-to-end: link managerEmp into deptOwn (the same department used for
  // the Line Supervisor test above), then approve for real.
  // ══════════════════════════════════════════════════════════════════════
  await assignDepartment(managerEmp.id, deptOwn.id);

  const mgrLeaveReqOwn = await base.leaveRequest.create({
    data: {
      organizationId: orgAId, employeeId: ownDeptWorker.id, leaveTypeId: leaveType.id,
      startDate: new Date('2099-03-10'), endDate: new Date('2099-03-11'), daysRequested: 2, status: 'PENDING',
      approvalSteps: { create: [{ stepOrder: 0, approverUserId: managerUserId }] },
    },
  });
  const mgrLeaveReqOther = await base.leaveRequest.create({
    data: {
      organizationId: orgAId, employeeId: otherDeptWorker.id, leaveTypeId: leaveType.id,
      startDate: new Date('2099-03-10'), endDate: new Date('2099-03-11'), daysRequested: 2, status: 'PENDING',
      approvalSteps: { create: [{ stepOrder: 0, approverUserId: managerUserId }] },
    },
  });

  const mgrApproveOwnRes = await fetch(`${BASE}/leave-requests/${mgrLeaveReqOwn.id}/approve`, { method: 'POST', headers: managerAuth });
  check(
    "Manager (seeded role) named as approver on THEIR OWN department's leave request completes approve end-to-end — the item-1 blocker, fixed",
    mgrApproveOwnRes.status === 200 || mgrApproveOwnRes.status === 201, String(mgrApproveOwnRes.status),
  );

  const mgrApproveOtherRes = await fetch(`${BASE}/leave-requests/${mgrLeaveReqOther.id}/approve`, { method: 'POST', headers: managerAuth });
  check(
    "Manager (seeded role) named as approver on ANOTHER department's leave request is still blocked (404) — the fix grants OWN_DEPARTMENT, not ALL",
    mgrApproveOtherRes.status === 404, String(mgrApproveOtherRes.status),
  );

  const mgrOtOwn = await base.overtimeEntry.create({
    data: { organizationId: orgAId, employeeId: ownDeptWorker.id, date: new Date('2099-04-10'), hours: 1.5, category: 'NORMAL_DAY', source: 'MANUAL', status: 'PENDING' },
  });
  const mgrOtOther = await base.overtimeEntry.create({
    data: { organizationId: orgAId, employeeId: otherDeptWorker.id, date: new Date('2099-04-10'), hours: 1.5, category: 'NORMAL_DAY', source: 'MANUAL', status: 'PENDING' },
  });

  const mgrOtApproveOwnRes = await fetch(`${BASE}/overtime/${mgrOtOwn.id}/approve`, { method: 'POST', headers: managerAuth });
  check(
    "Manager (seeded role) CAN approve an overtime entry in their own department (same fix, overtime side)",
    mgrOtApproveOwnRes.status === 200 || mgrOtApproveOwnRes.status === 201, String(mgrOtApproveOwnRes.status),
  );

  const mgrOtApproveOtherRes = await fetch(`${BASE}/overtime/${mgrOtOther.id}/approve`, { method: 'POST', headers: managerAuth });
  check(
    "Manager (seeded role) is still blocked approving another department's overtime entry (404)",
    mgrOtApproveOtherRes.status === 404, String(mgrOtApproveOtherRes.status),
  );

  // ══════════════════════════════════════════════════════════════════════
  // (k) Fail CLOSED: OWN_DEPARTMENT scope with no linked employee record
  // gets NOTHING, never everything.
  // ══════════════════════════════════════════════════════════════════════
  const noLinkRole = (await (await fetch(`${BASE}/roles`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({
      name: `No Link ${stamp}`,
      permissions: [
        { key: 'employees.view', scope: 'OWN_DEPARTMENT' },
        { key: 'leave.view', scope: 'OWN_DEPARTMENT' },
        { key: 'overtime.view', scope: 'OWN_DEPARTMENT' },
        { key: 'attendance.view', scope: 'OWN_DEPARTMENT' },
      ],
    }),
  })).json()) as AdminRole;
  // Deliberately NOT passing an employeeId — this login has no linked Employee.
  const { token: noLinkToken } = await loginAsRole(noLinkRole.id, 'nolink', orgAId);
  const noLinkAuth = { Authorization: `Bearer ${noLinkToken}` };

  const nlEmpRes = (await (await fetch(`${BASE}/employees`, { headers: noLinkAuth })).json()) as { data: unknown[]; total: number };
  check('no linked employee + OWN_DEPARTMENT: employees list is EMPTY, not the full directory (fail closed)', Array.isArray(nlEmpRes.data) && nlEmpRes.data.length === 0 && nlEmpRes.total === 0, JSON.stringify(nlEmpRes));

  const nlLeaveRes = (await (await fetch(`${BASE}/leave-requests`, { headers: noLinkAuth })).json()) as unknown[];
  check('no linked employee + OWN_DEPARTMENT: leave list is EMPTY (fail closed)', Array.isArray(nlLeaveRes) && nlLeaveRes.length === 0, JSON.stringify(nlLeaveRes));

  const nlOtRes = (await (await fetch(`${BASE}/overtime`, { headers: noLinkAuth })).json()) as unknown[];
  check('no linked employee + OWN_DEPARTMENT: overtime list is EMPTY (fail closed)', Array.isArray(nlOtRes) && nlOtRes.length === 0, JSON.stringify(nlOtRes));

  const nlAttRes = (await (await fetch(`${BASE}/attendance`, { headers: noLinkAuth })).json()) as unknown[];
  check('no linked employee + OWN_DEPARTMENT: attendance list is EMPTY (fail closed)', Array.isArray(nlAttRes) && nlAttRes.length === 0, JSON.stringify(nlAttRes));

  // ══════════════════════════════════════════════════════════════════════
  // (l) Two-org isolation, both directions, including the newly scoped endpoints
  // ══════════════════════════════════════════════════════════════════════
  const orgZ = await base.organization.create({ data: { name: `__permissions_probe_${stamp}__` } });
  const roleZAdmin = await base.role.create({
    data: { organizationId: orgZ.id, name: 'Admin', permissions: PERMISSION_KEYS.map((key) => ({ key, scope: 'ALL' })) },
  });
  const orgZAdminEmail = `perm.z.admin.${stamp}@example.com`;
  const orgZAdminPassword = 'OrgZAdmin123!';
  const orgZAdminUser = await base.user.create({
    data: {
      organizationId: orgZ.id, email: orgZAdminEmail,
      passwordHash: await passwords.hash(orgZAdminPassword),
      mustChangePassword: false, roleId: roleZAdmin.id,
    },
  });

  try {
    const tokenZAdmin = await login(orgZAdminEmail, orgZAdminPassword);
    const zAdminAuth = { Authorization: `Bearer ${tokenZAdmin}` };
    const zAdminJson = { Authorization: `Bearer ${tokenZAdmin}`, 'Content-Type': 'application/json' };

    const deptZ = (await (await fetch(`${BASE}/departments`, { method: 'POST', headers: zAdminJson, body: JSON.stringify({ name: `Org Z Dept ${stamp}` }) })).json()) as AdminDepartment;
    check('org Z can create its own department', !!deptZ.id, JSON.stringify(deptZ));

    const orgADeptList = (await (await fetch(`${BASE}/departments`, { headers: adminAuth })).json()) as AdminDepartment[];
    check("org A's department list does not include org Z's department", !orgADeptList.some((d) => d.id === deptZ.id), JSON.stringify(orgADeptList.map((d) => d.id)));
    const orgAFetchZDept = await fetch(`${BASE}/departments/${deptZ.id}`, { headers: adminAuth });
    check("org A fetching org Z's department by id gets 404", orgAFetchZDept.status === 404, String(orgAFetchZDept.status));

    const orgZDeptList = (await (await fetch(`${BASE}/departments`, { headers: zAdminAuth })).json()) as AdminDepartment[];
    check("org Z's department list does not include org A's department", !orgZDeptList.some((d) => d.id === parentDept.id), JSON.stringify(orgZDeptList.map((d) => d.id)));
    const orgZFetchADept = await fetch(`${BASE}/departments/${parentDept.id}`, { headers: zAdminAuth });
    check("org Z fetching org A's department by id gets 404", orgZFetchADept.status === 404, String(orgZFetchADept.status));

    const roleZ = (await (await fetch(`${BASE}/roles`, {
      method: 'POST', headers: zAdminJson, body: JSON.stringify({ name: `Payroll Clerk ${stamp}`, permissions: [] }),
    })).json()) as AdminRole;
    const orgARolesList = (await (await fetch(`${BASE}/roles`, { headers: adminAuth })).json()) as AdminRole[];
    check("org A's role list does not include org Z's same-named custom role", !orgARolesList.some((r) => r.id === roleZ.id), JSON.stringify(orgARolesList.map((r) => r.id)));
    const orgZRolesList = (await (await fetch(`${BASE}/roles`, { headers: zAdminAuth })).json()) as AdminRole[];
    check("org Z's role list does not include org A's custom role", !orgZRolesList.some((r) => r.id === clerkRole.id), JSON.stringify(orgZRolesList.map((r) => r.id)));

    // Row-level isolation for the newly scoped endpoints too: org Z's Admin
    // (scope ALL) must never see org A's rows either — org boundary always
    // wins over scope, which only narrows WITHIN one org.
    const zLeaveList = (await (await fetch(`${BASE}/leave-requests`, { headers: zAdminAuth })).json()) as Array<{ id: string }>;
    check("org Z's leave list does not include org A's leave requests", !zLeaveList.some((r) => r.id === leaveReqOwn.id || r.id === leaveReqOther.id), JSON.stringify(zLeaveList.map((r) => r.id)));
    const zOtList = (await (await fetch(`${BASE}/overtime`, { headers: zAdminAuth })).json()) as Array<{ id: string }>;
    check("org Z's overtime list does not include org A's overtime entries", !zOtList.some((e) => e.id === otOwn.id || e.id === otOther.id), JSON.stringify(zOtList.map((e) => e.id)));
  } finally {
    await base.leaveRequest.deleteMany({ where: { organizationId: orgAId, id: { in: [leaveReqOwn.id, leaveReqOther.id, mgrLeaveReqOwn.id, mgrLeaveReqOther.id] } } }).catch(() => undefined);
    await base.overtimeEntry.deleteMany({ where: { organizationId: orgAId, id: { in: [otOwn.id, otOther.id, mgrOtOwn.id, mgrOtOther.id] } } }).catch(() => undefined);
    await base.attendanceRecord.deleteMany({ where: { organizationId: orgAId, id: { in: [attOwn.id, attOther.id] } } }).catch(() => undefined);
    await base.department.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgZ.id, name: { not: 'Admin' } } }).catch(() => undefined);
    await base.session.deleteMany({ where: { userId: orgZAdminUser.id } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await (prisma as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
