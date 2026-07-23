/**
 * Prove the employee self-service endpoints end-to-end over HTTP: an
 * employee's own payslip list contains only their own payslips, requesting
 * someone else's payslip PDF is refused (same org AND across orgs), /me/profile
 * returns the caller's own decrypted identifiers (not masked, not someone
 * else's), and an org-B login sees nothing belonging to org A.
 *
 *   cd apps/api && npx ts-node scripts/verify-self-service.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Creates a throwaway second organization (direct Prisma, mirroring
 * verify-tenant-scope.ts) to prove tenant isolation, not just per-employee
 * ownership within one org.
 *
 * NOTE on cleanup: the throwaway org's Session/User/Employee/Role rows are
 * deleted afterwards, but the Organization row itself is NOT — it can't be.
 * Every action against it goes through a real HTTP login (that's the point —
 * these are real tokens, not synthetic context injection), and every one of
 * those writes an append-only audit_logs row (db/immutability.sql blocks
 * DELETE on that table unconditionally). Organization has a Restrict FK from
 * audit_logs, so once real auth activity happens against an org, the org row
 * is permanent — a correct consequence of audit immutability, not a bug here.
 * Harmless: in CI the whole DB is thrown away with the ephemeral Postgres
 * container; locally this leaves one small, inert
 * `__selfservice_probe_<timestamp>__` organization per run.
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const PERIOD_MONTH = 4;
const PERIOD_YEAR = 2096; // unused by any other verify-*.ts fixture

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface MyProfile {
  id: string; employeeNumber: string; nationalId: string; kraPin: string | null;
}
interface MyPayslip { id: string; periodMonth: number | null; periodYear: number | null; pdfStatus: string }

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

  /** Provision a login for `employeeId` and get past the forced first-change, returning a usable token. */
  async function provisionEmployeeLogin(
    employeeId: string, email: string, adminJson: Record<string, string>,
  ): Promise<string> {
    const created = await fetch(`${BASE}/employees/${employeeId}/create-login`, {
      method: 'POST', headers: adminJson, body: JSON.stringify({ email, roleName: 'Employee' }),
    });
    const { temporaryPassword } = (await created.json()) as { temporaryPassword?: string };
    if (!temporaryPassword) { console.log(`  FAIL  create-login for ${email}`); process.exit(1); }

    const tempToken = await login(email, temporaryPassword);
    const newPassword = 'SelfService123!';
    await fetch(`${BASE}/auth/change-password`, {
      method: 'POST', headers: { Authorization: `Bearer ${tempToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
    });
    return login(email, newPassword);
  }

  // ── Org A (the seeded org) — admin creates two employees + logins ──
  const adminToken = await login('admin@example.com', 'ChangeMe123!');
  const adminJson = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  async function makeEmployee(tag: string, natId: string): Promise<string> {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({
        employeeNumber: `SS-${tag}-${stamp}`, firstName: 'SelfService', lastName: tag,
        nationalId: natId, employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const id = ((await r.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    await fetch(`${BASE}/employees/${id}/salary-structures`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({ basicSalary: 60000, effectiveDate: '2020-01-01', reason: 'Salary revision' }),
    });
    return id;
  }

  const natIdA = nationalId();
  const empA = await makeEmployee('A', natIdA);
  const empB = await makeEmployee('B', nationalId());
  const tokenA = await provisionEmployeeLogin(empA, `ss.a.${stamp}@example.com`, adminJson);
  const tokenB = await provisionEmployeeLogin(empB, `ss.b.${stamp}@example.com`, adminJson);
  const authA = { Authorization: `Bearer ${tokenA}` };
  const authB = { Authorization: `Bearer ${tokenB}` };

  // One payroll run covering both A and B, finalized so payslip PDFs render.
  const run = await fetch(`${BASE}/payroll/runs`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, employeeIds: [empA, empB] }),
  });
  const runBody = (await run.json()) as {
    id?: string; payslips?: Array<{ id: string; employeeId: string }>;
  };
  if (!runBody.id) { console.log('  FAIL  payroll run create'); process.exit(1); }
  const slipAId = runBody.payslips?.find((p) => p.employeeId === empA)?.id;
  const slipBId = runBody.payslips?.find((p) => p.employeeId === empB)?.id;
  if (!slipAId || !slipBId) { console.log('  FAIL  payroll run did not produce both payslips'); process.exit(1); }
  const finalize = await fetch(`${BASE}/payroll/runs/${runBody.id}/finalize`, { method: 'POST', headers: adminJson });
  const finalized = (await finalize.json()) as { payslips?: Array<{ id: string; pdfStatus: string }> };
  check('finalize renders both payslip PDFs synchronously',
    (finalized.payslips ?? []).every((p) => p.pdfStatus === 'READY'),
    JSON.stringify(finalized.payslips?.map((p) => p.pdfStatus)));

  // ── (a) A's own payslip list contains only A's payslip ──
  const payslipsA = (await (await fetch(`${BASE}/me/payslips`, { headers: authA })).json()) as MyPayslip[];
  check('A\'s /me/payslips includes A\'s own payslip', payslipsA.some((p) => p.id === slipAId), JSON.stringify(payslipsA));
  check('A\'s /me/payslips does NOT include B\'s payslip', !payslipsA.some((p) => p.id === slipBId), JSON.stringify(payslipsA));

  const payslipsB = (await (await fetch(`${BASE}/me/payslips`, { headers: authB })).json()) as MyPayslip[];
  check('B\'s /me/payslips includes B\'s own payslip', payslipsB.some((p) => p.id === slipBId), JSON.stringify(payslipsB));
  check('B\'s /me/payslips does NOT include A\'s payslip', !payslipsB.some((p) => p.id === slipAId), JSON.stringify(payslipsB));

  // ── (b) A requesting B's payslip PDF is refused; A's own PDF still works ──
  const crossRes = await fetch(`${BASE}/me/payslips/${slipBId}/pdf`, { headers: authA });
  check('A downloading B\'s payslip PDF gets 403 (not 404, not the file)', crossRes.status === 403, `got ${crossRes.status}`);

  const ownRes = await fetch(`${BASE}/me/payslips/${slipAId}/pdf`, { headers: authA });
  const ownBytes = Buffer.from(await ownRes.arrayBuffer());
  check('A downloading A\'s own payslip PDF succeeds with a real PDF (positive control)',
    ownRes.status === 200 && ownBytes.subarray(0, 4).toString('latin1') === '%PDF', `status=${ownRes.status}`);

  // ── (c) /me/profile returns the caller's own decrypted identifiers ──
  const profileA = (await (await fetch(`${BASE}/me/profile`, { headers: authA })).json()) as MyProfile;
  check('A\'s /me/profile resolves to employee A\'s own record', profileA.id === empA, profileA.id);
  check('A\'s /me/profile nationalId decrypts to exactly what was submitted (not masked, not someone else\'s)',
    profileA.nationalId === natIdA, `got ${profileA.nationalId}`);

  // ── (d) tenant isolation — an org-Z login sees nothing from org A ──
  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  const orgZ = await base.organization.create({ data: { name: `__selfservice_probe_${stamp}__` } });
  const roleZ = await base.role.create({ data: { organizationId: orgZ.id, name: 'Admin', permissions: { all: true } } });
  const passwords = new PasswordService();
  const orgZAdminEmail = `ss.z.admin.${stamp}@example.com`;
  const orgZAdminPassword = 'OrgZAdmin123!';
  const orgZAdminUser = await base.user.create({
    data: {
      organizationId: orgZ.id, email: orgZAdminEmail,
      passwordHash: await passwords.hash(orgZAdminPassword),
      mustChangePassword: false, roleId: roleZ.id,
    },
  });

  let orgZEmpUserId: string | null = null;
  try {
    const tokenZAdmin = await login(orgZAdminEmail, orgZAdminPassword);
    const zAdminJson = { Authorization: `Bearer ${tokenZAdmin}`, 'Content-Type': 'application/json' };

    const empZRes = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: zAdminJson,
      body: JSON.stringify({
        employeeNumber: `SS-Z-${stamp}`, firstName: 'SelfService', lastName: 'Z',
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const empZ = ((await empZRes.json()) as { id?: string }).id;
    if (!empZ) { console.log('  FAIL  org-Z employee create'); process.exit(1); }

    const tokenZ = await provisionEmployeeLogin(empZ, `ss.z.emp.${stamp}@example.com`, zAdminJson);
    const authZ = { Authorization: `Bearer ${tokenZ}` };

    const payslipsZ = (await (await fetch(`${BASE}/me/payslips`, { headers: authZ })).json()) as MyPayslip[];
    check('org-Z\'s /me/payslips is empty (no org-A data leaks through)',
      Array.isArray(payslipsZ) && payslipsZ.length === 0, JSON.stringify(payslipsZ));

    const crossOrgRes = await fetch(`${BASE}/me/payslips/${slipAId}/pdf`, { headers: authZ });
    check('org-Z requesting org-A\'s known payslip id by GUESS gets 403 (cross-tenant, not just cross-employee)',
      crossOrgRes.status === 403, `got ${crossOrgRes.status}`);

    const profileZ = (await (await fetch(`${BASE}/me/profile`, { headers: authZ })).json()) as MyProfile;
    check('org-Z\'s /me/profile resolves to org-Z\'s own employee (not org A\'s)',
      profileZ.id === empZ && profileZ.id !== empA && profileZ.id !== empB, profileZ.id);

    const leaveZ = (await (await fetch(`${BASE}/me/leave`, { headers: authZ })).json()) as {
      requests: unknown[]; balances: unknown[];
    };
    check('org-Z\'s /me/leave returns empty (no data, no error, no cross-org leak)',
      Array.isArray(leaveZ.requests) && leaveZ.requests.length === 0
        && Array.isArray(leaveZ.balances) && leaveZ.balances.length === 0,
      JSON.stringify(leaveZ));

    const orgZEmp = (await base.user.findFirst({ where: { organizationId: orgZ.id, email: `ss.z.emp.${stamp}@example.com` } }));
    orgZEmpUserId = orgZEmp?.id ?? null;
  } finally {
    // Partial teardown ONLY — org Z's Organization row cannot be deleted, and
    // that's correct, not a bug to work around. Every real login/create above
    // ran through the real HTTP + auth guard path (that's the point — this is
    // an end-to-end token, not a synthetic context injection), so each of
    // those writes generated a real audit_logs row with organizationId = orgZ.
    // audit_logs is append-only at the DATABASE level (db/immutability.sql,
    // trigger trg_audit_logs_append_only — DELETE is unconditionally blocked,
    // by design, for compliance), and Organization has a Restrict FK from
    // audit_logs. So once org Z has a real authenticated action against it,
    // its audit trail — and therefore the org row itself — is permanent.
    // Session/User/Employee/Role carry no such trigger, so those DO get
    // cleaned up below. In CI this is moot (the whole DB is thrown away with
    // the ephemeral Postgres container); a local dev DB will accumulate one
    // small, inert `__selfservice_probe_<timestamp>__` organization per run —
    // harmless, and identifiable by that name prefix if you ever want to see it.
    const userIds = [orgZAdminUser.id, ...(orgZEmpUserId ? [orgZEmpUserId] : [])];
    await base.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.employee.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await (prisma as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
