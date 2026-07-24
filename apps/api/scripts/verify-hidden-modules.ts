/**
 * Prove what feat/surface-hidden-modules actually still owns end-to-end over
 * HTTP, now that it's rebased onto develop (T1 shifts, T2 shift-aware
 * attendance, T3 device-push, and the org-scoping hotfix all landed first):
 *
 *   - GET /me/documents, GET /me/documents/:id/download — an employee sees
 *     and can download only their own uploaded documents.
 *   - GET /attendance with employeeId OMITTED — an org-wide day register,
 *     narrowed by departmentId. (Self-service /me/attendance itself is now
 *     fully covered by T2's verify-attendance-ui.ts — dropped here to avoid
 *     duplicate coverage of the same code path.)
 *   - Compliance CRUD (consent, data-subject requests, retention policies,
 *     breach incidents) — previously reachable only from Swagger, never
 *     proven end-to-end by any verify script until this branch gave it a
 *     frontend. Includes the SLA/ODPC-clock fields the UI reads.
 *   - Cross-tenant isolation for all of the above, applying the org-scoping
 *     hotfix's own test philosophy (both directions, not just "B can't see
 *     A" but "A is still correct after B exists").
 *
 *   cd apps/api && npx ts-node scripts/verify-hidden-modules.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const ATT_DATE = '2097-06-15';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface MyDocument { id: string; employeeId: string; filename: string }
interface AttendanceRow { id: string; employeeId: string; date: string; status: string }
interface Consent { id: string; purpose: string; lawfulBasis: string; active: boolean }
interface Dsr { id: string; requestType: string; status: string; overdue: boolean; daysUntilDue: number }
interface RetentionPolicy { id: string; recordType: string; retentionPeriodMonths: number }
interface Breach { id: string; description: string; status: string; odpc: { deadline: string; status: string; hoursRemaining: number } }

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

  async function provisionEmployeeLogin(
    employeeId: string, email: string, adminJson: Record<string, string>,
  ): Promise<string> {
    const created = await fetch(`${BASE}/employees/${employeeId}/create-login`, {
      method: 'POST', headers: adminJson, body: JSON.stringify({ email, roleName: 'Employee' }),
    });
    const { temporaryPassword } = (await created.json()) as { temporaryPassword?: string };
    if (!temporaryPassword) { console.log(`  FAIL  create-login for ${email}`); process.exit(1); }

    const tempToken = await login(email, temporaryPassword);
    const newPassword = 'HiddenModules123!';
    await fetch(`${BASE}/auth/change-password`, {
      method: 'POST', headers: { Authorization: `Bearer ${tempToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
    });
    return login(email, newPassword);
  }

  const adminToken = await login('admin@example.com', 'ChangeMe123!');
  const adminJson = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  async function makeEmployee(tag: string, jsonHeaders: Record<string, string>): Promise<string> {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({
        employeeNumber: `HM-${tag}-${stamp}`, firstName: 'HiddenModules', lastName: tag,
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const id = ((await r.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    return id;
  }

  const empA = await makeEmployee('A', adminJson);
  const empB = await makeEmployee('B', adminJson);
  const tokenA = await provisionEmployeeLogin(empA, `hm.a.${stamp}@example.com`, adminJson);
  const tokenB = await provisionEmployeeLogin(empB, `hm.b.${stamp}@example.com`, adminJson);
  const authA = { Authorization: `Bearer ${tokenA}` };
  const authB = { Authorization: `Bearer ${tokenB}` };

  // A dedicated department, with only A assigned to it — proves departmentId
  // actually narrows the org-wide register rather than being silently ignored.
  const deptRes = await fetch(`${BASE}/departments`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ name: `HiddenModules-${stamp}` }),
  });
  const deptId = ((await deptRes.json()) as { id?: string }).id;
  if (!deptId) { console.log('  FAIL  department create'); process.exit(1); }
  await fetch(`${BASE}/employees/${empA}`, {
    method: 'PATCH', headers: adminJson, body: JSON.stringify({ departmentId: deptId }),
  });

  // ── (a) employee documents self-service ──
  const fileBytes = Buffer.from(`hidden-modules test document ${stamp}`);
  const form = new FormData();
  form.append('file', new Blob([fileBytes], { type: 'application/pdf' }), 'id-copy.pdf');
  form.append('documentType', 'ID_COPY');
  const uploadRes = await fetch(`${BASE}/employees/${empA}/documents`, {
    method: 'POST', headers: adminAuth, body: form,
  });
  const uploaded = (await uploadRes.json()) as { id?: string };
  if (!uploaded.id) { console.log('  FAIL  document upload', JSON.stringify(uploaded)); process.exit(1); }

  const docsA = (await (await fetch(`${BASE}/me/documents`, { headers: authA })).json()) as MyDocument[];
  check('A\'s /me/documents includes the uploaded document', docsA.some((d) => d.id === uploaded.id), JSON.stringify(docsA));

  const docsB = (await (await fetch(`${BASE}/me/documents`, { headers: authB })).json()) as MyDocument[];
  check('B\'s /me/documents does NOT include A\'s document', !docsB.some((d) => d.id === uploaded.id), JSON.stringify(docsB));

  const downloadA = await fetch(`${BASE}/me/documents/${uploaded.id}/download`, { headers: authA });
  const downloadedBytes = Buffer.from(await downloadA.arrayBuffer());
  check('A downloading A\'s own document succeeds with the exact bytes uploaded',
    downloadA.status === 200 && downloadedBytes.equals(fileBytes), `status=${downloadA.status}`);

  const downloadCross = await fetch(`${BASE}/me/documents/${uploaded.id}/download`, { headers: authB });
  check('B downloading A\'s document is refused (404, not the file)', downloadCross.status === 404, `got ${downloadCross.status}`);

  // ── (b) HR org-wide day register (employeeId omitted) + departmentId filter ──
  await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: ATT_DATE, clockIn: `${ATT_DATE}T08:00:00.000Z`, status: 'PRESENT' }),
  });
  await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empB, date: ATT_DATE, status: 'LATE' }),
  });

  const registerAll = (await (await fetch(
    `${BASE}/attendance?from=${ATT_DATE}&to=${ATT_DATE}`, { headers: adminAuth },
  )).json()) as AttendanceRow[];
  check('org-wide register (no employeeId) includes A', registerAll.some((r) => r.employeeId === empA), JSON.stringify(registerAll));
  check('org-wide register (no employeeId) includes B', registerAll.some((r) => r.employeeId === empB), JSON.stringify(registerAll));

  const registerDept = (await (await fetch(
    `${BASE}/attendance?from=${ATT_DATE}&to=${ATT_DATE}&departmentId=${deptId}`, { headers: adminAuth },
  )).json()) as AttendanceRow[];
  check('departmentId filter includes A (in that department)', registerDept.some((r) => r.employeeId === empA), JSON.stringify(registerDept));
  check('departmentId filter excludes B (not in that department)', !registerDept.some((r) => r.employeeId === empB), JSON.stringify(registerDept));

  const registerOtherDept = (await (await fetch(
    `${BASE}/attendance?from=${ATT_DATE}&to=${ATT_DATE}&departmentId=00000000-0000-0000-0000-000000000000`, { headers: adminAuth },
  )).json()) as AttendanceRow[];
  check('departmentId filter with an unmatched department returns neither', registerOtherDept.length === 0, JSON.stringify(registerOtherDept));

  // ── (c) compliance CRUD — never proven end-to-end before this branch gave it a UI ──

  // consent
  const consentRes = await fetch(`${BASE}/employees/${empA}/consents`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ purpose: `Payroll processing ${stamp}`, lawfulBasis: 'CONTRACT' }),
  });
  const consent = (await consentRes.json()) as Consent;
  check('consent grant succeeds and is active', consent.active === true, JSON.stringify(consent));
  const consentsA = (await (await fetch(`${BASE}/employees/${empA}/consents`, { headers: adminAuth })).json()) as Consent[];
  check('consent list for A includes the new grant', consentsA.some((c) => c.id === consent.id), JSON.stringify(consentsA));
  const withdrawRes = await fetch(`${BASE}/consents/${consent.id}/withdraw`, { method: 'POST', headers: adminAuth });
  const withdrawn = (await withdrawRes.json()) as Consent;
  check('consent withdraw flips active to false', withdrawn.active === false, JSON.stringify(withdrawn));

  // data-subject requests (SLA fields)
  const dsrRes = await fetch(`${BASE}/employees/${empA}/data-subject-requests`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ requestType: 'ACCESS', notes: `Verify probe ${stamp}` }),
  });
  const dsr = (await dsrRes.json()) as Dsr;
  check('DSR create returns SLA fields (not overdue, daysUntilDue > 0 for a fresh request)',
    dsr.overdue === false && dsr.daysUntilDue > 0, JSON.stringify(dsr));
  const dsrList = (await (await fetch(`${BASE}/data-subject-requests?status=RECEIVED`, { headers: adminAuth })).json()) as Dsr[];
  check('DSR list filtered by status=RECEIVED includes the new request', dsrList.some((d) => d.id === dsr.id), JSON.stringify(dsrList));
  const dsrTransition = await fetch(`${BASE}/data-subject-requests/${dsr.id}`, {
    method: 'PATCH', headers: adminJson, body: JSON.stringify({ status: 'COMPLETED', notes: 'Resolved by verify script' }),
  });
  const dsrDone = (await dsrTransition.json()) as Dsr;
  check('DSR transitions to COMPLETED', dsrDone.status === 'COMPLETED', JSON.stringify(dsrDone));

  // retention policies (upsert: create then update the SAME recordType)
  const recordType = `VerifyProbe-${stamp}`;
  const policyCreate = await fetch(`${BASE}/retention-policies`, {
    method: 'PUT', headers: adminJson,
    body: JSON.stringify({ recordType, retentionPeriodMonths: 12 }),
  });
  const policy = (await policyCreate.json()) as RetentionPolicy;
  check('retention policy upsert creates a new policy', policy.retentionPeriodMonths === 12, JSON.stringify(policy));
  const policyUpdate = await fetch(`${BASE}/retention-policies`, {
    method: 'PUT', headers: adminJson,
    body: JSON.stringify({ recordType, retentionPeriodMonths: 24, legalBasisNote: 'Extended for audit' }),
  });
  const policyUpdated = (await policyUpdate.json()) as RetentionPolicy;
  check('retention policy upsert for the SAME recordType updates in place, not duplicates',
    policyUpdated.id === policy.id && policyUpdated.retentionPeriodMonths === 24, JSON.stringify(policyUpdated));
  const policyList = (await (await fetch(`${BASE}/retention-policies`, { headers: adminAuth })).json()) as RetentionPolicy[];
  check('retention policy list contains exactly one row for this recordType (upsert, not duplicate rows)',
    policyList.filter((p) => p.recordType === recordType).length === 1, JSON.stringify(policyList.filter((p) => p.recordType === recordType)));
  const policyDelete = await fetch(`${BASE}/retention-policies/${policy.id}`, { method: 'DELETE', headers: adminAuth });
  check('retention policy delete succeeds', policyDelete.status === 200, `got ${policyDelete.status}`);

  // breach incidents (ODPC 72h clock)
  const breachRes = await fetch(`${BASE}/breach-incidents`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ detectedAt: new Date().toISOString(), description: `Verify probe breach ${stamp}`, affectedEmployeeCount: 3 }),
  });
  const breach = (await breachRes.json()) as Breach;
  check('breach create returns an ODPC clock with hoursRemaining close to 72',
    breach.odpc.hoursRemaining > 71 && breach.odpc.hoursRemaining <= 72, JSON.stringify(breach.odpc));
  const breachList = (await (await fetch(`${BASE}/breach-incidents?status=OPEN`, { headers: adminAuth })).json()) as Breach[];
  check('breach list filtered by status=OPEN includes the new incident', breachList.some((b) => b.id === breach.id), JSON.stringify(breachList.map((b) => b.id)));
  const breachUpdate = await fetch(`${BASE}/breach-incidents/${breach.id}`, {
    method: 'PATCH', headers: adminJson, body: JSON.stringify({ status: 'CONTAINED' }),
  });
  const breachUpdated = (await breachUpdate.json()) as Breach;
  check('breach transitions to CONTAINED', breachUpdated.status === 'CONTAINED', JSON.stringify(breachUpdated));

  // ── (d) cross-tenant isolation (throwaway org Z), both directions — the hotfix's own test philosophy ──
  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  const orgZ = await base.organization.create({ data: { name: `__hidden_modules_probe_${stamp}__` } });
  const roleZ = await base.role.create({ data: { organizationId: orgZ.id, name: 'Admin', permissions: { all: true } } });
  const passwords = new PasswordService();
  const orgZAdminEmail = `hm.z.admin.${stamp}@example.com`;
  const orgZAdminPassword = 'OrgZAdmin123!';
  const orgZAdminUser = await base.user.create({
    data: {
      organizationId: orgZ.id, email: orgZAdminEmail,
      passwordHash: await passwords.hash(orgZAdminPassword),
      mustChangePassword: false, roleId: roleZ.id,
    },
  });

  try {
    const tokenZ = await login(orgZAdminEmail, orgZAdminPassword);
    const zJson = { Authorization: `Bearer ${tokenZ}`, 'Content-Type': 'application/json' };
    const zAuth = { Authorization: `Bearer ${tokenZ}` };

    const empZ = await makeEmployee('Z', zJson);
    // assertEmployee() 404s before the consent query ever runs — org A's
    // employeeId simply doesn't resolve under org Z's tenant-scoped read.
    const consentsZForARes = await fetch(`${BASE}/employees/${empA}/consents`, { headers: zAuth });
    check('org Z requesting org A\'s employee consents (by guessed id) gets 404, not the data',
      consentsZForARes.status === 404, `got ${consentsZForARes.status}`);

    const dsrZList = (await (await fetch(`${BASE}/data-subject-requests`, { headers: zAuth })).json()) as Dsr[];
    check('org Z\'s DSR list does not include org A\'s request', !dsrZList.some((d) => d.id === dsr.id), JSON.stringify(dsrZList.map((d) => d.id)));

    const retentionZList = (await (await fetch(`${BASE}/retention-policies`, { headers: zAuth })).json()) as RetentionPolicy[];
    check('org Z\'s retention policy list does not include org A\'s recordType', !retentionZList.some((p) => p.recordType === recordType), JSON.stringify(retentionZList));

    const breachZList = (await (await fetch(`${BASE}/breach-incidents`, { headers: zAuth })).json()) as Breach[];
    check('org Z\'s breach list does not include org A\'s incident', !breachZList.some((b) => b.id === breach.id), JSON.stringify(breachZList.map((b) => b.id)));

    const registerZ = (await (await fetch(`${BASE}/attendance?from=${ATT_DATE}&to=${ATT_DATE}`, { headers: zAuth })).json()) as AttendanceRow[];
    check('org Z\'s org-wide register does not include org A/B\'s attendance', !registerZ.some((r) => r.employeeId === empA || r.employeeId === empB), JSON.stringify(registerZ));

    // Bidirectional: org A's own compliance data is unaffected by org Z existing.
    const breachListAfter = (await (await fetch(`${BASE}/breach-incidents?status=CONTAINED`, { headers: adminAuth })).json()) as Breach[];
    check('org A\'s breach list still resolves correctly after org Z was created', breachListAfter.some((b) => b.id === breach.id), JSON.stringify(breachListAfter.map((b) => b.id)));

    await base.employee.deleteMany({ where: { id: empZ } }).catch(() => undefined);
  } finally {
    // Organization itself is never deleted once real auth activity (a
    // login, here) has touched it — see verify-self-service.ts /
    // verify-leave-requests.ts for the same rationale.
    await base.session.deleteMany({ where: { userId: orgZAdminUser.id } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await (prisma as any).$disconnect?.();
  }

  // ── cleanup — org A/B rows are fully removable (nothing here sits behind
  // an append-only trigger the way Organization/audit_logs do) ──
  const prisma2 = createPrismaClient();
  const base2 = baseClientOf(prisma2) as any;
  try {
    const users = await base2.user.findMany({
      where: { email: { in: [`hm.a.${stamp}@example.com`, `hm.b.${stamp}@example.com`] } },
      select: { id: true },
    });
    const userIds = users.map((u: { id: string }) => u.id);
    await base2.session.deleteMany({ where: { userId: { in: userIds } } });
    await base2.breachIncident.deleteMany({ where: { id: breach.id } });
    await base2.dataSubjectRequest.deleteMany({ where: { id: dsr.id } });
    await base2.consentRecord.deleteMany({ where: { employeeId: { in: [empA, empB] } } });
    await base2.attendanceRecord.deleteMany({ where: { employeeId: { in: [empA, empB] } } });
    await base2.employeeDocument.deleteMany({ where: { employeeId: { in: [empA, empB] } } });
    await base2.user.deleteMany({ where: { id: { in: userIds } } });
    await base2.employee.deleteMany({ where: { id: { in: [empA, empB] } } });
    await base2.department.deleteMany({ where: { id: deptId } });
  } catch (e) {
    console.log(`  (cleanup warning, non-fatal: ${(e as Error).message})`);
  } finally {
    await (prisma2 as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
