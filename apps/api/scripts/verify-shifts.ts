/**
 * Prove shift scheduling end-to-end over HTTP: shift-definition CRUD
 * (including the delete-blocked-while-referenced / deactivate-instead
 * path), roster upsert with real (employeeId, date) uniqueness, CSV AND
 * XLSX import (happy path + every reject category: unknown employee,
 * unknown/inactive shift code, duplicate row in file, leave conflict),
 * /me/shifts self-scoping, and cross-tenant isolation.
 *
 *   cd apps/api && npx ts-node scripts/verify-shifts.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Mirrors verify-self-service.ts's throwaway-second-org pattern for the
 * tenant-isolation checks; full cleanup otherwise (none of the rows this
 * script creates sit behind the audit_logs append-only trigger the way
 * Organization does).
 */
import 'dotenv/config';
import ExcelJS from 'exceljs';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
// Far-future dates unused by any other verify-*.ts fixture.
const DATE_1 = '2098-03-02'; // normal roster slot (shifts apply on any calendar day, including weekends)
const DATE_LEAVE = '2098-03-04'; // covered by A's approved leave
const DATE_IMPORT = '2098-03-05'; // used by the CSV/XLSX import happy-path row

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface ShiftDef { id: string; code: string; name: string; active: boolean }
interface RosterRow { id: string; employeeId: string; date: string; shiftDefinitionId: string; shiftCode: string }
interface ImportResult { imported: number; skipped: number; errors: Array<{ row: number; message: string }> }

