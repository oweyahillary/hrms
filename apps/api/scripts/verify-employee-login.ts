/**
 * Prove employee login provisioning: POST /employees/:id/create-login mints a
 * working, org-scoped account for an existing employee — the gap flagged
 * repeatedly in prior handovers ("no employee has a login, so dept heads can
 * never approve"). Covers: the temp password actually logs in and forces a
 * password change, duplicate provisioning is rejected (both by employee and
 * by email), granting 'Admin' is refused to a non-Admin actor, and the
 * employee detail response reflects login status.
 *
 *   cd apps/api && npx ts-node scripts/verify-employee-login.ts
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface LoginResult { email: string; temporaryPassword: string; role: string; message?: string | string[] }
interface EmployeeDetail {
  id: string;
  login: { email: string; role: string; isActive: boolean } | null;
  message?: string | string[];
}

async function main(): Promise<void> {
  const stamp = Date.now();

  const login = async (email: string, password: string): Promise<string> => {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const t = ((await r.json()) as { accessToken?: string }).accessToken;
    if (!t) { console.log(`  FAIL  login as ${email}`); process.exit(1); }
    return t;
  };

  const adminToken = await login('admin@example.com', 'ChangeMe123!');
  const adminAuth = { Authorization: `Bearer ${adminToken}` };
  const adminJson = { ...adminAuth, 'Content-Type': 'application/json' };

  const makeEmployee = async (tag: string): Promise<string> => {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({
        employeeNumber: `LOGIN${tag}`, firstName: 'Login', lastName: `Tester${tag}`,
        nationalId: `${String(stamp).slice(-7)}${tag}`.slice(-8),
        employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    return ((await r.json()) as { id: string }).id;
  };

  const createLogin = async (
    employeeId: string, email: string, roleName: string, headers: Record<string, string>,
  ): Promise<{ status: number; body: LoginResult }> => {
    const r = await fetch(`${BASE}/employees/${employeeId}/create-login`, {
      method: 'POST', headers, body: JSON.stringify({ email, roleName }),
    });
    return { status: r.status, body: (await r.json()) as LoginResult };
  };

  const getDetail = async (employeeId: string): Promise<EmployeeDetail> =>
    (await (await fetch(`${BASE}/employees/${employeeId}`, { headers: adminAuth })).json()) as EmployeeDetail;

  // ------------------------------------------------------------------
  // A fresh employee has no login until one is created.
  // ------------------------------------------------------------------
  const emp = await makeEmployee(`${stamp}1`);
  const before = await getDetail(emp);
  check('a fresh employee has no login', before.login === null, JSON.stringify(before.login));

  const email = `login.${stamp}@example.com`;
  const created = await createLogin(emp, email, 'Employee', adminJson);
  check('creating a login succeeds', Boolean(created.body.temporaryPassword), JSON.stringify(created.body));
  check('the temporary password is returned once, in the response body',
    typeof created.body.temporaryPassword === 'string' && created.body.temporaryPassword.length >= 12,
    String(created.body.temporaryPassword));

  const after = await getDetail(emp);
  check('the employee detail now reflects the login',
    after.login?.email === email && after.login.role === 'Employee' && after.login.isActive === true,
    JSON.stringify(after.login));

  // ------------------------------------------------------------------
  // The temp password actually works, and forces a password change.
  // ------------------------------------------------------------------
  const empToken = await login(email, created.body.temporaryPassword);
  const me = (await (await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${empToken}` } })).json()) as {
    mustChangePassword: boolean;
  };
  check('the new login must change its password on first use', me.mustChangePassword === true, String(me.mustChangePassword));

  // A route with no @BypassPasswordChange is blocked until the change happens.
  const blocked = await fetch(`${BASE}/employees`, { headers: { Authorization: `Bearer ${empToken}` } });
  check('an unchanged temp password blocks ordinary routes', blocked.status === 403, `got ${blocked.status}`);

  // ------------------------------------------------------------------
  // Duplicate provisioning is rejected — by employee, and by email.
  // ------------------------------------------------------------------
  const dupEmployee = await createLogin(emp, `other.${stamp}@example.com`, 'Employee', adminJson);
  check('an employee that already has a login cannot be given a second one',
    dupEmployee.status === 409, `got ${dupEmployee.status}`);

  const emp2 = await makeEmployee(`${stamp}2`);
  const dupEmail = await createLogin(emp2, email, 'Employee', adminJson);
  check('an email already in use cannot be reused for a different employee\'s login',
    dupEmail.status === 409, `got ${dupEmail.status}`);

  // ------------------------------------------------------------------
  // Granting 'Admin' is restricted to Admin actors.
  // ------------------------------------------------------------------
  const emp3 = await makeEmployee(`${stamp}3`);
  const managerEmail = `manager.${stamp}@example.com`;
  const managerLogin = await createLogin(emp3, managerEmail, 'HR Manager', adminJson);
  check('an HR Manager login can be provisioned by an Admin', managerLogin.status === 201, `got ${managerLogin.status}`);

  const managerToken = await login(managerEmail, managerLogin.body.temporaryPassword);
  await fetch(`${BASE}/auth/change-password`, {
    method: 'POST', headers: { Authorization: `Bearer ${managerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: managerLogin.body.temporaryPassword, newPassword: 'ManagerPass123!' }),
  });
  const managerToken2 = await login(managerEmail, 'ManagerPass123!');
  const managerAuth = { Authorization: `Bearer ${managerToken2}`, 'Content-Type': 'application/json' };

  const emp4 = await makeEmployee(`${stamp}4`);
  const adminGrantAttempt = await createLogin(emp4, `wannabe.${stamp}@example.com`, 'Admin', managerAuth);
  check('a non-Admin actor cannot grant the Admin role', adminGrantAttempt.status === 403, `got ${adminGrantAttempt.status}`);

  // But the same HR Manager CAN provision a non-Admin login.
  const managerCanGrantEmployee = await createLogin(emp4, `ok.${stamp}@example.com`, 'Employee', managerAuth);
  check('a non-Admin HR actor can still grant a non-Admin role', managerCanGrantEmployee.status === 201,
    `got ${managerCanGrantEmployee.status}`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
