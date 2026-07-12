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
      basicSalary: 80000, effectiveDate: '2026-01-01',
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

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
