/**
 * Prove leave auto-accrual over HTTP. Creates three leave types (MONTHLY,
 * UPFRONT, DAILY) and three employees at different hire dates, runs accrual for
 * a fixed period, and asserts each balance lands on the method's formula:
 *   - full-year employee, through June (month 6) of non-leap 2097:
 *       MONTHLY 12/yr → 6.0   UPFRONT 12/yr → 12.0   DAILY 365/yr → 181 (days Jan1–Jun30)
 *   - mid-year joiner hired Apr 10:
 *       MONTHLY → 3.0 (Apr–Jun)   UPFRONT → 9.0 (9/12)   DAILY → 82 (Apr10–Jun30)
 *   - joiner hired after the period (Sep) → no balance created
 * Then re-runs to prove idempotency, and advances a month to prove progression.
 *
 *   cd apps/api && npx ts-node scripts/verify-leave-accrual.ts
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const YEAR = 2097; // non-leap (365 days)

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

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

  const mkType = async (name: string, accrualMethod: string, annualDays: number): Promise<string> => {
    const r = await fetch(`${BASE}/leave-types`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ name: `${name}-${stamp}`, accrualMethod, annualDays }),
    });
    return ((await r.json()) as { id?: string }).id ?? '';
  };
  const monthlyType = await mkType('LA-Monthly', 'MONTHLY', 12);
  const upfrontType = await mkType('LA-Upfront', 'UPFRONT', 12);
  const dailyType = await mkType('LA-Daily', 'DAILY', 365);
  if (!monthlyType || !upfrontType || !dailyType) { console.log('  FAIL  leave type create'); process.exit(1); }

  const mkEmp = async (tag: string, hireDate: string): Promise<string> => {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeNumber: `LA-${tag}-${stamp}`, firstName: 'LA', lastName: tag,
        nationalId: String(stamp).slice(-7) + tag.length, employmentType: 'PERMANENT', hireDate,
      }),
    });
    return ((await r.json()) as { id?: string }).id ?? '';
  };
  const empFull = await mkEmp('Full', '2020-01-01');       // full-year
  const empMid = await mkEmp('Mid', `${YEAR}-04-10`);      // joins Apr 10
  const empLate = await mkEmp('Late', `${YEAR}-09-01`);    // joins after the run month
  if (!empFull || !empMid || !empLate) { console.log('  FAIL  employee create'); process.exit(1); }

  const runAccrual = async (month: number) =>
    (await (await fetch(`${BASE}/leave/accrual/run`, {
      method: 'POST', headers: authJson, body: JSON.stringify({ year: YEAR, month }),
    })).json()) as { created: number; updated: number; unchanged: number };

  const balanceFor = async (employeeId: string, leaveTypeId: string): Promise<number | null> => {
    const rows = (await (await fetch(`${BASE}/leave-balances?employeeId=${employeeId}&year=${YEAR}`, { headers: auth })).json()) as
      Array<{ leaveTypeId: string; accruedDays: number }>;
    const row = rows.find((r) => r.leaveTypeId === leaveTypeId);
    return row ? Number(row.accruedDays) : null;
  };

  // Accrue through June.
  await runAccrual(6);

  // Full-year employee — one assertion per method.
  check('MONTHLY: full-year through June = 6.0', near((await balanceFor(empFull, monthlyType)) ?? -1, 6));
  check('UPFRONT: full-year = full 12.0', near((await balanceFor(empFull, upfrontType)) ?? -1, 12));
  check('DAILY: full-year through June = 181 (Jan1–Jun30)', near((await balanceFor(empFull, dailyType)) ?? -1, 181));

  // Mid-year joiner (hired Apr 10) — pro-rated per method.
  check('MONTHLY: joiner Apr–Jun = 3.0', near((await balanceFor(empMid, monthlyType)) ?? -1, 3));
  check('UPFRONT: joiner = 9/12 of 12 = 9.0', near((await balanceFor(empMid, upfrontType)) ?? -1, 9));
  check('DAILY: joiner Apr10–Jun30 = 82', near((await balanceFor(empMid, dailyType)) ?? -1, 82));

  // Not yet hired within the period → no balance rows.
  const lateRows = (await (await fetch(`${BASE}/leave-balances?employeeId=${empLate}&year=${YEAR}`, { headers: auth })).json()) as unknown[];
  check('joiner hired after the period has no accrual rows', lateRows.length === 0, `rows=${lateRows.length}`);

  // Idempotency: re-run June — the balances we just checked must not change.
  const before = await balanceFor(empFull, monthlyType);
  await runAccrual(6);
  const after = await balanceFor(empFull, monthlyType);
  check('idempotent: re-running the same period does not change a balance', before === after, `${before} → ${after}`);

  // Progression: advance to July — MONTHLY full-year should tick 6 → 7.
  await runAccrual(7);
  check('progression: July run raises MONTHLY full-year to 7.0', near((await balanceFor(empFull, monthlyType)) ?? -1, 7));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
