/**
 * Prove the permissions migration end-to-end over HTTP:
 *  - a custom role with a narrow permission set can do exactly what it's
 *    granted and nothing more;
 *  - each seeded role (Admin, HR Manager, HR Officer, Manager, Employee)
 *    has EXACTLY the access it had before the refactor — asserted
 *    endpoint-by-endpoint, including the "Manager gets nothing" naming
 *    discrepancy this migration deliberately preserved;
 *  - pii.view still gates decrypted PII on GET /employees/:id;
 *  - the new Departments (active/deactivate/employee-count-guard/cycle
 *    guard) and Roles (seeded-not-deletable/in-use-not-deletable) admin
 *    surfaces work correctly;
 *  - two-org isolation holds in both directions for the new endpoints.
 *
 *   cd apps/api && npx ts-node scripts/verify-permissions.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Mirrors verify-self-service.ts's throwaway-second-org pattern.
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface PermissionDef { key: string; label: string; description: string }
interface AdminRole { id: string; name: string; permissions: string[]; isSeeded: boolean; userCount: number }
interface AdminDepartment {
  id: string; name: string; parentDepartmentId: string | null; headEmployeeId: string | null;
  active: boolean; employeeCount: number; subDepartmentCount: number;
}
interface Employee { id: string; nationalId?: string }

async function main(): Promise<void> {
  const stamp = Date.now();
  let nid = 0;
  const nationalId = (): string => `${String(stamp).slice(-7)}${nid++}`;

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
    const emp = (await r.json()) as { id?: string };
    if (!emp.id) throw new Error(`employee create failed for ${tag}`);
    return { id: emp.id };
  }

  /**
   * A login with a DIRECTLY-created role (not via createLogin's fixed
   * GRANTABLE_ROLE_NAMES list — this is how a genuinely custom role, or a
   * seeded-name role in a fresh org, gets a real session to test against).
   */
  async function loginAsRole(roleId: string, tag: string, orgId: string): Promise<string> {
    const email = `perm.${tag}.${stamp}@example.com`;
    const password = 'PermVerify123!';
    await base.user.create({
      data: {
        organizationId: orgId, email, passwordHash: await passwords.hash(password),
        mustChangePassword: false, roleId,
      },
    });
    return login(email, password);
  }

  // ══════════════════════════════════════════════════════════════════════
  // (a) Permission catalogue
  // ══════════════════════════════════════════════════════════════════════
  const catalogue = (await (await fetch(`${BASE}/roles/catalogue`, { headers: adminAuth })).json()) as PermissionDef[];
  check('catalogue exposes a non-trivial set of permission keys', catalogue.length >= 10, String(catalogue.length));
  check('catalogue includes payroll.run and payroll.finalize as DISTINCT keys',
    catalogue.some((p) => p.key === 'payroll.run') && catalogue.some((p) => p.key === 'payroll.finalize'), JSON.stringify(catalogue.map((p) => p.key)));

  // ══════════════════════════════════════════════════════════════════════
  // (b) A custom role with a narrow grant can do exactly what it's granted
  // ══════════════════════════════════════════════════════════════════════
  const clerkRole = (await (await fetch(`${BASE}/roles`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ name: `Payroll Clerk ${stamp}`, permissions: ['payroll.run'] }),
  })).json()) as AdminRole;
  check('custom role created with exactly the requested permission', clerkRole.permissions.length === 1 && clerkRole.permissions[0] === 'payroll.run', JSON.stringify(clerkRole));
  check('a freshly-created custom role is not seeded', clerkRole.isSeeded === false, JSON.stringify(clerkRole));

  const clerkToken = await loginAsRole(clerkRole.id, 'clerk', orgAId);
  const clerkAuth = { Authorization: `Bearer ${clerkToken}` };
  const clerkJson = { Authorization: `Bearer ${clerkToken}`, 'Content-Type': 'application/json' };

  const clerkMe = (await (await fetch(`${BASE}/auth/me`, { headers: clerkAuth })).json()) as { permissions?: string[] };
  check('session payload carries exactly the role\'s permission set', JSON.stringify(clerkMe.permissions) === JSON.stringify(['payroll.run']), JSON.stringify(clerkMe.permissions));

  const clerkEmp = await makeEmployee('Clerk');
  await fetch(`${BASE}/employees/${clerkEmp.id}/salary-structures`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ basicSalary: 50000, effectiveDate: '2020-01-01', reason: 'Salary revision' }),
  });
  const clerkRunRes = await fetch(`${BASE}/payroll/runs`, {
    method: 'POST', headers: clerkJson, body: JSON.stringify({ periodMonth: 6, periodYear: 2099, employeeIds: [clerkEmp.id] }),
  });
  const clerkRun = (await clerkRunRes.json()) as { id?: string };
  check('granted payroll.run: creating a payroll run succeeds', clerkRunRes.status === 201 || clerkRunRes.status === 200, String(clerkRunRes.status));

  const clerkFinalizeRes = await fetch(`${BASE}/payroll/runs/${clerkRun.id}/finalize`, { method: 'POST', headers: clerkAuth });
  check('NOT granted payroll.finalize: finalizing is refused (403)', clerkFinalizeRes.status === 403, String(clerkFinalizeRes.status));

  const clerkDeptRes = await fetch(`${BASE}/departments`, { method: 'POST', headers: clerkJson, body: JSON.stringify({ name: 'Should not be created' }) });
  check('NOT granted org_structure.manage: creating a department is refused (403)', clerkDeptRes.status === 403, String(clerkDeptRes.status));

  const clerkEmpWriteRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: clerkJson,
    body: JSON.stringify({ employeeNumber: `SHOULDFAIL-${stamp}`, firstName: 'X', lastName: 'Y', nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01' }),
  });
  check('NOT granted employees.write: creating an employee is refused (403)', clerkEmpWriteRes.status === 403, String(clerkEmpWriteRes.status));

  // ══════════════════════════════════════════════════════════════════════
  // (c) Seeded roles: effective access unchanged, endpoint-by-endpoint
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

  // HR Manager / HR Officer: full HR access, but NOT users.manage / statutory_rates.manage / employees.anonymize (Admin-only before this migration too).
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
  }

  // Manager: the naming discrepancy this migration deliberately preserved — zero elevated access, identical to Employee.
  const mgrDeptRes = await fetch(`${BASE}/departments`, { method: 'POST', headers: managerJson, body: JSON.stringify({ name: 'Should not be created' }) });
  check('Manager role CANNOT manage departments (preserves the pre-migration "Manager has no elevated access" behaviour)', mgrDeptRes.status === 403, String(mgrDeptRes.status));
  const mgrEmployeesListRes = await fetch(`${BASE}/employees`, { headers: managerAuth });
  check('Manager CAN still reach the (deliberately ungated) employee list', mgrEmployeesListRes.status === 200, String(mgrEmployeesListRes.status));
  const mgrCreateRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: managerJson,
    body: JSON.stringify({ employeeNumber: `MGRFAIL-${stamp}`, firstName: 'X', lastName: 'Y', nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01' }),
  });
  check('Manager CANNOT create employees (employees.write)', mgrCreateRes.status === 403, String(mgrCreateRes.status));

  // Employee: self-service only.
  const empDeptRes = await fetch(`${BASE}/departments`, { method: 'POST', headers: employeeJson, body: JSON.stringify({ name: 'Should not be created' }) });
  check('Employee role CANNOT manage departments', empDeptRes.status === 403, String(empDeptRes.status));
  const meProfileRes = await fetch(`${BASE}/me/profile`, { headers: employeeAuth });
  check('Employee CAN still reach their own self-service profile', meProfileRes.status === 200, String(meProfileRes.status));

  // ══════════════════════════════════════════════════════════════════════
  // (d) pii.view still gates decrypted PII
  // ══════════════════════════════════════════════════════════════════════
  const piiTargetNatId = nationalId();
  const piiTargetRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeNumber: `PII-${stamp}`, firstName: 'Pii', lastName: 'Target', nationalId: piiTargetNatId, employmentType: 'PERMANENT', hireDate: '2020-01-01' }),
  });
  const piiTarget = (await piiTargetRes.json()) as Employee;

  const viaHrOfficer = (await (await fetch(`${BASE}/employees/${piiTarget.id}`, { headers: hrOfficerAuth })).json()) as { nationalId?: string; piiMasked?: boolean };
  check('HR Officer (has pii.view) sees the UNMASKED national ID', viaHrOfficer.nationalId === piiTargetNatId && viaHrOfficer.piiMasked === false, JSON.stringify(viaHrOfficer));

  const viaManager = (await (await fetch(`${BASE}/employees/${piiTarget.id}`, { headers: managerAuth })).json()) as { nationalId?: string; piiMasked?: boolean };
  check('Manager (no pii.view) sees a MASKED national ID', viaManager.nationalId !== piiTargetNatId && viaManager.nationalId?.startsWith('*') === true && viaManager.piiMasked === true, JSON.stringify(viaManager));

  // ══════════════════════════════════════════════════════════════════════
  // (e) Departments admin surface: active/deactivate/cycle guard/employee-count guard
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
  await fetch(`${BASE}/employees/${deptEmp.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ departmentId: childDept.id }) });
  const blockedDeleteRes = await fetch(`${BASE}/departments/${childDept.id}`, { method: 'DELETE', headers: adminAuth });
  const blockedDeleteBody = (await blockedDeleteRes.json()) as { message?: string };
  check('deleting a department with an assigned employee is blocked (409) and reports the count', blockedDeleteRes.status === 409 && (blockedDeleteBody.message ?? '').includes('1'), JSON.stringify(blockedDeleteBody));

  await fetch(`${BASE}/employees/${deptEmp.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ departmentId: null }) });
  const cleanDeleteRes = await fetch(`${BASE}/departments/${childDept.id}`, { method: 'DELETE', headers: adminAuth });
  check('deleting an empty, leaf department succeeds once the employee is reassigned', cleanDeleteRes.status === 200, String(cleanDeleteRes.status));

  // ══════════════════════════════════════════════════════════════════════
  // (f) Roles admin surface: seeded-not-deletable, in-use-not-deletable, Admin can't be renamed
  // ══════════════════════════════════════════════════════════════════════
  const roleList = (await (await fetch(`${BASE}/roles`, { headers: adminAuth })).json()) as AdminRole[];
  const adminRole = roleList.find((r) => r.name === 'Admin');
  check('Admin role is reported as seeded', adminRole?.isSeeded === true, JSON.stringify(adminRole));

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

  // ══════════════════════════════════════════════════════════════════════
  // (g) Two-org isolation, both directions, for the new endpoints
  // ══════════════════════════════════════════════════════════════════════
  const orgZ = await base.organization.create({ data: { name: `__permissions_probe_${stamp}__` } });
  const roleZAdmin = await base.role.create({ data: { organizationId: orgZ.id, name: 'Admin', permissions: ['employees.write', 'pii.view', 'users.manage', 'employees.anonymize', 'org_structure.manage', 'leave.manage', 'shifts.manage', 'attendance.manage', 'compliance.manage', 'settings.manage', 'statutory_rates.manage', 'payroll.run', 'payroll.finalize', 'payroll.manage'] } });
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
    check('org A\'s department list does not include org Z\'s department', !orgADeptList.some((d) => d.id === deptZ.id), JSON.stringify(orgADeptList.map((d) => d.id)));
    const orgAFetchZDept = await fetch(`${BASE}/departments/${deptZ.id}`, { headers: adminAuth });
    check('org A fetching org Z\'s department by id gets 404', orgAFetchZDept.status === 404, String(orgAFetchZDept.status));

    const orgZDeptList = (await (await fetch(`${BASE}/departments`, { headers: zAdminAuth })).json()) as AdminDepartment[];
    check('org Z\'s department list does not include org A\'s parent department', !orgZDeptList.some((d) => d.id === parentDept.id), JSON.stringify(orgZDeptList.map((d) => d.id)));
    const orgZFetchADept = await fetch(`${BASE}/departments/${parentDept.id}`, { headers: zAdminAuth });
    check('org Z fetching org A\'s department by id gets 404', orgZFetchADept.status === 404, String(orgZFetchADept.status));

    const roleZ = (await (await fetch(`${BASE}/roles`, {
      method: 'POST', headers: zAdminJson, body: JSON.stringify({ name: `Payroll Clerk ${stamp}`, permissions: [] }),
    })).json()) as AdminRole;
    const orgARolesList = (await (await fetch(`${BASE}/roles`, { headers: adminAuth })).json()) as AdminRole[];
    check('org A\'s role list does not include org Z\'s same-named custom role', !orgARolesList.some((r) => r.id === roleZ.id), JSON.stringify(orgARolesList.map((r) => r.id)));
    const orgZRolesList = (await (await fetch(`${BASE}/roles`, { headers: zAdminAuth })).json()) as AdminRole[];
    check('org Z\'s role list does not include org A\'s custom role', !orgZRolesList.some((r) => r.id === clerkRole.id), JSON.stringify(orgZRolesList.map((r) => r.id)));
  } finally {
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
