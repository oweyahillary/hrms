/**
 * Prove shift-aware attendance end-to-end over HTTP: derivation on upsert
 * (assigned shift, unassigned fallback to General, explicit-status
 * override, the grace boundary), ZK punch-event import (happy path,
 * night-shift midnight-crossing pairing, and every reject category),
 * /me/attendance self-scoping, and cross-tenant isolation.
 *
 *   cd apps/api && npx ts-node scripts/verify-attendance-ui.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Mirrors verify-shifts.ts / verify-self-service.ts's throwaway-second-org
 * pattern for tenant isolation; full cleanup otherwise.
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
// Far-future dates unused by any other verify-*.ts fixture.
const DATE_GENERAL = '2099-04-06'; // A's General-shift day
const DATE_UNASSIGNED = '2099-04-07'; // A's day with no assignment at all
const DATE_LEAVE = '2099-04-08'; // A's explicit-status day
const DATE_NIGHT = '2099-04-09'; // A's Night-shift day (crosses into 04-10)
const DATE_ZK = '2099-04-10'; // B's ZK punch-import day

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface ShiftDef { id: string; code: string; startTime: string; endTime: string; crossesMidnight: boolean }
interface AttendanceRow {
  id: string; employeeId: string; date: string; clockIn: string | null; clockOut: string | null;
  status: string; source: string; shiftCode: string | null; unassigned: boolean; lateMinutes: number;
}
interface ImportResult { imported: number; skipped: number; errors: Array<{ row: number; message: string }> }

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

  async function provisionEmployeeLogin(employeeId: string, email: string, adminJson: Record<string, string>): Promise<string> {
    const created = await fetch(`${BASE}/employees/${employeeId}/create-login`, {
      method: 'POST', headers: adminJson, body: JSON.stringify({ email, roleName: 'Employee' }),
    });
    const { temporaryPassword } = (await created.json()) as { temporaryPassword?: string };
    if (!temporaryPassword) { console.log(`  FAIL  create-login for ${email}`); process.exit(1); }
    const tempToken = await login(email, temporaryPassword);
    const newPassword = 'AttendanceVerify123!';
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
        employeeNumber: `ATT-${tag}-${stamp}`, firstName: 'AttendanceVerify', lastName: tag,
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const id = ((await r.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    return id;
  }

  const empA = await makeEmployee('A');
  const empB = await makeEmployee('B');
  const tokenA = await provisionEmployeeLogin(empA, `att.a.${stamp}@example.com`, adminJson);
  const tokenB = await provisionEmployeeLogin(empB, `att.b.${stamp}@example.com`, adminJson);
  const authA = { Authorization: `Bearer ${tokenA}` };
  const authB = { Authorization: `Bearer ${tokenB}` };

  // Seeded defaults (scripts/seed.ts): General 08:00, Night 22:00 crossesMidnight.
  const allShifts = (await (await fetch(`${BASE}/shift-definitions`, { headers: adminAuth })).json()) as ShiftDef[];
  const general = allShifts.find((s) => s.code === 'G');
  const night = allShifts.find((s) => s.code === 'N');
  check('seeded General (G) shift exists', !!general, JSON.stringify(allShifts.map((s) => s.code)));
  check('seeded Night (N) shift exists and crosses midnight', !!night && night.crossesMidnight, JSON.stringify(night));
  if (!general || !night) { console.log('  FAIL  cannot continue without seeded shifts'); process.exit(1); }

  const graceRes = await fetch(`${BASE}/organization/attendance-settings`, { headers: adminAuth });
  const grace = ((await graceRes.json()) as { lateGraceMinutes: number }).lateGraceMinutes;
  check('attendance-settings returns a grace window', typeof grace === 'number', JSON.stringify(await graceRes.json().catch(() => null)));

  // ── (a) derivation: assigned shift, within grace -> PRESENT ──
  await fetch(`${BASE}/shifts/roster`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_GENERAL, shiftDefinitionId: general.id }),
  });
  const onTimeRes = await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_GENERAL, clockIn: `${DATE_GENERAL}T08:05:00.000Z` }),
  });
  const onTime = (await onTimeRes.json()) as AttendanceRow;
  check('clockIn shortly after shift start derives PRESENT', onTime.status === 'PRESENT', JSON.stringify(onTime));
  check('the response carries the assigned shift code', onTime.shiftCode === 'G', onTime.shiftCode ?? 'null');
  check('an assigned day is not flagged unassigned', onTime.unassigned === false, JSON.stringify(onTime));

  // ── grace boundary: exactly at start+grace is PRESENT, one minute past is LATE ──
  const [gh, gm] = general.startTime.split(':').map(Number);
  const boundary = new Date(Date.UTC(2099, 3, 6, gh, gm)); // DATE_GENERAL = 2099-04-06
  boundary.setUTCMinutes(boundary.getUTCMinutes() + grace);
  const atBoundaryRes = await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empB, date: DATE_GENERAL, clockIn: boundary.toISOString() }),
  });
  const atBoundary = (await atBoundaryRes.json()) as AttendanceRow;
  check('clockIn exactly at the grace boundary is PRESENT', atBoundary.status === 'PRESENT', JSON.stringify(atBoundary));

  const pastBoundary = new Date(boundary.getTime() + 60_000);
  const lateRes = await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empB, date: DATE_GENERAL, clockIn: pastBoundary.toISOString() }),
  });
  const late = (await lateRes.json()) as AttendanceRow;
  check('clockIn one minute past the grace boundary is LATE', late.status === 'LATE', JSON.stringify(late));
  // lateMinutes measures minutes past the SHIFT START, not past the grace
  // deadline (see derive-status.ts's lateMinutes() docstring) — clockIn here
  // is grace+1 minutes past start, so the figure is grace+1, not 1.
  check('lateMinutes reports minutes past shift start, not past the grace deadline', late.lateMinutes === grace + 1, `expected ${grace + 1}, got ${late.lateMinutes}`);

  // ── (b) unassigned day falls back to General for derivation, flagged unassigned ──
  const unassignedRes = await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_UNASSIGNED, clockIn: `${DATE_UNASSIGNED}T08:05:00.000Z` }),
  });
  const unassigned = (await unassignedRes.json()) as AttendanceRow;
  check('an unassigned day still derives a status (falls back to General)', unassigned.status === 'PRESENT', JSON.stringify(unassigned));
  check('an unassigned day is flagged unassigned:true', unassigned.unassigned === true, JSON.stringify(unassigned));
  check('an unassigned day carries no shiftCode (it was never really assigned)', unassigned.shiftCode === null, unassigned.shiftCode ?? 'null');

  // ── (c) explicit status always wins over derivation ──
  const explicitRes = await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    // A clockIn that would derive LATE, but an explicit ON_LEAVE should win outright.
    body: JSON.stringify({ employeeId: empA, date: DATE_LEAVE, clockIn: `${DATE_LEAVE}T11:00:00.000Z`, status: 'ON_LEAVE' }),
  });
  const explicit = (await explicitRes.json()) as AttendanceRow;
  check('an explicit status overrides what derivation would have produced', explicit.status === 'ON_LEAVE', JSON.stringify(explicit));

  // ── (d) GET /attendance for one employee returns the enriched fields ──
  const listA = (await (await fetch(
    `${BASE}/attendance?employeeId=${empA}&from=${DATE_GENERAL}&to=${DATE_LEAVE}`, { headers: adminAuth },
  )).json()) as AttendanceRow[];
  check('GET /attendance for A returns all three of A\'s days', listA.length === 3, JSON.stringify(listA.map((r) => r.date)));

  // ── (e) org-wide day register (employeeId omitted) still includes shift enrichment ──
  const registerRes = (await (await fetch(
    `${BASE}/attendance?from=${DATE_GENERAL}&to=${DATE_GENERAL}`, { headers: adminAuth },
  )).json()) as AttendanceRow[];
  check('org-wide register (no employeeId) includes both A and B for DATE_GENERAL',
    registerRes.some((r) => r.employeeId === empA) && registerRes.some((r) => r.employeeId === empB),
    JSON.stringify(registerRes.map((r) => r.employeeId)));

  // ── (f) ZK punch-event import: happy path + night-shift midnight crossing + rejects ──
  await fetch(`${BASE}/shifts/roster`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_NIGHT, shiftDefinitionId: night.id }),
  });

  const zkCsv = [
    'PIN,Time',
    `ATT-B-${stamp},${DATE_ZK} 08:02:00`, // B, valid clock-in
    `ATT-B-${stamp},${DATE_ZK} 17:05:00`, // B, valid clock-out (same day)
    `ATT-A-${stamp},${DATE_NIGHT} 22:10:00`, // A, night shift clock-in
    `ATT-A-${stamp},2099-04-10 06:15:00`, // A, night shift clock-out (NEXT calendar day)
    ',2099-04-10 09:00:00', // missing PIN
    `ATT-B-${stamp},not-a-timestamp`, // unreadable time
  ].join('\n');
  const zkForm = new FormData();
  zkForm.append('file', new Blob([zkCsv], { type: 'text/csv' }), 'zk-export.csv');
  const zkImportRes = await fetch(`${BASE}/attendance/import?preset=ZKTECO`, { method: 'POST', headers: adminAuth, body: zkForm });
  const zkImport = (await zkImportRes.json()) as ImportResult;
  check('ZK import: 2 day-records imported (B\'s pair + A\'s night-shift pair)', zkImport.imported === 2, JSON.stringify(zkImport));
  check('ZK import: 2 rows skipped (missing PIN, unreadable time)', zkImport.skipped === 2, JSON.stringify(zkImport));
  check('ZK import: missing-PIN reject present', zkImport.errors.some((e) => e.message.includes('missing employee id')), JSON.stringify(zkImport.errors));
  check('ZK import: unreadable-time reject present', zkImport.errors.some((e) => e.message.includes('unreadable punch time')), JSON.stringify(zkImport.errors));

  const bAfterZk = (await (await fetch(`${BASE}/attendance?employeeId=${empB}&from=${DATE_ZK}&to=${DATE_ZK}`, { headers: adminAuth })).json()) as AttendanceRow[];
  check('B\'s ZK-imported day has both clockIn and clockOut paired correctly',
    bAfterZk.length === 1
      && bAfterZk[0].clockIn?.startsWith(`${DATE_ZK}T08:02`) === true
      && bAfterZk[0].clockOut?.startsWith(`${DATE_ZK}T17:05`) === true,
    JSON.stringify(bAfterZk));

  const aAfterZk = (await (await fetch(`${BASE}/attendance?employeeId=${empA}&from=${DATE_NIGHT}&to=${DATE_NIGHT}`, { headers: adminAuth })).json()) as AttendanceRow[];
  check('A\'s night-shift punches (22:10 + next-day 06:15) group into ONE record dated the shift\'s START day',
    aAfterZk.length === 1, JSON.stringify(aAfterZk));
  check('that record\'s clockOut is on the FOLLOWING calendar day (correctly not truncated to DATE_NIGHT)',
    aAfterZk[0]?.clockOut?.startsWith('2099-04-10T06:15') === true, JSON.stringify(aAfterZk[0]));
  check('the night-shift record derives PRESENT (22:10 is within grace of a 22:00 start)',
    aAfterZk[0]?.status === 'PRESENT', JSON.stringify(aAfterZk[0]));

  // ── (g) /me/attendance self-scoping ──
  const myAttA = (await (await fetch(`${BASE}/me/attendance?from=${DATE_GENERAL}&to=${DATE_ZK}`, { headers: authA })).json()) as AttendanceRow[];
  check('A\'s /me/attendance contains only A\'s own employeeId', myAttA.every((r) => r.employeeId === empA), JSON.stringify(myAttA));
  check('A\'s /me/attendance includes A\'s night-shift day', myAttA.some((r) => r.date.slice(0, 10) === DATE_NIGHT), JSON.stringify(myAttA));

  const myAttB = (await (await fetch(`${BASE}/me/attendance?from=${DATE_GENERAL}&to=${DATE_ZK}`, { headers: authB })).json()) as AttendanceRow[];
  check('B\'s /me/attendance does NOT include any of A\'s records', !myAttB.some((r) => r.employeeId === empA), JSON.stringify(myAttB));

  // ── (h) cross-tenant isolation (throwaway org Z) ──
  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  const orgZ = await base.organization.create({ data: { name: `__attendance_probe_${stamp}__` } });
  const roleZ = await base.role.create({ data: { organizationId: orgZ.id, name: 'Admin', permissions: { all: true } } });
  const passwords = new PasswordService();
  const orgZAdminEmail = `att.z.admin.${stamp}@example.com`;
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
    const zAdminAuth = { Authorization: `Bearer ${tokenZAdmin}` };

    const empZRes = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: zAdminJson,
      body: JSON.stringify({
        employeeNumber: `ATT-Z-${stamp}`, firstName: 'AttendanceVerify', lastName: 'Z',
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const empZ = ((await empZRes.json()) as { id?: string }).id;
    if (!empZ) { console.log('  FAIL  org-Z employee create'); process.exit(1); }
    const tokenZ = await provisionEmployeeLogin(empZ, `att.z.emp.${stamp}@example.com`, zAdminJson);
    const authZ = { Authorization: `Bearer ${tokenZ}` };

    const myAttZ = (await (await fetch(`${BASE}/me/attendance?from=${DATE_GENERAL}&to=${DATE_ZK}`, { headers: authZ })).json()) as AttendanceRow[];
    check('org-Z\'s /me/attendance is empty (no org-A data leaks through)', Array.isArray(myAttZ) && myAttZ.length === 0, JSON.stringify(myAttZ));

    const orgZRegister = (await (await fetch(
      `${BASE}/attendance?from=${DATE_GENERAL}&to=${DATE_ZK}`, { headers: zAdminAuth },
    )).json()) as AttendanceRow[];
    check('org-Z admin\'s org-wide register contains none of org A\'s employees',
      !orgZRegister.some((r) => r.employeeId === empA || r.employeeId === empB), JSON.stringify(orgZRegister));

    const orgZEmp = await base.user.findFirst({ where: { organizationId: orgZ.id, email: `att.z.emp.${stamp}@example.com` } });
    orgZEmpUserId = orgZEmp?.id ?? null;
  } finally {
    // See verify-self-service.ts's file header for why Organization can never
    // be deleted once real auth activity has touched it. Everything else
    // this script created has no such trigger and is fully cleaned up.
    const userIds = [orgZAdminUser.id, ...(orgZEmpUserId ? [orgZEmpUserId] : [])];
    await base.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await base.attendanceRecord.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.shiftAssignment.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.employee.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);

    // Org A/B cleanup (fully removable — nothing here sits behind an
    // append-only trigger the way Organization/audit_logs do).
    await base.attendanceRecord.deleteMany({ where: { employeeId: { in: [empA, empB] } } }).catch(() => undefined);
    await base.shiftAssignment.deleteMany({ where: { employeeId: { in: [empA, empB] } } }).catch(() => undefined);
    const orgAUsers = await base.user.findMany({
      where: { email: { in: [`att.a.${stamp}@example.com`, `att.b.${stamp}@example.com`] } }, select: { id: true },
    });
    await base.session.deleteMany({ where: { userId: { in: orgAUsers.map((u: { id: string }) => u.id) } } }).catch(() => undefined);
    await base.user.deleteMany({ where: { id: { in: orgAUsers.map((u: { id: string }) => u.id) } } }).catch(() => undefined);
    await base.employee.deleteMany({ where: { id: { in: [empA, empB] } } }).catch(() => undefined);
    await (prisma as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
