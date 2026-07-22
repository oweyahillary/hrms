/**
 * Demo data for exercising the payroll UI (salary revisions, loans & advances,
 * deductions/bonuses, and the loan-book / severance-register reports).
 *
 * Drives the real HTTP API (like the verify-*.ts gates) so everything goes
 * through validation and tenant-scoping — the API must be running and seeded
 * with the admin login first:
 *
 *   cd apps/api
 *   npm run seed            # admin@example.com / ChangeMe123!  (if not already)
 *   npx ts-node scripts/seed-demo.ts
 *
 * Safe to run more than once: employee numbers/national IDs are stamped unique,
 * so each run adds five fresh people rather than colliding.
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const stamp = Date.now().toString().slice(-6);
let nid = 10;

let ok = 0;
let warn = 0;
function good(label: string): void { console.log(`  OK    ${label}`); ok += 1; }
function bad(label: string, detail: string): void { console.log(`  WARN  ${label} — ${detail}`); warn += 1; }

interface Structure { basic: number; date: string; reason: string; house?: number }
interface LoanSpec { type: 'LOAN' | 'ADVANCE'; principal: number; installments: number; interest?: number; reason: string; cancel?: boolean }
interface AdjSpec { type: 'BONUS' | 'DEDUCTION'; amount: number; isTaxable?: boolean; reason: string; month: number; year: number }
interface Person {
  first: string; last: string; hire: string;
  structures: Structure[];
  loans?: LoanSpec[];
  adjustments?: AdjSpec[];
  severance?: { exitDate: string; reason: string; contractTermType: 'FIXED_TERM' | 'UNSPECIFIED_WITH_CLAUSE' | 'NO_PROVISION'; unexpiredTermMonths?: number };
}

const soon = new Date();
const M = soon.getMonth() + 1;
const Y = soon.getFullYear();

const PEOPLE: Person[] = [
  {
    first: 'Grace', last: 'Wanjiku', hire: '2021-02-01',
    structures: [
      { basic: 55000, date: '2021-02-01', reason: 'Initial offer', house: 10000 },
      { basic: 62000, date: '2022-07-01', reason: 'Annual review', house: 12000 },
      { basic: 78000, date: '2024-01-01', reason: 'Promotion to Senior Accountant', house: 15000 },
    ],
    loans: [{ type: 'LOAN', principal: 120000, installments: 12, interest: 5, reason: 'Emergency medical loan' }],
    adjustments: [{ type: 'DEDUCTION', amount: 3000, reason: 'Staff shop purchase', month: M, year: Y }],
  },
  {
    first: 'Brian', last: 'Otieno', hire: '2020-06-15',
    structures: [
      { basic: 90000, date: '2020-06-15', reason: 'Initial offer', house: 20000 },
      { basic: 105000, date: '2023-01-01', reason: 'Market adjustment', house: 25000 },
    ],
    loans: [{ type: 'ADVANCE', principal: 40000, installments: 2, reason: 'Salary advance — school fees' }],
    adjustments: [{ type: 'BONUS', amount: 25000, isTaxable: true, reason: 'Q4 performance bonus', month: M, year: Y }],
  },
  {
    first: 'Aisha', last: 'Mohammed', hire: '2022-09-01',
    structures: [
      { basic: 48000, date: '2022-09-01', reason: 'Initial offer', house: 8000 },
    ],
    loans: [
      { type: 'LOAN', principal: 60000, installments: 6, interest: 10, reason: 'Personal loan' },
      { type: 'LOAN', principal: 15000, installments: 3, reason: 'Cancelled — issued in error', cancel: true },
    ],
  },
  {
    first: 'David', last: 'Kimani', hire: '2018-04-01',
    structures: [
      { basic: 70000, date: '2018-04-01', reason: 'Initial offer', house: 15000 },
      { basic: 85000, date: '2021-04-01', reason: 'Annual review', house: 18000 },
    ],
    adjustments: [{ type: 'DEDUCTION', amount: 5000, reason: 'SACCO contribution', month: M, year: Y }],
    severance: { exitDate: `${Y}-06-30`, reason: 'REDUNDANCY', contractTermType: 'UNSPECIFIED_WITH_CLAUSE' },
  },
  {
    first: 'Faith', last: 'Chebet', hire: '2019-11-01',
    structures: [
      { basic: 52000, date: '2019-11-01', reason: 'Initial offer', house: 9000 },
      { basic: 58000, date: '2023-03-01', reason: 'Annual review', house: 11000 },
    ],
    loans: [{ type: 'ADVANCE', principal: 30000, installments: 1, reason: 'One-off advance' }],
    severance: { exitDate: `${Y}-03-31`, reason: 'REDUNDANCY', contractTermType: 'FIXED_TERM', unexpiredTermMonths: 8 },
  },
];

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) {
    console.log('  FAIL  login — is the API running and seeded? (npm run seed)');
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };

  const post = async (path: string, body: unknown): Promise<{ id?: string; message?: unknown }> => {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: authJson, body: JSON.stringify(body) });
    return (await res.json()) as { id?: string; message?: unknown };
  };

  for (const p of PEOPLE) {
    const emp = await post('/employees', {
      employeeNumber: `DEMO-${stamp}-${nid}`,
      firstName: p.first, lastName: p.last,
      nationalId: `${stamp}${nid}`,
      employmentType: 'PERMANENT', hireDate: p.hire,
    });
    nid += 1;
    if (!emp.id) { bad(`create ${p.first} ${p.last}`, JSON.stringify(emp.message)); continue; }
    good(`${p.first} ${p.last}`);
    const id = emp.id;

    // Salary structures oldest-first so each new one auto-closes the previous.
    for (const s of p.structures) {
      const body: Record<string, unknown> = { basicSalary: s.basic, effectiveDate: s.date, reason: s.reason };
      if (s.house) body.components = [{ componentType: 'ALLOWANCE', name: 'House allowance', amount: s.house, isTaxable: true }];
      const r = await post(`/employees/${id}/salary-structures`, body);
      if (r.id) good(`  salary ${s.date} — ${s.reason}`); else bad(`  salary ${s.date}`, JSON.stringify(r.message));
    }

    for (const l of p.loans ?? []) {
      const r = await post(`/employees/${id}/loans`, {
        type: l.type, principal: l.principal, interestRate: l.interest ?? 0,
        numberOfInstallments: l.installments, disbursedDate: p.hire, reason: l.reason,
      });
      if (r.id) {
        good(`  ${l.type.toLowerCase()} ${l.principal}`);
        if (l.cancel) {
          const c = await fetch(`${BASE}/loans/${r.id}/cancel`, { method: 'PATCH', headers: auth });
          if (c.ok) good('    (cancelled)'); else bad('    cancel', String(c.status));
        }
      } else {
        bad(`  ${l.type.toLowerCase()} ${l.principal}`, JSON.stringify(r.message));
      }
    }

    for (const a of p.adjustments ?? []) {
      const r = await post(`/employees/${id}/payroll-adjustments`, {
        type: a.type, amount: a.amount, isTaxable: a.isTaxable,
        reason: a.reason, targetPeriodMonth: a.month, targetPeriodYear: a.year,
      });
      if (r.id) good(`  ${a.type.toLowerCase()} ${a.amount}`); else bad(`  ${a.type.toLowerCase()} ${a.amount}`, JSON.stringify(r.message));
    }

    if (p.severance) {
      const r = await post(`/employees/${id}/severance-calculations`, {
        reason: p.severance.reason, exitDate: p.severance.exitDate, payFrequency: 'MONTHLY',
        contractTermType: p.severance.contractTermType, unexpiredTermMonths: p.severance.unexpiredTermMonths,
      });
      if (r.id) good(`  severance (${p.severance.reason})`); else bad('  severance', JSON.stringify(r.message));
    }
  }

  console.log(`\n  Done: ${ok} created, ${warn} skipped/warned.`);
  console.log('  Open an employee\u2019s page for the Salary section, and Payroll \u2192 Setup / Reports for the rest.');
  process.exit(0);
}

main().catch((e) => { console.error('seed-demo error:', (e as Error).message); process.exit(1); });
