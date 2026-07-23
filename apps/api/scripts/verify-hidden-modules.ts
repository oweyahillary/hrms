/**
 * Prove the three endpoints added for the compliance/documents/attendance
 * frontend surfacing work (feat/surface-hidden-modules) end-to-end over HTTP:
 *
 *   - GET /me/documents, GET /me/documents/:id/download — an employee sees
 *     and can download only their own uploaded documents.
 *   - GET /me/attendance — an employee sees only their own attendance.
 *   - GET /attendance with employeeId OMITTED — an org-wide day register,
 *     optionally narrowed by the new departmentId filter.
 *
 *   cd apps/api && npx ts-node scripts/verify-hidden-modules.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Everything created here lives in the seeded org (not a throwaway second
 * org — unlike verify-self-service.ts, nothing here needs cross-tenant
 * proof, since the org-wide register and self-service resolution both reuse
 * query paths already generically covered by verify-tenant-scope.ts and
 * verify-self-service.ts). Full cleanup at the end: none of the rows this
 * script creates (Employee, User, Session, Department, AttendanceRecord,
 * EmployeeDocument) sit behind audit_logs' append-only trigger the way
 * Organization does, so — unlike those two scripts — there is nothing this
 * one has to leave behind.
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const ATT_DATE = '2097-06-15';
const ATT_FROM = '2097-06-01';
const ATT_TO = '2097-06-30';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface MyDocument { id: string; employeeId: string; filename: string }
interface MyAttendanceRecord { id: string; employeeId: string; date: string; status: string }
interface AttendanceRow { id: string; employeeId: string; date: string; status: string }

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

  async function makeEmployee(tag: string): Promise<string> {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({
        employeeNumber: `HM-${tag}-${stamp}`, firstName: 'HiddenModules', lastName: tag,
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const id = ((await r.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    return id;
  }

  const empA = await makeEmployee('A');
  const empB = await makeEmployee('B');
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

  // ── (b) attendance self-service ──
  await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: ATT_DATE, clockIn: `${ATT_DATE}T08:00:00.000Z`, status: 'PRESENT' }),
  });
  await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empB, date: ATT_DATE, status: 'LATE' }),
  });

  const attA = (await (await fetch(`${BASE}/me/attendance?from=${ATT_FROM}&to=${ATT_TO}`, { headers: authA })).json()) as MyAttendanceRecord[];
  check('A\'s /me/attendance includes A\'s own record for the test date',
    attA.some((r) => r.date.slice(0, 10) === ATT_DATE && r.status === 'PRESENT'), JSON.stringify(attA));
  check('A\'s /me/attendance contains only A\'s own employeeId',
    attA.every((r) => r.employeeId === empA), JSON.stringify(attA));

  const attB = (await (await fetch(`${BASE}/me/attendance?from=${ATT_FROM}&to=${ATT_TO}`, { headers: authB })).json()) as MyAttendanceRecord[];
  check('B\'s /me/attendance does NOT include A\'s record',
    !attB.some((r) => r.date.slice(0, 10) === ATT_DATE && r.status === 'PRESENT'), JSON.stringify(attB));

  // ── (c) HR org-wide day register (employeeId omitted) ──
  const registerAll = (await (await fetch(
    `${BASE}/attendance?from=${ATT_DATE}&to=${ATT_DATE}`, { headers: adminAuth },
  )).json()) as AttendanceRow[];
  check('Org-wide register (no employeeId) includes A', registerAll.some((r) => r.employeeId === empA), JSON.stringify(registerAll));
  check('Org-wide register (no employeeId) includes B', registerAll.some((r) => r.employeeId === empB), JSON.stringify(registerAll));

  const registerDept = (await (await fetch(
    `${BASE}/attendance?from=${ATT_DATE}&to=${ATT_DATE}&departmentId=${deptId}`, { headers: adminAuth },
  )).json()) as AttendanceRow[];
  check('departmentId filter includes A (in that department)', registerDept.some((r) => r.employeeId === empA), JSON.stringify(registerDept));
  check('departmentId filter excludes B (not in that department)', !registerDept.some((r) => r.employeeId === empB), JSON.stringify(registerDept));

  const registerOtherDept = (await (await fetch(
    `${BASE}/attendance?from=${ATT_DATE}&to=${ATT_DATE}&departmentId=00000000-0000-0000-0000-000000000000`, { headers: adminAuth },
  )).json()) as AttendanceRow[];
  check('departmentId filter with an unmatched department returns neither', registerOtherDept.length === 0, JSON.stringify(registerOtherDept));

  // ── cleanup — everything here can be fully removed (see file header) ──
  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  try {
    const users = await base.user.findMany({
      where: { email: { in: [`hm.a.${stamp}@example.com`, `hm.b.${stamp}@example.com`] } },
      select: { id: true },
    });
    const userIds = users.map((u: { id: string }) => u.id);
    await base.session.deleteMany({ where: { userId: { in: userIds } } });
    await base.attendanceRecord.deleteMany({ where: { employeeId: { in: [empA, empB] } } });
    await base.employeeDocument.deleteMany({ where: { employeeId: { in: [empA, empB] } } });
    await base.user.deleteMany({ where: { id: { in: userIds } } });
    await base.employee.deleteMany({ where: { id: { in: [empA, empB] } } });
    await base.department.deleteMany({ where: { id: deptId } });
  } catch (e) {
    console.log(`  (cleanup warning, non-fatal: ${(e as Error).message})`);
  } finally {
    await (prisma as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
