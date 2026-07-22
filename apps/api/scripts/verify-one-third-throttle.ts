/**
 * Prove the Employment Act §19 one-third-rule throttle end-to-end over HTTP: a
 * loan installment (or one-off deduction) that would push take-home below
 * one-third of basic pay is capped at the floor, the shortfall is carried
 * forward (losslessly, in the loan balance) rather than applied anyway, the
 * payslip's oneThirdRulePass flips to true because of the throttle, and a
 * deduction that can't fit is deferred (kept PENDING) and surfaced, not dropped.
 *
 *   cd apps/api && npx ts-node scripts/verify-one-third-throttle.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api). Uses
 * unused periods (year 2088/2089) so it never collides with other verify
 * fixtures' payroll runs (only one REGULAR run exists per org+period).
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const near = (a: number, b: number, eps = 0.01): boolean => Math.abs(a - b) <= eps;

interface Rep { loanId: string; amount: number; scheduledAmount: number; deferredAmount: number }
interface Slip { employeeId: string; otherDeductions: number; netPay: number; oneThirdRulePass: boolean; loanRepayments: Rep[] }
interface RunDetail {
  id?: string;
  payslips?: Slip[];
  deferredDeductions?: Array<{ id: string; employeeId: string; amount: number; reason: string | null }>;
}

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) { console.log('  FAIL  login — no access token'); process.exit(1); }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };
  const stamp = Date.now();
  let nid = 0;

  // basic 30000 -> one-third floor = 10000. With no allowances, gross 30000.
  const BASIC = 30000;
  const FLOOR = round2(BASIC / 3);

  async function createEmployee(tag: string, basic: number): Promise<string> {
    const res = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeNumber: `${tag}-${stamp}`, firstName: tag, lastName: 'Throttle',
        nationalId: String(stamp).slice(-7) + String(nid++), employmentType: 'PERMANENT', hireDate: '2019-01-01',
      }),
    });
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    await fetch(`${BASE}/employees/${id}/salary-structures`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ basicSalary: basic, effectiveDate: '2019-01-01' , reason: 'Salary revision'}),
    });
    return id;
  }
  // Same as createEmployee but with a standing salary-structure voluntary
  // deduction (a PROTECTED deduction — counted against the floor but never
  // throttled by this feature; it's the employee's own standing instruction).
  async function createEmployeeWithVoluntaryDeduction(tag: string, basic: number, deduction: number): Promise<string> {
    const res = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeNumber: `${tag}-${stamp}`, firstName: tag, lastName: 'Throttle',
        nationalId: String(stamp).slice(-7) + String(nid++), employmentType: 'PERMANENT', hireDate: '2019-01-01',
      }),
    });
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    await fetch(`${BASE}/employees/${id}/salary-structures`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        basicSalary: basic, effectiveDate: '2019-01-01', reason: 'Salary revision',
        components: [{ componentType: 'DEDUCTION_VOLUNTARY', name: 'Standing voluntary deduction', amount: deduction, isTaxable: false }],
      }),
    });
    return id;
  }
  async function createLoan(empId: string, principal: number, installments: number): Promise<string> {
    const res = await fetch(`${BASE}/employees/${empId}/loans`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ type: 'LOAN', principal, numberOfInstallments: installments, disbursedDate: '2019-06-01', reason: 'Throttle test' }),
    });
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error('loan create failed');
    return id;
  }
  async function createDeduction(empId: string, amount: number, month: number, year: number): Promise<string> {
    const res = await fetch(`${BASE}/employees/${empId}/payroll-adjustments`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ type: 'DEDUCTION', amount, reason: 'One-off deduction', targetPeriodMonth: month, targetPeriodYear: year }),
    });
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error('adjustment create failed');
    return id;
  }
  async function getLoan(id: string): Promise<{ balance: number; status: string }> {
    return (await (await fetch(`${BASE}/loans/${id}`, { headers: auth })).json()) as { balance: number; status: string };
  }
  async function adjustmentStatus(empId: string, id: string): Promise<string> {
    const rows = (await (await fetch(`${BASE}/employees/${empId}/payroll-adjustments`, { headers: auth })).json()) as Array<{ id: string; status: string }>;
    return rows.find((r) => r.id === id)?.status ?? 'MISSING';
  }
  async function run(month: number, year: number, empId: string): Promise<RunDetail> {
    const res = await fetch(`${BASE}/payroll/runs`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ periodMonth: month, periodYear: year, employeeIds: [empId] }),
    });
    return (await res.json()) as RunDetail;
  }
  const finalize = (id: string) => fetch(`${BASE}/payroll/runs/${id}/finalize`, { method: 'POST', headers: auth });
  const discard = (id: string) => fetch(`${BASE}/payroll/runs/${id}`, { method: 'DELETE', headers: auth });

  // ── Scenario 1: a loan installment bigger than the floor budget is throttled ──
  const e1 = await createEmployee('OTR1', BASIC);
  const loan1 = await createLoan(e1, 20000, 1); // installment 20000 — far above the ~16k budget

  const r1 = await run(1, 2088, e1);
  const s1 = r1.payslips?.[0];
  const rep1 = s1?.loanRepayments?.[0];
  check('a loan installment is recorded for the throttled run', !!rep1, JSON.stringify(s1?.loanRepayments));
  if (s1 && rep1) {
    const netAfterStatutory = round2(s1.netPay + rep1.amount);
    check('the schedule still wanted the full installment (20000)', rep1.scheduledAmount === 20000, String(rep1.scheduledAmount));
    check('the installment was throttled (deferredAmount > 0)', rep1.deferredAmount > 0, String(rep1.deferredAmount));
    check('applied + deferred reconciles to the scheduled installment', near(rep1.amount + rep1.deferredAmount, rep1.scheduledAmount), `${rep1.amount}+${rep1.deferredAmount}`);
    check('take-home lands exactly on the one-third floor', near(s1.netPay, FLOOR), String(s1.netPay));
    check('take-home is not below one-third of basic', s1.netPay >= FLOOR - 0.01, String(s1.netPay));
    check('oneThirdRulePass is TRUE thanks to the throttle', s1.oneThirdRulePass === true, String(s1.oneThirdRulePass));
    check('applying the FULL installment WOULD have breached the floor (so the throttle was needed)',
      netAfterStatutory - rep1.scheduledAmount < FLOOR, `full-net ${round2(netAfterStatutory - rep1.scheduledAmount)} < ${FLOOR}`);
    check('otherDeductions equals only what was actually applied', near(s1.otherDeductions, rep1.amount), `${s1.otherDeductions} vs ${rep1.amount}`);
    const l1 = await getLoan(loan1);
    check('the unpaid remainder is carried forward in the loan balance (lossless)', near(l1.balance, rep1.deferredAmount), `${l1.balance} vs ${rep1.deferredAmount}`);
    check('the loan is not completed by a throttled installment', l1.status === 'ACTIVE', l1.status);

    // Carry-forward: next run clears the small remainder in full, loan completes.
    await finalize(r1.id!);
    const r1b = await run(2, 2088, e1);
    const rep1b = r1b.payslips?.[0]?.loanRepayments?.[0];
    check('the carried-forward remainder is deducted in full next run', rep1b !== undefined && near(rep1b.amount, rep1.deferredAmount) && rep1b.deferredAmount === 0,
      JSON.stringify(rep1b));
    check('next run stays at/above the floor', (r1b.payslips?.[0]?.netPay ?? 0) >= FLOOR - 0.01, String(r1b.payslips?.[0]?.netPay));
    const l1b = await getLoan(loan1);
    check('loan reaches zero and completes once the remainder clears', l1b.balance === 0 && l1b.status === 'COMPLETED', `${l1b.balance}/${l1b.status}`);
    await finalize(r1b.id!);
  }

  // ── Scenario 2: a one-off deduction that would breach the floor is deferred whole ──
  const e2 = await createEmployee('OTR2', BASIC);
  const ded2 = await createDeduction(e2, 20000, 3, 2088); // 20000 > budget -> cannot fit

  const r2 = await run(3, 2088, e2);
  const s2 = r2.payslips?.[0];
  check('a floor-breaching one-off deduction applies nothing this run', near(s2?.otherDeductions ?? -1, 0), String(s2?.otherDeductions));
  check('the employee keeps take-home above the floor (deduction deferred)', (s2?.netPay ?? 0) >= FLOOR - 0.01, String(s2?.netPay));
  check('oneThirdRulePass is TRUE (no breach occurred)', s2?.oneThirdRulePass === true, String(s2?.oneThirdRulePass));
  check('the deferred deduction is surfaced at the run level, not dropped',
    (r2.deferredDeductions ?? []).some((d) => d.employeeId === e2 && near(d.amount, 20000)), JSON.stringify(r2.deferredDeductions));
  check('the deferred deduction is still PENDING (uncomsumed)', (await adjustmentStatus(e2, ded2)) === 'PENDING', await adjustmentStatus(e2, ded2));
  // Deferral must survive finalize (the officer needs to see it on the locked run).
  await finalize(r2.id!);
  const r2f = (await (await fetch(`${BASE}/payroll/runs/${r2.id}`, { headers: auth })).json()) as RunDetail;
  check('the deferral is still visible on the finalized run', (r2f.deferredDeductions ?? []).some((d) => d.employeeId === e2), JSON.stringify(r2f.deferredDeductions));
  check('finalizing does not consume the deferred deduction', (await adjustmentStatus(e2, ded2)) === 'PENDING', await adjustmentStatus(e2, ded2));

  // ── Scenario 3: deductions rank ahead of loans — a fitting deduction consumes the ──
  //    budget and the loan installment is withheld whole (visible 0-amount row).
  const e3 = await createEmployee('OTR3', BASIC);
  // Probe the exact floor budget from a clean run (no loan/adjustment).
  const probe = await run(4, 2088, e3);
  const netClean = probe.payslips?.[0]?.netPay ?? 0;
  const budget = round2(netClean - FLOOR);
  check('probe: a clean run sits well above the floor', netClean > FLOOR, String(netClean));
  await discard(probe.id!);

  const ded3 = await createDeduction(e3, budget, 5, 2088); // fits exactly, consumes the whole budget
  const loan3 = await createLoan(e3, 5000, 1);             // 5000 installment, but nothing left for it

  const r3 = await run(5, 2088, e3);
  const s3 = r3.payslips?.[0];
  const rep3 = s3?.loanRepayments?.[0];
  check('the fitting one-off deduction is applied (ranks ahead of the loan)', near(s3?.otherDeductions ?? -1, budget), `${s3?.otherDeductions} vs ${budget}`);
  check('the loan installment is withheld whole (amount 0)', rep3 !== undefined && rep3.amount === 0, JSON.stringify(rep3));
  check('the withheld installment is still visible with its scheduled + deferred amounts', rep3 !== undefined && rep3.scheduledAmount === 5000 && near(rep3.deferredAmount, 5000), JSON.stringify(rep3));
  check('take-home holds exactly at the floor', near(s3?.netPay ?? 0, FLOOR), String(s3?.netPay));
  check('oneThirdRulePass is TRUE', s3?.oneThirdRulePass === true, String(s3?.oneThirdRulePass));
  check('the applied deduction is APPLIED, not deferred', (await adjustmentStatus(e3, ded3)) === 'APPLIED', await adjustmentStatus(e3, ded3));
  const l3 = await getLoan(loan3);
  check('a withheld installment leaves the loan balance untouched (carried forward)', l3.balance === 5000 && l3.status === 'ACTIVE', `${l3.balance}/${l3.status}`);
  await discard(r3.id!);

  // ── Scenario 4: the breach comes from PROTECTED deductions, not throttleable ──
  //    ones. A standing salary-structure voluntary deduction (20000), on top of
  //    statutory, already pushes net below the floor before any loan is applied.
  //    The throttle must fully defer the throttleable loan (there is no budget for
  //    it), but it CANNOT reduce a protected deduction — so the breach remains and
  //    oneThirdRulePass stays FALSE, surfacing it for the officer's finalize
  //    override rather than silently passing.
  const e4 = await createEmployeeWithVoluntaryDeduction('OTR4', BASIC, 20000);
  const loan4 = await createLoan(e4, 5000, 1); // throttleable, but the budget is already negative
  const r4 = await run(1, 2089, e4);
  const s4 = r4.payslips?.[0];
  const rep4 = s4?.loanRepayments?.[0];
  check('protected-breach: the throttleable loan is fully withheld (amount 0)',
    rep4 !== undefined && rep4.amount === 0, JSON.stringify(rep4));
  check('protected-breach: the whole scheduled installment is deferred (nothing forced through)',
    rep4 !== undefined && rep4.scheduledAmount === 5000 && near(rep4.deferredAmount, 5000), JSON.stringify(rep4));
  check('protected-breach: only the protected voluntary deduction is applied (no throttleable added on top)',
    near(s4?.otherDeductions ?? -1, 20000), String(s4?.otherDeductions));
  check('protected-breach: take-home is BELOW the one-third floor — the throttle cannot fix a protected-deduction breach',
    (s4?.netPay ?? Infinity) < FLOOR - 0.01, String(s4?.netPay));
  check('protected-breach: oneThirdRulePass is FALSE — the breach is surfaced, not silently passed',
    s4?.oneThirdRulePass === false, String(s4?.oneThirdRulePass));
  const l4 = await getLoan(loan4);
  check('protected-breach: the withheld loan is untouched and still ACTIVE (nothing lost)',
    l4.balance === 5000 && l4.status === 'ACTIVE', `${l4.balance}/${l4.status}`);
  await discard(r4.id!);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
