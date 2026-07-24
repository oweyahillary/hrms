/**
 * Prove overtime end-to-end over HTTP: attendance+shift data derives PENDING
 * entries idempotently, approval gates payroll consumption, an APPROVED
 * entry's amount (hours x hourly-rate x multiplier, resolved against the
 * policy in force on the entry's OWN date) is frozen at DRAFT-build time and
 * flows into the payslip's grossPay, a finalized run's consumed entries can
 * never be edited/re-derived/re-consumed, a REJECTED entry never pays,
 * /me/overtime is self-scoped, and two-org isolation holds in both
 * directions (per the org-scoping hotfix's test philosophy).
 *
 *   cd apps/api && npx ts-node scripts/verify-overtime.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Uses periods 2097-03 / 2097-09 and dates in 2097 — unused by any other
 * verify-*.ts fixture (verify-p10.ts already owns 2097-04). Mirrors
 * verify-self-service.ts's throwaway-second-org
 * pattern for tenant isolation; org-A fixtures are left in place (consistent
 * with verify-loans.ts / verify-payroll-adjustments.ts, which don't tear
 * their own-org HTTP fixtures down either).
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

const DATE_DERIVE = '2097-03-01'; // run-1 period (month 3)
const DATE_REJECT = '2097-09-05'; // run-2 period (month 9) — separate from run-1's period, and from verify-p10.ts's own 2097-04 fixture run
const BULK_DATE_1 = '2097-05-01';
const BULK_DATE_2 = '2097-05-02';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface OvertimeEntry {
  id: string; employeeId: string; date: string; hours: number; category: string;
  source: string; status: string; note: string | null;
  approvedByUserId: string | null; approvedAt: string | null; payrollRunId: string | null; amount: number | null;
}
interface DeriveResult { derived: number; updated: number; removed: number; excessReported: unknown[] }
interface EffectivePolicy {
  id: string | null; normalDayMultiplier: number; restDayMultiplier: number; holidayMultiplier: number;
  hourlyRateBasis: string; normalWeeklyHours: number;
}
interface Payslip { employeeId: string; grossPay: number; overtime: Array<{ id: string; hours: number; category: string; amount: number }> }
interface PayrollRun { id: string; payslips: Payslip[] }
interface ShiftDef { id: string; code: string; startTime: string; endTime: string; breakMinutes: number }

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
  async function provisionEmployeeLogin(employeeId: string, email: string, adminJson: Record<string, string>): Promise<string> {
    const created = await fetch(`${BASE}/employees/${employeeId}/create-login`, {
      method: 'POST', headers: adminJson, body: JSON.stringify({ email, roleName: 'Employee' }),
    });
    const { temporaryPassword } = (await created.json()) as { temporaryPassword?: string };
    if (!temporaryPassword) { console.log(`  FAIL  create-login for ${email}`); process.exit(1); }
    const tempToken = await login(email, temporaryPassword);
    const newPassword = 'OvertimeSelfService123!';
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
        employeeNumber: `OT-${tag}-${stamp}`, firstName: 'Overtime', lastName: tag,
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
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

  const empA = await makeEmployee('A');
  const empB = await makeEmployee('B');
  const tokenA = await provisionEmployeeLogin(empA, `ot.a.${stamp}@example.com`, adminJson);
  const tokenB = await provisionEmployeeLogin(empB, `ot.b.${stamp}@example.com`, adminJson);
  const authA = { Authorization: `Bearer ${tokenA}` };
  const authB = { Authorization: `Bearer ${tokenB}` };

  // ── (a) derive from attendance + shift data ──
  const shifts = (await (await fetch(`${BASE}/shift-definitions`, { headers: adminAuth })).json()) as ShiftDef[];
  const general = shifts.find((s) => s.code === 'G'); // seeded 08:00-17:00, 60min break -> 9h gross scheduled span
  check('seeded General (G) shift exists', !!general, JSON.stringify(shifts.map((s) => s.code)));
  if (!general) { console.log('  FAIL  cannot continue without the General shift'); process.exit(1); }

  await fetch(`${BASE}/shifts/roster`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_DERIVE, shiftDefinitionId: general.id }),
  });
  await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({
      employeeId: empA, date: DATE_DERIVE,
      clockIn: `${DATE_DERIVE}T08:00:00.000Z`, clockOut: `${DATE_DERIVE}T19:00:00.000Z`, // 11h worked vs 9h scheduled -> 2h overtime
    }),
  });

  const derive1 = (await (await fetch(`${BASE}/overtime/derive`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ from: DATE_DERIVE, to: DATE_DERIVE }),
  })).json()) as DeriveResult;
  check('first derive pass creates exactly one entry', derive1.derived === 1 && derive1.updated === 0, JSON.stringify(derive1));

  const listAfterDerive1 = (await (await fetch(`${BASE}/overtime?employeeId=${empA}&from=${DATE_DERIVE}&to=${DATE_DERIVE}`, { headers: adminAuth })).json()) as OvertimeEntry[];
  check('derived entry appears exactly once', listAfterDerive1.length === 1, JSON.stringify(listAfterDerive1));
  const derivedEntry = listAfterDerive1[0];
  check('derived entry has 2 hours (11h worked - 9h scheduled)', derivedEntry?.hours === 2, JSON.stringify(derivedEntry));
  check('derived entry category is NORMAL_DAY (shift assigned, not a holiday)', derivedEntry?.category === 'NORMAL_DAY', JSON.stringify(derivedEntry));
  check('derived entry source is DERIVED and status is PENDING (requiresApproval default true)', derivedEntry?.source === 'DERIVED' && derivedEntry?.status === 'PENDING', JSON.stringify(derivedEntry));

  // ── (b) derive idempotency: re-running the same range updates in place, never duplicates ──
  const derive2 = (await (await fetch(`${BASE}/overtime/derive`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ from: DATE_DERIVE, to: DATE_DERIVE }),
  })).json()) as DeriveResult;
  check('re-running derive over the same range updates in place (0 created, 1 updated)', derive2.derived === 0 && derive2.updated === 1 && derive2.removed === 0, JSON.stringify(derive2));
  const listAfterDerive2 = (await (await fetch(`${BASE}/overtime?employeeId=${empA}&from=${DATE_DERIVE}&to=${DATE_DERIVE}`, { headers: adminAuth })).json()) as OvertimeEntry[];
  check('idempotent re-run leaves exactly one row with the same id', listAfterDerive2.length === 1 && listAfterDerive2[0].id === derivedEntry.id, JSON.stringify(listAfterDerive2));

  // ── (c) approve + payroll consumption at the correct amount ──
  const approved = (await (await fetch(`${BASE}/overtime/${derivedEntry.id}/approve`, { method: 'POST', headers: adminAuth })).json()) as OvertimeEntry;
  check('approving a pending entry flips it to APPROVED', approved.status === 'APPROVED', JSON.stringify(approved));

  // seed.ts provisions a default-valued OvertimePolicy (effective 2020-01-01) for every
  // org, so this resolves to that seeded row (id present) rather than the hardcoded
  // in-code fallback — but the VALUES are the same defaults either way.
  const effectivePolicy = (await (await fetch(`${BASE}/overtime-policies/effective`, { headers: adminAuth })).json()) as EffectivePolicy;
  check('effective policy resolves to the seeded default (basis/hours/multiplier)', effectivePolicy.id !== null && effectivePolicy.hourlyRateBasis === 'MONTHLY_X12_DIV_52_WEEKLY_HOURS' && effectivePolicy.normalWeeklyHours === 45 && effectivePolicy.normalDayMultiplier === 1.5, JSON.stringify(effectivePolicy));

  // hourlyRate = (basicSalary x 12) / 52 weeks / normalWeeklyHours; amount = hours x hourlyRate x normalDayMultiplier
  const basicSalary = 60000;
  const hourlyRate = (basicSalary * 12) / 52 / effectivePolicy.normalWeeklyHours;
  const expectedAmount = Math.round((2 * hourlyRate * effectivePolicy.normalDayMultiplier + Number.EPSILON) * 100) / 100;

  const run1 = (await (await fetch(`${BASE}/payroll/runs`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ periodMonth: 3, periodYear: 2097, employeeIds: [empA] }),
  })).json()) as PayrollRun;
  const slip1 = run1.payslips.find((p) => p.employeeId === empA);
  check('draft run picks up the approved entry as an itemized overtime line', slip1?.overtime.length === 1 && slip1.overtime[0].id === derivedEntry.id, JSON.stringify(slip1?.overtime));
  check('the itemized line carries the correctly-computed amount', slip1?.overtime[0].amount === expectedAmount, `expected ${expectedAmount}, got ${slip1?.overtime[0].amount}`);
  check('grossPay folds the overtime amount in on top of basic salary', slip1?.grossPay === Math.round((basicSalary + expectedAmount + Number.EPSILON) * 100) / 100, `grossPay=${slip1?.grossPay}`);

  const entryAfterDraft = (await (await fetch(`${BASE}/overtime/${derivedEntry.id}`, { headers: adminAuth })).json()) as OvertimeEntry;
  check('consumption is stamped at DRAFT-build time, not deferred to finalize (payrollRunId set already)', entryAfterDraft.payrollRunId === run1.id, JSON.stringify(entryAfterDraft));
  check('the frozen amount matches what was applied to the payslip', entryAfterDraft.amount === expectedAmount, JSON.stringify(entryAfterDraft));

  // ── (d) an APPROVED (non-PENDING) entry can never be edited or removed, draft or finalized ──
  const editBlockedPreFinalize = await fetch(`${BASE}/overtime/${derivedEntry.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ hours: 5 }) });
  check('editing a non-pending entry is blocked (409) even before finalize', editBlockedPreFinalize.status === 409, String(editBlockedPreFinalize.status));
  const deleteBlockedPreFinalize = await fetch(`${BASE}/overtime/${derivedEntry.id}`, { method: 'DELETE', headers: adminAuth });
  check('deleting a non-pending entry is blocked (409) even before finalize', deleteBlockedPreFinalize.status === 409, String(deleteBlockedPreFinalize.status));

  // ── (e) finalize: entry stays exactly as consumed, and can never be re-derived or re-consumed ──
  await fetch(`${BASE}/payroll/runs/${run1.id}/finalize`, { method: 'POST', headers: adminAuth });
  const entryAfterFinalize = (await (await fetch(`${BASE}/overtime/${derivedEntry.id}`, { headers: adminAuth })).json()) as OvertimeEntry;
  check('finalize does not alter the already-consumed entry', entryAfterFinalize.payrollRunId === run1.id && entryAfterFinalize.amount === expectedAmount && entryAfterFinalize.status === 'APPROVED', JSON.stringify(entryAfterFinalize));

  const derive3 = (await (await fetch(`${BASE}/overtime/derive`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ from: DATE_DERIVE, to: DATE_DERIVE }),
  })).json()) as DeriveResult;
  check('deriving over a range whose entry is already consumed is a total no-op', derive3.derived === 0 && derive3.updated === 0 && derive3.removed === 0, JSON.stringify(derive3));

  const editBlockedPostFinalize = await fetch(`${BASE}/overtime/${derivedEntry.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ hours: 5 }) });
  check('editing a finalized-and-consumed entry is blocked (409)', editBlockedPostFinalize.status === 409, String(editBlockedPostFinalize.status));

  // ── (f) a REJECTED entry never pays ──
  const rejectCandidate = (await (await fetch(`${BASE}/overtime`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA, date: DATE_REJECT, hours: 3, category: 'NORMAL_DAY', note: 'manual entry pending rejection' }),
  })).json()) as OvertimeEntry;
  check('manual entry created PENDING', rejectCandidate.status === 'PENDING', JSON.stringify(rejectCandidate));

  const rejected = (await (await fetch(`${BASE}/overtime/${rejectCandidate.id}/reject`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ note: 'not authorized in advance' }),
  })).json()) as OvertimeEntry;
  check('rejecting flips status to REJECTED', rejected.status === 'REJECTED', JSON.stringify(rejected));

  const run2 = (await (await fetch(`${BASE}/payroll/runs`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ periodMonth: 9, periodYear: 2097, employeeIds: [empA] }),
  })).json()) as PayrollRun;
  const slip2 = run2.payslips.find((p) => p.employeeId === empA);
  check('a rejected entry never reaches a payslip', (slip2?.overtime.length ?? -1) === 0, JSON.stringify(slip2?.overtime));
  check('a rejected entry does not affect grossPay', slip2?.grossPay === basicSalary, `grossPay=${slip2?.grossPay}`);

  const rejectedAfterRun = (await (await fetch(`${BASE}/overtime/${rejectCandidate.id}`, { headers: adminAuth })).json()) as OvertimeEntry;
  check('a rejected entry is never stamped with a payrollRunId', rejectedAfterRun.payrollRunId === null, JSON.stringify(rejectedAfterRun));

  // ── (g) bulk-approve by date range ──
  await fetch(`${BASE}/overtime`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empB, date: BULK_DATE_1, hours: 1, category: 'NORMAL_DAY' }),
  });
  await fetch(`${BASE}/overtime`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empB, date: BULK_DATE_2, hours: 1.5, category: 'NORMAL_DAY' }),
  });
  const bulkResult = (await (await fetch(`${BASE}/overtime/bulk-approve`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ from: BULK_DATE_1, to: BULK_DATE_2 }),
  })).json()) as { approved: number };
  check('bulk-approve approves both pending entries in range', bulkResult.approved === 2, JSON.stringify(bulkResult));
  const bEntriesAfterBulk = (await (await fetch(`${BASE}/overtime?employeeId=${empB}&from=${BULK_DATE_1}&to=${BULK_DATE_2}`, { headers: adminAuth })).json()) as OvertimeEntry[];
  check('both bulk-approved entries are now APPROVED', bEntriesAfterBulk.length === 2 && bEntriesAfterBulk.every((e) => e.status === 'APPROVED'), JSON.stringify(bEntriesAfterBulk));

  // ── (h) /me/overtime is self-scoped ──
  const myOvertimeA = (await (await fetch(`${BASE}/me/overtime`, { headers: authA })).json()) as OvertimeEntry[];
  check('A\'s /me/overtime includes A\'s own entries', myOvertimeA.some((e) => e.id === derivedEntry.id) && myOvertimeA.some((e) => e.id === rejectCandidate.id), JSON.stringify(myOvertimeA.map((e) => e.id)));
  check('A\'s /me/overtime does not include B\'s entries', !myOvertimeA.some((e) => e.employeeId === empB), JSON.stringify(myOvertimeA.map((e) => e.employeeId)));

  const myOvertimeB = (await (await fetch(`${BASE}/me/overtime`, { headers: authB })).json()) as OvertimeEntry[];
  check('B\'s /me/overtime includes B\'s own entries', myOvertimeB.length === 2 && myOvertimeB.every((e) => e.employeeId === empB), JSON.stringify(myOvertimeB));
  check('B\'s /me/overtime does not include A\'s entries', !myOvertimeB.some((e) => e.employeeId === empA), JSON.stringify(myOvertimeB.map((e) => e.employeeId)));

  // ── (i) two-org isolation, both directions ──
  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  const orgZ = await base.organization.create({ data: { name: `__overtime_probe_${stamp}__` } });
  const roleZ = await base.role.create({ data: { organizationId: orgZ.id, name: 'Admin', permissions: { all: true } } });
  const passwords = new PasswordService();
  const orgZAdminEmail = `ot.z.admin.${stamp}@example.com`;
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
        employeeNumber: `OT-Z-${stamp}`, firstName: 'Overtime', lastName: 'Z',
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const empZ = ((await empZRes.json()) as { id?: string }).id;
    if (!empZ) { console.log('  FAIL  org-Z employee create'); process.exit(1); }
    const tokenZEmp = await provisionEmployeeLogin(empZ, `ot.z.emp.${stamp}@example.com`, zAdminJson);
    orgZEmpUserId = ((await base.user.findFirst({ where: { organizationId: orgZ.id, email: `ot.z.emp.${stamp}@example.com` } })) as { id: string } | null)?.id ?? null;

    const entryZ = (await (await fetch(`${BASE}/overtime`, {
      method: 'POST', headers: zAdminJson,
      body: JSON.stringify({ employeeId: empZ, date: BULK_DATE_1, hours: 2, category: 'NORMAL_DAY' }),
    })).json()) as OvertimeEntry;
    check('org Z can create its own overtime entry', !!entryZ.id, JSON.stringify(entryZ));

    // org A's admin cannot see or reach org Z's entry
    const orgAListSeesZ = (await (await fetch(`${BASE}/overtime?employeeId=${empZ}`, { headers: adminAuth })).json()) as OvertimeEntry[];
    check('org A\'s list scoped to org Z\'s employeeId returns nothing (cross-tenant, not just cross-employee)', Array.isArray(orgAListSeesZ) && orgAListSeesZ.length === 0, JSON.stringify(orgAListSeesZ));
    const orgAFetchZById = await fetch(`${BASE}/overtime/${entryZ.id}`, { headers: adminAuth });
    check('org A fetching org Z\'s entry by id gets 404', orgAFetchZById.status === 404, String(orgAFetchZById.status));

    // org Z cannot see or reach org A's / org B's entries
    const orgZListSeesA = (await (await fetch(`${BASE}/overtime?employeeId=${empA}`, { headers: zAdminAuth })).json()) as OvertimeEntry[];
    check('org Z\'s list scoped to org A\'s employeeId returns nothing', Array.isArray(orgZListSeesA) && orgZListSeesA.length === 0, JSON.stringify(orgZListSeesA));
    const orgZFetchAById = await fetch(`${BASE}/overtime/${derivedEntry.id}`, { headers: zAdminAuth });
    check('org Z fetching org A\'s entry by id gets 404', orgZFetchAById.status === 404, String(orgZFetchAById.status));

    const meOvertimeZ = (await (await fetch(`${BASE}/me/overtime`, { headers: { Authorization: `Bearer ${tokenZEmp}` } })).json()) as OvertimeEntry[];
    check('org Z employee\'s /me/overtime sees only their own entry', meOvertimeZ.length === 1 && meOvertimeZ[0].id === entryZ.id, JSON.stringify(meOvertimeZ));

    // policy isolation: org Z configuring its own policy must not leak into org A's effective() defaults
    await fetch(`${BASE}/overtime-policies`, {
      method: 'POST', headers: zAdminJson,
      body: JSON.stringify({ effectiveFrom: '2020-01-01', normalDayMultiplier: 3, restDayMultiplier: 3, holidayMultiplier: 3 }),
    });
    const orgAEffectiveAfterZPolicy = (await (await fetch(`${BASE}/overtime-policies/effective`, { headers: adminAuth })).json()) as EffectivePolicy;
    check('org Z creating its own policy does not change org A\'s effective policy', orgAEffectiveAfterZPolicy.normalDayMultiplier === 1.5, JSON.stringify(orgAEffectiveAfterZPolicy));
  } finally {
    const userIds = [orgZAdminUser.id, ...(orgZEmpUserId ? [orgZEmpUserId] : [])];
    await base.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await base.overtimeEntry.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.overtimePolicy.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.employee.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await (prisma as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
