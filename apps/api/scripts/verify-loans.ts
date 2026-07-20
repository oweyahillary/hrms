/**
 * Prove the loan/advance ledger end-to-end over HTTP: installment auto-computed
 * at creation, each REGULAR payroll run deducts the right amount and decrements
 * the balance, the loan auto-completes and stops deducting once paid off,
 * discarding a draft run restores the balance, and cancelling a loan freezes
 * it (no further deductions, past state untouched).
 *
 *   cd apps/api && npx ts-node scripts/verify-loans.ts
 *
 * Requires the API to be running (BASE_URL, default http://localhost:3000/api).
 * Uses unused periods (years 2090/2091) to avoid colliding with other verify
 * fixtures' payroll runs (only one REGULAR run exists per org+period).
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
  let nidCounter = 0;

  async function createEmployee(tag: string): Promise<string> {
    const nid = String(stamp).slice(-7) + String(nidCounter++);
    const res = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeNumber: `${tag}-${stamp}`, firstName: tag, lastName: 'Verify',
        nationalId: nid, employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    await fetch(`${BASE}/employees/${id}/salary-structures`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ basicSalary: 60000, effectiveDate: '2020-01-01' }),
    });
    return id;
  }

  async function getLoan(id: string): Promise<{ balance: number; status: string; installmentAmount: number; repayments: Array<{ amount: number }> }> {
    const res = await fetch(`${BASE}/loans/${id}`, { headers: auth });
    return res.json() as Promise<{ balance: number; status: string; installmentAmount: number; repayments: Array<{ amount: number }> }>;
  }

  async function runPayroll(month: number, year: number, employeeId: string): Promise<{
    id?: string; payslips?: Array<{ otherDeductions: number; loanRepayments: Array<{ loanId: string; amount: number }> }>;
  }> {
    const res = await fetch(`${BASE}/payroll/runs`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ periodMonth: month, periodYear: year, employeeIds: [employeeId] }),
    });
    return res.json() as Promise<{ id?: string; payslips?: Array<{ otherDeductions: number; loanRepayments: Array<{ loanId: string; amount: number }> }> }>;
  }

  // --- Scenario 1: full lifecycle — deduct, discard-reverts, exhaust, auto-stop ---
  const emp1 = await createEmployee('LOAN1');
  const loanRes = await fetch(`${BASE}/employees/${emp1}/loans`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ type: 'LOAN', principal: 12000, numberOfInstallments: 3, disbursedDate: '2020-01-01', reason: 'Test loan' }),
  });
  const loan1 = (await loanRes.json()) as { id?: string; installmentAmount?: number; balance?: number };
  if (!loan1.id) { console.log('  FAIL  loan create'); process.exit(1); }
  check('installment computed as principal / installments (12000/3 = 4000)', loan1.installmentAmount === 4000, String(loan1.installmentAmount));
  check('balance starts at principal (no interest)', loan1.balance === 12000, String(loan1.balance));

  const run1 = await runPayroll(1, 2091, emp1);
  const slip1 = run1.payslips?.[0];
  check('period 1: otherDeductions == installment', slip1?.otherDeductions === 4000, String(slip1?.otherDeductions));
  check('period 1: payslip breakdown carries the loan repayment line', slip1?.loanRepayments?.[0]?.amount === 4000, JSON.stringify(slip1?.loanRepayments));
  let loanState = await getLoan(loan1.id);
  check('period 1: loan balance decremented immediately (draft-time)', loanState.balance === 8000, String(loanState.balance));

  const discardRes = await fetch(`${BASE}/payroll/runs/${run1.id}`, { method: 'DELETE', headers: auth });
  check('discard draft succeeds', discardRes.ok, String(discardRes.status));
  loanState = await getLoan(loan1.id);
  check('discarding the draft restores the loan balance', loanState.balance === 12000, String(loanState.balance));
  check('discarding the draft removes the repayment record', loanState.repayments.length === 0, String(loanState.repayments.length));

  const run1b = await runPayroll(1, 2091, emp1);
  await fetch(`${BASE}/payroll/runs/${run1b.id}/finalize`, { method: 'POST', headers: auth });
  const run2 = await runPayroll(2, 2091, emp1);
  await fetch(`${BASE}/payroll/runs/${run2.id}/finalize`, { method: 'POST', headers: auth });
  loanState = await getLoan(loan1.id);
  check('after 2 finalized periods, balance == 12000 - 2*4000', loanState.balance === 4000, String(loanState.balance));
  check('loan still ACTIVE with balance remaining', loanState.status === 'ACTIVE', loanState.status);

  const run3 = await runPayroll(3, 2091, emp1);
  const slip3 = run3.payslips?.[0];
  check('final installment == remaining balance (4000)', slip3?.otherDeductions === 4000, String(slip3?.otherDeductions));
  await fetch(`${BASE}/payroll/runs/${run3.id}/finalize`, { method: 'POST', headers: auth });
  loanState = await getLoan(loan1.id);
  check('loan balance reaches exactly zero', loanState.balance === 0, String(loanState.balance));
  check('loan auto-completes at zero balance', loanState.status === 'COMPLETED', loanState.status);

  const run4 = await runPayroll(4, 2091, emp1);
  const slip4 = run4.payslips?.[0];
  check('completed loan stops deducting (period 4 has no loan deduction)', slip4?.otherDeductions === 0, String(slip4?.otherDeductions));
  check('completed loan produces no repayment line on a later payslip', (slip4?.loanRepayments?.length ?? 0) === 0, JSON.stringify(slip4?.loanRepayments));

  // --- Scenario 2: cancel freezes the loan (write-off), no further deductions ---
  const emp2 = await createEmployee('LOAN2');
  const loan2Res = await fetch(`${BASE}/employees/${emp2}/loans`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ type: 'ADVANCE', principal: 5000, numberOfInstallments: 1, disbursedDate: '2020-01-01' }),
  });
  const loan2 = (await loan2Res.json()) as { id?: string };
  if (!loan2.id) { console.log('  FAIL  loan2 create'); process.exit(1); }
  const cancelRes = await fetch(`${BASE}/loans/${loan2.id}/cancel`, { method: 'PATCH', headers: auth });
  check('cancel an active loan succeeds', cancelRes.ok, String(cancelRes.status));
  // Period 5 (not 1) — periods 1-4/2091 already have a REGULAR run from
  // scenario 1 above (one REGULAR run per org+period, not per employee).
  const run5 = await runPayroll(5, 2091, emp2);
  const slip5 = run5.payslips?.[0];
  check('a cancelled loan is never picked up by payroll', slip5?.otherDeductions === 0, String(slip5?.otherDeductions));
  const recancelRes = await fetch(`${BASE}/loans/${loan2.id}/cancel`, { method: 'PATCH', headers: auth });
  check('cancelling an already-cancelled loan is rejected (409)', recancelRes.status === 409, String(recancelRes.status));

  // --- Scenario 3: rounding — the last installment absorbs the remainder ---
  const emp3 = await createEmployee('LOAN3');
  const loan3Res = await fetch(`${BASE}/employees/${emp3}/loans`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ type: 'LOAN', principal: 1000, interestRate: 10, numberOfInstallments: 3, disbursedDate: '2020-01-01' }),
  });
  const loan3 = (await loan3Res.json()) as { id?: string; installmentAmount?: number; balance?: number };
  if (!loan3.id) { console.log('  FAIL  loan3 create'); process.exit(1); }
  check('interest folded in: totalPayable 1100 / 3 rounds to 366.67', loan3.installmentAmount === 366.67, String(loan3.installmentAmount));
  await runPayroll(1, 2090, emp3);
  await runPayroll(2, 2090, emp3);
  const run3c = await runPayroll(3, 2090, emp3);
  const slip3c = run3c.payslips?.[0];
  check('final installment absorbs the rounding remainder (366.66, not 366.67)', slip3c?.otherDeductions === 366.66, String(slip3c?.otherDeductions));
  const loan3State = await getLoan(loan3.id);
  check('rounding never leaves a residual balance', loan3State.balance === 0, String(loan3State.balance));
  check('rounding-exhausted loan completes', loan3State.status === 'COMPLETED', loan3State.status);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
