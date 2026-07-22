/**
 * Prove the KRA P10 Section B export over HTTP. After finalizing a run for an
 * employee whose structure mixes a TAXABLE housing allowance with a NON-TAXABLE
 * per-diem, the import CSV must:
 *   - have exactly 24 fields in the canonical iTax order
 *   - carry the decrypted PIN, name, and the Resident/Primary defaults
 *   - place basic + the taxable housing allowance in their columns, and EXCLUDE
 *     the non-taxable per-diem (so cash pay = taxable basis, not gross)
 *   - map pension (NSSF) to Actual Contribution and our PAYE to Self-Assessed PAYE,
 *     matching the period's payroll summary
 *   - come back empty for a period with no finalized run
 * Assertions are relational, so the gate is independent of statutory rates.
 *
 *   cd apps/api && npx ts-node scripts/verify-p10.ts
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const YEAR = 2097;
const MONTH = 4;
const PIN = 'A123456789Z';
const BASIC = 60000;
const HOUSING = 15000;      // taxable
const PERDIEM = 8000;       // NON-taxable — must be excluded from Section B

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

/** Minimal RFC-4180 line parser (handles quoted commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i += 1; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

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
      employeeNumber: `P10-${stamp}`, firstName: 'P10', lastName: 'Verify',
      nationalId: String(stamp).slice(-8), kraPin: PIN, employmentType: 'PERMANENT', hireDate: '2026-01-01',
    }),
  });
  const employeeId = ((await empRes.json()) as { id?: string }).id;
  if (!employeeId) { console.log('  FAIL  employee create'); process.exit(1); }

  await fetch(`${BASE}/employees/${employeeId}/salary-structures`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      basicSalary: BASIC, effectiveDate: '2026-01-01', reason: 'Salary revision',
      components: [
        { componentType: 'ALLOWANCE', name: 'House Allowance', amount: HOUSING, isTaxable: true },
        { componentType: 'ALLOWANCE', name: 'Per Diem', amount: PERDIEM, isTaxable: false },
      ],
    }),
  });
  const runRes = await fetch(`${BASE}/payroll/runs`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ periodMonth: MONTH, periodYear: YEAR, employeeIds: [employeeId] }),
  });
  const runId = ((await runRes.json()) as { id?: string }).id;
  if (!runId) { console.log('  FAIL  run create'); process.exit(1); }
  await fetch(`${BASE}/payroll/runs/${runId}/finalize?__skipPdf=true`, { method: 'POST', headers: auth });

  // Expected PAYE / NSSF for this single-employee period, from the payroll summary.
  const summary = (await (await fetch(`${BASE}/reports/payroll-summary?year=${YEAR}&month=${MONTH}`, { headers: auth })).json()) as {
    paye: number; nssf: { employee: number };
  };

  // The P10 Section B CSV.
  const res = await fetch(`${BASE}/payroll/p10?year=${YEAR}&month=${MONTH}`, { headers: auth });
  const text = (await res.text()).replace(/\r\n$/, '');
  const lines = text.split('\r\n').filter((l) => l.length > 0);
  check('exactly one employee row', lines.length === 1, `rows=${lines.length}`);
  const f = parseCsvLine(lines[0] ?? '');

  check('row has 24 fields', f.length === 24, `fields=${f.length}`);
  check('field 1 is the decrypted PIN', f[0] === PIN, f[0]);
  check('field 2 is the employee name', f[1] === 'P10 Verify', f[1]);
  check('field 3/4 default to Resident / Primary Employee', f[2] === 'Resident' && f[3] === 'Primary Employee');
  check('field 5 is basic salary', near(Number(f[4]), BASIC), f[4]);
  check('field 6 is the taxable housing allowance', near(Number(f[5]), HOUSING), f[5]);
  check('non-taxable per-diem is excluded (transport & other are 0)',
    near(Number(f[6]), 0) && near(Number(f[11]), 0), `transport=${f[6]} other=${f[11]}`);
  const cashPay = Number(f[4]) + Number(f[5]) + Number(f[6]) + Number(f[11]);
  check('cash pay = taxable basis (basic + taxable allowances), per-diem NOT included',
    near(cashPay, BASIC + HOUSING), `cashPay=${cashPay} (expected ${BASIC + HOUSING}, gross would be ${BASIC + HOUSING + PERDIEM})`);
  check('field 15 is the housing-benefit default', f[14] === 'Benefit not given', f[14]);
  check('field 18 (Actual Contribution) = NSSF employee from the summary',
    near(Number(f[17]), summary.nssf.employee), `csv=${f[17]} summary=${summary.nssf.employee}`);
  check('field 21 (Monthly Personal Relief) is present (> 0)', Number(f[20]) > 0, f[20]);
  check('field 22 (Self-Assessed PAYE) = the period PAYE from the summary',
    near(Number(f[21]), summary.paye), `csv=${f[21]} summary=${summary.paye}`);
  check('field 24 (Value of Car Benefit) is 0', near(Number(f[23]), 0), f[23]);

  // Empty period → empty CSV.
  const empty = await (await fetch(`${BASE}/payroll/p10?year=${YEAR}&month=11`, { headers: auth })).text();
  check('a period with no finalized run returns an empty CSV', empty.trim().length === 0, `len=${empty.trim().length}`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
