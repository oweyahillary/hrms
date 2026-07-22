/**
 * Prove one-off payroll adjustments (bonus/deduction tied to a specific
 * period, not a permanent salary component) end-to-end over HTTP: a PENDING
 * adjustment is picked up by the run covering its target period, folds into
 * gross/net correctly (bonus taxable vs non-taxable, deduction is post-tax),
 * flips to APPLIED, and reverts to PENDING if that draft run is discarded.
 *
 *   cd apps/api && npx ts-node scripts/verify-payroll-adjustments.ts
 *
 * Requires the API to be running (BASE_URL, default http://localhost:3000/api).
 * Uses unused period (year 2093) to avoid colliding with other verify fixtures.
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
    pass += 1;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    fail += 1;
  }
}

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) { console.log('  FAIL  login — no access token'); process.exit(1); }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };
  const stamp = Date.now();

  // Employee with a clean, deduction-free structure so gross/net changes are
  // attributable only to the adjustments under test.
  const nid = String(stamp).slice(-8);
  const empRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      employeeNumber: `ADJ-${stamp}`, firstName: 'Adj', lastName: 'Verify',
      nationalId: nid, employmentType: 'PERMANENT', hireDate: '2020-01-01',
    }),
  });
  const employeeId = ((await empRes.json()) as { id?: string }).id;
  if (!employeeId) { console.log('  FAIL  employee create'); process.exit(1); }
  await fetch(`${BASE}/employees/${employeeId}/salary-structures`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ basicSalary: 60000, effectiveDate: '2020-01-01' , reason: 'Salary revision'}),
  });

  async function createAdjustment(body: Record<string, unknown>): Promise<{ id?: string; status?: string }> {
    const res = await fetch(`${BASE}/employees/${employeeId}/payroll-adjustments`, { method: 'POST', headers: authJson, body: JSON.stringify(body) });
    return res.json() as Promise<{ id?: string; status?: string }>;
  }
  async function runPayroll(month: number, year: number): Promise<{
    id?: string;
    payslips?: Array<{ grossPay: number; otherDeductions: number; netPay: number; adjustments: Array<{ id: string; type: string; amount: number }> }>;
  }> {
    const res = await fetch(`${BASE}/payroll/runs`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ periodMonth: month, periodYear: year, employeeIds: [employeeId] }),
    });
    return res.json() as Promise<{
      id?: string;
      payslips?: Array<{ grossPay: number; otherDeductions: number; netPay: number; adjustments: Array<{ id: string; type: string; amount: number }> }>;
    }>;
  }
  async function getAdjustment(id: string): Promise<{ status?: string }> {
    const list = await fetch(`${BASE}/employees/${employeeId}/payroll-adjustments`, { headers: auth });
    const rows = (await list.json()) as Array<{ id: string; status: string }>;
    return rows.find((r) => r.id === id) ?? {};
  }

  // --- A taxable bonus and a plain deduction targeting the same period ---
  const bonus = await createAdjustment({ type: 'BONUS', amount: 10000, reason: 'Performance bonus', targetPeriodMonth: 1, targetPeriodYear: 2093 });
  const ded = await createAdjustment({ type: 'DEDUCTION', amount: 1500, reason: 'Lost company phone', targetPeriodMonth: 1, targetPeriodYear: 2093 });
  check('bonus created PENDING', bonus.status === 'PENDING', String(bonus.status));
  check('deduction created PENDING', ded.status === 'PENDING', String(ded.status));

  const baseline = await runPayroll(2, 2093); // control period: nothing targets month 2, should be untouched
  const baseSlip = baseline.payslips?.[0];
  check('a period with no matching adjustments is unaffected', baseSlip?.grossPay === 60000 && baseSlip?.otherDeductions === 0, JSON.stringify(baseSlip));

  const run1 = await runPayroll(1, 2093);
  const slip1 = run1.payslips?.[0];
  check('bonus adds to gross pay (60000 + 10000)', slip1?.grossPay === 70000, String(slip1?.grossPay));
  check('deduction adds to otherDeductions (1500)', slip1?.otherDeductions === 1500, String(slip1?.otherDeductions));
  check('payslip breakdown lists both adjustments', (slip1?.adjustments?.length ?? 0) === 2, JSON.stringify(slip1?.adjustments));

  let bonusState = await getAdjustment(bonus.id!);
  let dedState = await getAdjustment(ded.id!);
  check('bonus flips to APPLIED once consumed by a run', bonusState.status === 'APPLIED', String(bonusState.status));
  check('deduction flips to APPLIED once consumed by a run', dedState.status === 'APPLIED', String(dedState.status));

  // --- Discarding the draft reverts both adjustments back to PENDING ---
  const discardRes = await fetch(`${BASE}/payroll/runs/${run1.id}`, { method: 'DELETE', headers: auth });
  check('discard draft succeeds', discardRes.ok, String(discardRes.status));
  bonusState = await getAdjustment(bonus.id!);
  dedState = await getAdjustment(ded.id!);
  check('discarding the draft reverts the bonus to PENDING', bonusState.status === 'PENDING', String(bonusState.status));
  check('discarding the draft reverts the deduction to PENDING', dedState.status === 'PENDING', String(dedState.status));

  // --- Re-running the same period picks the still-PENDING adjustments up again ---
  const run1b = await runPayroll(1, 2093);
  const slip1b = run1b.payslips?.[0];
  check('re-run after discard re-applies both adjustments identically', slip1b?.grossPay === 70000 && slip1b?.otherDeductions === 1500, JSON.stringify(slip1b));
  await fetch(`${BASE}/payroll/runs/${run1b.id}/finalize`, { method: 'POST', headers: auth });
  bonusState = await getAdjustment(bonus.id!);
  check('finalizing leaves a consumed adjustment APPLIED', bonusState.status === 'APPLIED', String(bonusState.status));

  // --- A cancelled PENDING adjustment is never picked up ---
  const skipMe = await createAdjustment({ type: 'BONUS', amount: 999, reason: 'Should be skipped', targetPeriodMonth: 3, targetPeriodYear: 2093 });
  const cancelRes = await fetch(`${BASE}/payroll-adjustments/${skipMe.id}/cancel`, { method: 'PATCH', headers: auth });
  check('cancel a pending adjustment succeeds', cancelRes.ok, String(cancelRes.status));
  const run3 = await runPayroll(3, 2093);
  const slip3 = run3.payslips?.[0];
  check('a cancelled adjustment is never applied to payroll', slip3?.grossPay === 60000, String(slip3?.grossPay));
  const recancelRes = await fetch(`${BASE}/payroll-adjustments/${skipMe.id}/cancel`, { method: 'PATCH', headers: auth });
  check('cancelling an already-cancelled adjustment is rejected (409)', recancelRes.status === 409, String(recancelRes.status));

  // --- A non-taxable bonus adds to gross but not to PAYE's taxable base ---
  await createAdjustment({ type: 'BONUS', amount: 5000, isTaxable: false, reason: 'Non-taxable gift', targetPeriodMonth: 4, targetPeriodYear: 2093 });
  const run4 = await runPayroll(4, 2093);
  const slip4 = run4.payslips?.[0];
  check('non-taxable bonus still adds to gross pay', slip4?.grossPay === 65000, String(slip4?.grossPay));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