async function buildXlsxBuffer(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Roster');
  rows.forEach((r) => ws.addRow(r));
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

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
    const newPassword = 'ShiftsVerify123!';
    await fetch(`${BASE}/auth/change-password`, {
      method: 'POST', headers: { Authorization: `Bearer ${tempToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
    });
    return login(email, newPassword);
  }

  const adminToken = await login('admin@example.com', 'ChangeMe123!');
  const adminJson = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;

  async function makeEmployee(tag: string): Promise<string> {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({
        employeeNumber: `SHIFT-${tag}-${stamp}`, firstName: 'ShiftVerify', lastName: tag,
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const id = ((await r.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    return id;
  }

  const empA = await makeEmployee('A');
  const empB = await makeEmployee('B');
  const tokenA = await provisionEmployeeLogin(empA, `shift.a.${stamp}@example.com`, adminJson);
  const tokenB = await provisionEmployeeLogin(empB, `shift.b.${stamp}@example.com`, adminJson);
  const authA = { Authorization: `Bearer ${tokenA}` };
  const authB = { Authorization: `Bearer ${tokenB}` };

  // ── (a) shift-definition CRUD ──
  const code = `Z${stamp.toString().slice(-6)}`;
  const createRes = await fetch(`${BASE}/shift-definitions`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ code, name: 'Verify Shift', startTime: '09:00', endTime: '18:00', breakMinutes: 45 }),
  });
  const shift = (await createRes.json()) as ShiftDef;
  check('shift definition create succeeds', createRes.status === 201 || createRes.status === 200, `status=${createRes.status}`);
  check('created shift has the requested code', shift.code === code.toUpperCase(), shift.code);

  const dupRes = await fetch(`${BASE}/shift-definitions`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ code, name: 'Duplicate', startTime: '09:00', endTime: '18:00' }),
  });
  check('creating a second shift with the same code is refused', dupRes.status === 409, `status=${dupRes.status}`);

  const listRes = (await (await fetch(`${BASE}/shift-definitions`, { headers: adminAuth })).json()) as ShiftDef[];
  check('list includes the new active shift', listRes.some((s) => s.id === shift.id), JSON.stringify(listRes.map((s) => s.code)));

  // Second definition, used only for the leave-conflict / import tests below.
  const importCodeRes = await fetch(`${BASE}/shift-definitions`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ code: `M${stamp.toString().slice(-6)}`, name: 'Verify Morning', startTime: '06:00', endTime: '14:00' }),
  });
  const importShift = (await importCodeRes.json()) as ShiftDef;

  // ── (b) roster upsert + real (employeeId, date) uniqueness ──
  const upsert1 = await fetch(`${BASE}/shifts/roster`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_1, shiftDefinitionId: shift.id }),
  });
  const entry1 = (await upsert1.json()) as { id: string };
  check('first roster upsert for A on DATE_1 succeeds', upsert1.status === 201 || upsert1.status === 200, `status=${upsert1.status}`);

  const upsert2 = await fetch(`${BASE}/shifts/roster`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_1, shiftDefinitionId: importShift.id }),
  });
  const entry2 = (await upsert2.json()) as { id: string };
  check('second upsert for the SAME employee+date updates in place, not duplicates', entry2.id === entry1.id, `${entry1.id} vs ${entry2.id}`);

  const rosterAfterUpsert = (await (await fetch(
    `${BASE}/shifts/roster?from=${DATE_1}&to=${DATE_1}`, { headers: adminAuth },
  )).json()) as RosterRow[];
  check('exactly one roster row exists for A on DATE_1', rosterAfterUpsert.filter((r) => r.employeeId === empA).length === 1, JSON.stringify(rosterAfterUpsert));
  check('that row now carries the SECOND shift (the update won)', rosterAfterUpsert.find((r) => r.employeeId === empA)?.shiftDefinitionId === importShift.id, '');

  // ── (c) leave conflict blocks both single upsert and import ──
  // The fixture needs an APPROVED LeaveRequest row — nothing about the
  // approval WORKFLOW itself (already covered exhaustively by
  // verify-leave-approvers.ts / verify-leave-requests.ts). Written directly
  // via Prisma rather than through POST + approve over HTTP: this sidesteps
  // a real pre-existing bug found while building this script —
  // LeaveRequestsService.approvalPolicy() reads the org's leave-approval
  // policy via `organization.findFirst()` with NO where clause, so once
  // more than one Organization row exists in the database (which every
  // verify-*.ts script's own throwaway-org tenant-isolation check adds one
  // of — by the time this script runs last in ci.yml, several already
  // exist) it can silently resolve a DIFFERENT org's policy than the
  // caller's own, causing "No approver could be determined" even after
  // correctly setting allowEmployeeChosenApprovers on the right org. Out of
  // scope to fix on a shift-scheduling branch (shared leave-approval logic,
  // needs its own regression pass) — flagged in the summary for the
  // architect. shift-roster.service.ts's leaveConflict() only ever reads
  // LeaveRequest.status directly, never the approval-step chain, so this
  // fixture doesn't need the workflow at all.
  const leaveTypeRes = await fetch(`${BASE}/leave-types`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ name: `ShiftVerifyLeave-${stamp}` }),
  });
  const leaveTypeId = ((await leaveTypeRes.json()) as { id?: string }).id;
  // base bypasses the tenant extension entirely (that's its purpose), so
  // organizationId must be supplied by hand here — the extension is what
  // normally injects it on a scoped create.
  const empARow = await base.employee.findFirst({ where: { id: empA }, select: { organizationId: true } });
  const leaveReq = await base.leaveRequest.create({
    data: {
      organizationId: empARow.organizationId, employeeId: empA, leaveTypeId,
      startDate: new Date(`${DATE_LEAVE}T00:00:00.000Z`), endDate: new Date(`${DATE_LEAVE}T00:00:00.000Z`),
      daysRequested: 1, status: 'APPROVED', reason: 'verify fixture',
    },
  });
  check('the fixture approved leave request is created', !!leaveReq?.id, JSON.stringify(leaveReq));
  const leaveReqId: string = leaveReq.id;

  const conflictRes = await fetch(`${BASE}/shifts/roster`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_LEAVE, shiftDefinitionId: shift.id }),
  });
  check('assigning a shift on an approved-leave date is refused', conflictRes.status === 400, `status=${conflictRes.status}`);

  // ── (d) CSV import: 1 valid + unknown employee + unknown code + duplicate + leave conflict ──
  // Each reject row uses a distinct (employeeNumber, date) key from every
  // other row EXCEPT the one deliberately testing the duplicate-in-file
  // check — dedup runs before resolution, so two rows sharing a key as a
  // side effect would mask whichever check they were meant to exercise.
  const csv = [
    'employeeNumber,date,shiftCode',
    `SHIFT-B-${stamp},${DATE_IMPORT},${importShift.code}`, // valid
    `SHIFT-B-${stamp},${DATE_IMPORT},${importShift.code}`, // duplicate of the row above (same employeeNumber+date)
    `SHIFT-NOPE-${stamp},${DATE_IMPORT},${importShift.code}`, // unknown employee
    `SHIFT-A-${stamp},${DATE_IMPORT},NOPE${stamp}`, // unknown shift code (distinct key: employee A, not B)
    `SHIFT-A-${stamp},${DATE_LEAVE},${importShift.code}`, // leave conflict (distinct key: different date)
  ].join('\n');
  const csvForm = new FormData();
  csvForm.append('file', new Blob([csv], { type: 'text/csv' }), 'roster.csv');
  const csvImportRes = await fetch(`${BASE}/shifts/roster/import?format=csv`, { method: 'POST', headers: adminAuth, body: csvForm });
  const csvImport = (await csvImportRes.json()) as ImportResult;
  check('CSV import: exactly 1 row imported', csvImport.imported === 1, JSON.stringify(csvImport));
  check('CSV import: exactly 4 rows skipped', csvImport.skipped === 4, JSON.stringify(csvImport));
  check('CSV import: duplicate-in-file reject present', csvImport.errors.some((e) => e.message.includes('duplicate')), JSON.stringify(csvImport.errors));
  check('CSV import: unknown employeeNumber reject present', csvImport.errors.some((e) => e.message.includes('unknown employeeNumber')), JSON.stringify(csvImport.errors));
  check('CSV import: unknown shiftCode reject present', csvImport.errors.some((e) => e.message.includes('unknown shiftCode')), JSON.stringify(csvImport.errors));
  check('CSV import: leave-conflict reject present', csvImport.errors.some((e) => e.message.toLowerCase().includes('leave')), JSON.stringify(csvImport.errors));

  const rosterAfterCsv = (await (await fetch(
    `${BASE}/shifts/roster?from=${DATE_IMPORT}&to=${DATE_IMPORT}`, { headers: adminAuth },
  )).json()) as RosterRow[];
  check('the one valid CSV row actually landed for B', rosterAfterCsv.some((r) => r.employeeId === empB), JSON.stringify(rosterAfterCsv));

  // ── (e) XLSX import happy path — same validator, different reader ──
  const DATE_XLSX = '2098-03-06';
  const xlsxBuffer = await buildXlsxBuffer([
    ['employeeNumber', 'date', 'shiftCode'],
    [`SHIFT-B-${stamp}`, DATE_XLSX, importShift.code],
  ]);
  const xlsxForm = new FormData();
  xlsxForm.append('file', new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'roster.xlsx');
  const xlsxImportRes = await fetch(`${BASE}/shifts/roster/import`, { method: 'POST', headers: adminAuth, body: xlsxForm });
  const xlsxImport = (await xlsxImportRes.json()) as ImportResult;
  check('XLSX import (format auto-detected from filename): 1 row imported', xlsxImport.imported === 1, JSON.stringify(xlsxImport));

  // ── (f) delete-blocked-while-referenced, then deactivate, then inactive-shift rejection ──
  const deleteBlockedRes = await fetch(`${BASE}/shift-definitions/${importShift.id}`, { method: 'DELETE', headers: adminAuth });
  check('deleting a referenced shift definition is refused (409)', deleteBlockedRes.status === 409, `status=${deleteBlockedRes.status}`);

  const deactivateRes = await fetch(`${BASE}/shift-definitions/${importShift.id}`, {
    method: 'PATCH', headers: adminJson, body: JSON.stringify({ active: false }),
  });
  check('deactivating (instead of deleting) succeeds', deactivateRes.status === 200, `status=${deactivateRes.status}`);

  const assignInactiveRes = await fetch(`${BASE}/shifts/roster`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empB, date: '2098-03-07', shiftDefinitionId: importShift.id }),
  });
  check('assigning a now-inactive shift is refused', assignInactiveRes.status === 400, `status=${assignInactiveRes.status}`);

  const unreferencedDeleteRes = await fetch(`${BASE}/shift-definitions/${shift.id}`, { method: 'DELETE', headers: adminAuth });
  // shift.id (the first definition) is ALSO referenced (A's DATE_1 row was overwritten off it, but check first: was it ever
  // left pointing at `shift`? No — DATE_1 now points at importShift. shift.id may be unreferenced.
  check('deleting an unreferenced shift definition succeeds', unreferencedDeleteRes.status === 200, `status=${unreferencedDeleteRes.status}`);

  // ── (g) /me/shifts self-scoping ──
  const myShiftsA = (await (await fetch(`${BASE}/me/shifts?from=${DATE_1}&to=${DATE_IMPORT}`, { headers: authA })).json()) as RosterRow[];
  check('A\'s /me/shifts contains only A\'s own employeeId', myShiftsA.every((r) => r.employeeId === empA), JSON.stringify(myShiftsA));
  check('A\'s /me/shifts includes A\'s DATE_1 assignment', myShiftsA.some((r) => r.date.slice(0, 10) === DATE_1), JSON.stringify(myShiftsA));

  const myShiftsB = (await (await fetch(`${BASE}/me/shifts?from=${DATE_1}&to=${DATE_IMPORT}`, { headers: authB })).json()) as RosterRow[];
  check('B\'s /me/shifts does NOT include A\'s DATE_1 assignment', !myShiftsB.some((r) => r.employeeId === empA), JSON.stringify(myShiftsB));

  // ── (h) cross-tenant isolation (throwaway org Z, mirrors verify-self-service.ts) ──
  const orgZ = await base.organization.create({ data: { name: `__shifts_probe_${stamp}__` } });
  const roleZ = await base.role.create({ data: { organizationId: orgZ.id, name: 'Admin', permissions: { all: true } } });
  const passwords = new PasswordService();
  const orgZAdminEmail = `shift.z.admin.${stamp}@example.com`;
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
        employeeNumber: `SHIFT-Z-${stamp}`, firstName: 'ShiftVerify', lastName: 'Z',
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const empZ = ((await empZRes.json()) as { id?: string }).id;
    if (!empZ) { console.log('  FAIL  org-Z employee create'); process.exit(1); }
    const tokenZ = await provisionEmployeeLogin(empZ, `shift.z.emp.${stamp}@example.com`, zAdminJson);
    const authZ = { Authorization: `Bearer ${tokenZ}` };

    const myShiftsZ = (await (await fetch(`${BASE}/me/shifts?from=${DATE_1}&to=${DATE_IMPORT}`, { headers: authZ })).json()) as RosterRow[];
    check('org-Z\'s /me/shifts is empty (no org-A data leaks through)', Array.isArray(myShiftsZ) && myShiftsZ.length === 0, JSON.stringify(myShiftsZ));

    const orgZRoster = (await (await fetch(
      `${BASE}/shifts/roster?from=${DATE_1}&to=${DATE_IMPORT}`, { headers: zAdminAuth },
    )).json()) as RosterRow[];
    check('org-Z admin\'s roster view contains none of org A\'s employees',
      !orgZRoster.some((r) => r.employeeId === empA || r.employeeId === empB), JSON.stringify(orgZRoster));

    const crossOrgDefRes = await fetch(`${BASE}/shift-definitions/${importShift.id}`, { headers: zAdminAuth });
    check('org-Z admin requesting org-A\'s known shift-definition id by GUESS gets 404 (cross-tenant, not the record)',
      crossOrgDefRes.status === 404, `got ${crossOrgDefRes.status}`);

    const orgZEmp = await base.user.findFirst({ where: { organizationId: orgZ.id, email: `shift.z.emp.${stamp}@example.com` } });
    orgZEmpUserId = orgZEmp?.id ?? null;
  } finally {
    // See verify-self-service.ts's file header for why the Organization row
    // itself can never be deleted once real auth activity has touched it —
    // audit_logs is append-only with a Restrict FK from Organization. Every
    // other row this script created (including org Z's) has no such trigger
    // and is fully cleaned up.
    const userIds = [orgZAdminUser.id, ...(orgZEmpUserId ? [orgZEmpUserId] : [])];
    await base.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await base.shiftAssignment.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.employee.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);

    // Org A cleanup (fully removable — see this file's header). The
    // leaveBalance delete is defensive/harmless-if-empty: the leave-conflict
    // fixture writes status: 'APPROVED' directly via Prisma (see above), so
    // it never runs through LeaveRequestsService.act() and never touches a
    // LeaveBalance row — kept here in case that assumption ever changes.
    // Runs before LeaveType (Restrict FK) regardless.
    await base.leaveBalance.deleteMany({ where: { employeeId: empA, leaveTypeId } }).catch(() => undefined);
    await base.leaveRequest.deleteMany({ where: { id: leaveReqId } }).catch(() => undefined);
    await base.leaveType.deleteMany({ where: { id: leaveTypeId } }).catch(() => undefined);
    await base.shiftAssignment.deleteMany({ where: { employeeId: { in: [empA, empB] } } }).catch(() => undefined);
    await base.shiftDefinition.deleteMany({ where: { id: { in: [shift.id, importShift.id] } } }).catch(() => undefined);
    const orgAUsers = await base.user.findMany({
      where: { email: { in: [`shift.a.${stamp}@example.com`, `shift.b.${stamp}@example.com`] } }, select: { id: true },
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
