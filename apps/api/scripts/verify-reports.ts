/**
 * Prove the reporting endpoints over HTTP: after finalizing a run, the payroll
 * summary and statutory remittance aggregate correctly (internal identities
 * hold), the year trend reflects the finalized month with the rest zero, the
 * headcount counts the employee, and both report PDFs download as valid files.
 * Assertions are relational, so the gate is independent of statutory rates.
 *
 *   cd apps/api && npx ts-node scripts/verify-reports.ts
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const YEAR = 2098;
const MONTH = 5;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

interface Summary {
  employeesPaid: number; grossPay: number; paye: number;
  nssf: { employee: number; employer: number; total: number };
  shif: number; ahl: { employee: number; employer: number; total: number };
  otherDeductions: number; netPay: number;
}
interface Remittance {
  items: Array<{ levy: string; employee: number; employer: number; total: number }>;
  grandTotal: number;
}
interface Trend {
  months: Array<{ month: number; grossPay: number; employeesPaid: number }>;
  totals: { grossPay: number };
}
interface Headcount { total: number; active: number; byStatus: Record<string, number> }

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) { console.log('  FAIL  login'); process.exit(1); }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };

  const stamp = Date.now();
  const empRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      employeeNumber: `RPT-${stamp}`, firstName: 'Report', lastName: 'Verify',
      nationalId: String(stamp).slice(-8), employmentType: 'PERMANENT', hireDate: '2026-01-01',
    }),
  });
  const employeeId = ((await empRes.json()) as { id?: string }).id;
  if (!employeeId) { console.log('  FAIL  employee create'); process.exit(1); }

  await fetch(`${BASE}/employees/${employeeId}/salary-structures`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      basicSalary: 80000, effectiveDate: '2026-01-01', reason: 'Salary revision',
      components: [{ componentType: 'ALLOWANCE', name: 'House', amount: 20000, isTaxable: true }],
    }),
  });
  const runRes = await fetch(`${BASE}/payroll/runs`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ periodMonth: MONTH, periodYear: YEAR, employeeIds: [employeeId] }),
  });
  const runId = ((await runRes.json()) as { id?: string }).id;
  if (!runId) { console.log('  FAIL  run create'); process.exit(1); }
  await fetch(`${BASE}/payroll/runs/${runId}/finalize?__skipPdf=true`, { method: 'POST', headers: auth });

  // Payroll summary
  const sum = (await (await fetch(`${BASE}/reports/payroll-summary?year=${YEAR}&month=${MONTH}`, { headers: auth })).json()) as Summary;
  check('payroll-summary counts the employee', sum.employeesPaid === 1, `employeesPaid=${sum.employeesPaid}`);
  check('payroll-summary NSSF total = employee + employer',
    near(sum.nssf.total, sum.nssf.employee + sum.nssf.employer));
  check('payroll-summary net = gross − employee deductions',
    near(sum.netPay, sum.grossPay - (sum.paye + sum.nssf.employee + sum.shif + sum.ahl.employee + sum.otherDeductions)),
    `net=${sum.netPay} gross=${sum.grossPay}`);

  // Statutory remittance
  const rem = (await (await fetch(`${BASE}/reports/statutory-remittance?year=${YEAR}&month=${MONTH}`, { headers: auth })).json()) as Remittance;
  check('remittance has four levy items', (rem.items ?? []).length === 4, `items=${rem.items?.length}`);
  check('remittance each item total = employee + employer',
    (rem.items ?? []).every((i) => near(i.total, i.employee + i.employer)));
  check('remittance grand total = sum of item totals',
    near(rem.grandTotal, (rem.items ?? []).reduce((t, i) => t + i.total, 0)), `grand=${rem.grandTotal}`);

  // Year trend
  const trend = (await (await fetch(`${BASE}/reports/year-trend?year=${YEAR}`, { headers: auth })).json()) as Trend;
  const finalizedMonth = trend.months.find((m) => m.month === MONTH);
  const otherMonthsZero = trend.months.filter((m) => m.month !== MONTH).every((m) => m.grossPay === 0);
  check('year-trend: finalized month has gross, matches summary',
    !!finalizedMonth && near(finalizedMonth.grossPay, sum.grossPay), `month${MONTH}=${finalizedMonth?.grossPay}`);
  check('year-trend: all other months are zero', otherMonthsZero);
  check('year-trend: year total gross = finalized month gross',
    near(trend.totals.grossPay, sum.grossPay), `total=${trend.totals.grossPay}`);

  // Headcount
  const hc = (await (await fetch(`${BASE}/reports/headcount`, { headers: auth })).json()) as Headcount;
  check('headcount includes at least our active employee',
    hc.total >= 1 && hc.active >= 1 && hc.byStatus.ACTIVE >= 1, `total=${hc.total} active=${hc.active}`);

  // PDFs
  for (const [label, path] of [
    ['statutory-remittance', 'statutory-remittance'],
    ['payroll-summary', 'payroll-summary'],
  ] as const) {
    const res = await fetch(`${BASE}/reports/${path}/pdf?year=${YEAR}&month=${MONTH}`, { headers: auth });
    const bytes = Buffer.from(await res.arrayBuffer());
    check(`${label} PDF downloads as a valid file`,
      res.status === 200 && bytes.subarray(0, 4).toString('latin1') === '%PDF' && bytes.length > 1000,
      `status=${res.status} bytes=${bytes.length}`);
  }

  // ── Loan book ──
  const loanRes = await fetch(`${BASE}/employees/${employeeId}/loans`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ type: 'LOAN', principal: 30000, numberOfInstallments: 3, disbursedDate: '2026-02-01', reason: 'Report gate loan' }),
  });
  const loanId = ((await loanRes.json()) as { id?: string }).id;
  if (!loanId) { console.log('  FAIL  loan create (reports)'); process.exit(1); }

  interface LoanBookRow { id: string; employeeId: string; status: string; balance: number; installmentsRemaining: number; nextDueAmount: number }
  interface LoanBook { rows: LoanBookRow[]; totals: { count: number; totalOutstanding: number; byStatus: Record<string, number> } }

  const book = (await (await fetch(`${BASE}/reports/loan-book`, { headers: auth })).json()) as LoanBook;
  const ourLoan = book.rows.find((r) => r.id === loanId);
  check('loan-book includes the new loan', !!ourLoan, JSON.stringify(book.totals));
  check('loan-book: installments remaining = 3 and next due = 10000',
    !!ourLoan && ourLoan.installmentsRemaining === 3 && near(ourLoan.nextDueAmount, 10000), JSON.stringify(ourLoan));
  check('loan-book: outstanding exposure = sum of ACTIVE balances (internal identity)',
    near(book.totals.totalOutstanding, book.rows.filter((r) => r.status === 'ACTIVE').reduce((t, r) => t + r.balance, 0)),
    String(book.totals.totalOutstanding));
  check('loan-book: outstanding exposure includes the new loan balance', book.totals.totalOutstanding >= 30000, String(book.totals.totalOutstanding));

  const byEmp = (await (await fetch(`${BASE}/reports/loan-book?employeeId=${employeeId}`, { headers: auth })).json()) as LoanBook;
  check('loan-book filter by employee returns only that employee (and our loan)',
    byEmp.rows.length > 0 && byEmp.rows.every((r) => r.employeeId === employeeId) && byEmp.rows.some((r) => r.id === loanId), `rows=${byEmp.rows.length}`);
  const completedOnly = (await (await fetch(`${BASE}/reports/loan-book?status=COMPLETED`, { headers: auth })).json()) as LoanBook;
  check('loan-book filter by status=COMPLETED excludes our ACTIVE loan', !completedOnly.rows.some((r) => r.id === loanId));

  // ── Severance register ──
  const sevRes = await fetch(`${BASE}/employees/${employeeId}/severance-calculations`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ reason: 'REDUNDANCY', exitDate: '2028-06-30', payFrequency: 'MONTHLY', contractTermType: 'NO_PROVISION' }),
  });
  const sevId = ((await sevRes.json()) as { id?: string }).id;
  if (!sevId) { console.log('  FAIL  severance create (reports)'); process.exit(1); }

  interface SevRow { id: string; employeeId: string; severanceAmount: number; completedYears: number | null; payeStatus: string; provisional: boolean }
  interface SevRegister { rows: SevRow[]; totals: { count: number; totalSeverance: number; provisionalCount: number } }
  const reg = (await (await fetch(`${BASE}/reports/severance-register`, { headers: auth })).json()) as SevRegister;
  const ourSev = reg.rows.find((r) => r.id === sevId);
  check('severance-register includes the new calculation', !!ourSev, `rows=${reg.rows.length}`);
  check('severance-register: row exposes PAYE status and a provisional flag',
    !!ourSev && typeof ourSev.payeStatus === 'string' && typeof ourSev.provisional === 'boolean', JSON.stringify(ourSev));
  check('severance-register: provisionalCount equals the count of flagged rows (flag not lost in a total)',
    reg.totals.provisionalCount === reg.rows.filter((r) => r.provisional).length, `count=${reg.totals.provisionalCount}`);
  check('severance-register: total severance = sum of row amounts (internal identity)',
    near(reg.totals.totalSeverance, reg.rows.reduce((t, r) => t + r.severanceAmount, 0)), String(reg.totals.totalSeverance));

  // ── Adjustments register ── (previously unexercised by any verify script —
  // the route is live and mapped, but nothing called it end-to-end.)
  const bonusRes = await fetch(`${BASE}/employees/${employeeId}/payroll-adjustments`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ type: 'BONUS', amount: 5000, reason: 'Report gate bonus', targetPeriodMonth: MONTH, targetPeriodYear: YEAR }),
  });
  const bonusId = ((await bonusRes.json()) as { id?: string }).id;
  if (!bonusId) { console.log('  FAIL  adjustment create (bonus, reports)'); process.exit(1); }

  const deductionRes = await fetch(`${BASE}/employees/${employeeId}/payroll-adjustments`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ type: 'DEDUCTION', amount: 2000, reason: 'Report gate deduction (to be cancelled)', targetPeriodMonth: MONTH, targetPeriodYear: YEAR }),
  });
  const deductionId = ((await deductionRes.json()) as { id?: string }).id;
  if (!deductionId) { console.log('  FAIL  adjustment create (deduction, reports)'); process.exit(1); }
  // Cancel it so the register's "totals exclude CANCELLED but byStatus still
  // counts it" behaviour (buildAdjustmentsRegister) has something real to check.
  await fetch(`${BASE}/payroll-adjustments/${deductionId}/cancel`, { method: 'PATCH', headers: auth });

  interface AdjRow { id: string; employeeId: string; type: string; amount: number; status: string; targetPeriodMonth: number; targetPeriodYear: number }
  interface AdjRegister { rows: AdjRow[]; totals: { count: number; totalBonuses: number; totalDeductions: number; byStatus: Record<string, number> } }

  const adjReg = (await (await fetch(`${BASE}/reports/adjustments-register`, { headers: auth })).json()) as AdjRegister;
  const ourBonus = adjReg.rows.find((r) => r.id === bonusId);
  const ourDeduction = adjReg.rows.find((r) => r.id === deductionId);
  check('adjustments-register includes the new bonus', !!ourBonus, `rows=${adjReg.rows.length}`);
  check('adjustments-register includes the cancelled deduction (rows keep it, they don\'t drop it)', !!ourDeduction, `rows=${adjReg.rows.length}`);
  check('adjustments-register: the cancelled row reads CANCELLED', ourDeduction?.status === 'CANCELLED', String(ourDeduction?.status));
  check('adjustments-register: totalBonuses = sum of non-cancelled BONUS rows (internal identity)',
    near(adjReg.totals.totalBonuses, adjReg.rows.filter((r) => r.type === 'BONUS' && r.status !== 'CANCELLED').reduce((t, r) => t + r.amount, 0)),
    String(adjReg.totals.totalBonuses));
  check('adjustments-register: a CANCELLED deduction is excluded from totalDeductions (not silently included)',
    !adjReg.rows.filter((r) => r.type === 'DEDUCTION' && r.status !== 'CANCELLED').some((r) => r.id === deductionId)
      && near(adjReg.totals.totalDeductions, adjReg.rows.filter((r) => r.type === 'DEDUCTION' && r.status !== 'CANCELLED').reduce((t, r) => t + r.amount, 0)),
    String(adjReg.totals.totalDeductions));
  check('adjustments-register: byStatus still counts the cancelled row (flag not lost in a total)',
    (adjReg.totals.byStatus.CANCELLED ?? 0) >= 1, JSON.stringify(adjReg.totals.byStatus));
  check('adjustments-register: count = rows.length (internal identity)', adjReg.totals.count === adjReg.rows.length, String(adjReg.totals.count));

  const adjByEmp = (await (await fetch(`${BASE}/reports/adjustments-register?employeeId=${employeeId}`, { headers: auth })).json()) as AdjRegister;
  check('adjustments-register filter by employee returns only that employee (and both our rows)',
    adjByEmp.rows.length > 0 && adjByEmp.rows.every((r) => r.employeeId === employeeId)
      && adjByEmp.rows.some((r) => r.id === bonusId) && adjByEmp.rows.some((r) => r.id === deductionId),
    `rows=${adjByEmp.rows.length}`);
  const adjPendingOnly = (await (await fetch(`${BASE}/reports/adjustments-register?status=PENDING`, { headers: auth })).json()) as AdjRegister;
  check('adjustments-register filter by status=PENDING excludes our CANCELLED deduction', !adjPendingOnly.rows.some((r) => r.id === deductionId));
  check('adjustments-register filter by status=PENDING still includes our BONUS', adjPendingOnly.rows.some((r) => r.id === bonusId));

  // PDFs for the three new reports (no period params)
  for (const path of ['loan-book', 'severance-register', 'adjustments-register'] as const) {
    const res = await fetch(`${BASE}/reports/${path}/pdf`, { headers: auth });
    const bytes = Buffer.from(await res.arrayBuffer());
    check(`${path} PDF downloads as a valid file`,
      res.status === 200 && bytes.subarray(0, 4).toString('latin1') === '%PDF' && bytes.length > 1000,
      `status=${res.status} bytes=${bytes.length}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
