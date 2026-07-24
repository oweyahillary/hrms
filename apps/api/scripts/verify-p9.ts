/**
 * Prove the P9 (tax deduction card) path end-to-end over HTTP: an employee with
 * two finalized months yields a card whose PAYE reconciles to what was deducted,
 * whose column identities foot (J=E+F+G+H+I, K=D-J, O=L-M-N, totals=Σrows), and
 * whose PDF downloads as a valid file. Assertions are relational, not hardcoded,
 * so the gate is independent of the prevailing statutory rates.
 *
 *   cd apps/api && npx ts-node scripts/verify-p9.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Creates and finalizes its own runs on the ephemeral CI database.
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const YEAR = 2099; // unused period, avoids colliding with other fixtures

interface P9Row {
  month: number;
  A: number; B: number; C: number; D: number; E: number; F: number; G: number;
  H: number; I: number; J: number; K: number; L: number; M: number; N: number; O: number;
  reconciles: boolean;
}
interface P9Card {
  monthsIncluded: number;
  reconciles: boolean;
  employer: { name: string; kraPin: string };
  employee: { kraPin: string };
  rows: P9Row[];
  totals: Omit<P9Row, 'month' | 'reconciles'>;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

async function finalizeMonth(
  authJson: Record<string, string>, auth: Record<string, string>,
  employeeId: string, month: number,
): Promise<void> {
  const runRes = await fetch(`${BASE}/payroll/runs`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ periodMonth: month, periodYear: YEAR, employeeIds: [employeeId] }),
  });
  const runId = ((await runRes.json()) as { id?: string }).id;
  if (!runId) { console.log(`  FAIL  run create (month ${month})`); process.exit(1); }
  await fetch(`${BASE}/payroll/runs/${runId}/finalize?__skipPdf=true`, { method: 'POST', headers: auth });
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

  // Employee with a KRA PIN (P9 shows the decrypted PIN).
  const stamp = Date.now();
  const nid = String(stamp).slice(-8);
  const empRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      employeeNumber: `P9-${stamp}`, firstName: 'P9', lastName: 'Verify',
      nationalId: nid, kraPin: 'A123456789Z', employmentType: 'PERMANENT', hireDate: '2026-01-01',
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

  await finalizeMonth(authJson, auth, employeeId, 3);
  await finalizeMonth(authJson, auth, employeeId, 8);

  // Card
  const cardRes = await fetch(`${BASE}/employees/${employeeId}/p9?year=${YEAR}`, { headers: auth });
  const card = (await cardRes.json()) as P9Card;

  check('card includes both finalized months', card.monthsIncluded === 2, `monthsIncluded=${card.monthsIncluded}`);
  check('card-level reconciles is true', card.reconciles === true);
  check('employee KRA PIN is decrypted on the card', card.employee?.kraPin === 'A123456789Z', card.employee?.kraPin ?? '');

  const rowsOk = (card.rows ?? []).every((r) =>
    r.reconciles
    && near(r.J, r.E + r.F + r.G + r.H + r.I)
    && near(r.K, r.D - r.J)
    && near(r.O, Math.max(0, r.L - r.M - r.N)));
  check('every row reconciles and its column identities foot (J,K,O)', rowsOk);

  const t = card.totals;
  const sum = (k: keyof P9Row): number => (card.rows ?? []).reduce((s, r) => s + (r[k] as number), 0);
  const totalsOk = near(t.D, sum('D')) && near(t.O, sum('O')) && near(t.K, sum('K')) && near(t.J, sum('J'));
  check('totals equal the sum of the month rows', totalsOk,
    `D:${t.D}/${sum('D')} O:${t.O}/${sum('O')}`);

  // PDF
  const pdfRes = await fetch(`${BASE}/employees/${employeeId}/p9/pdf?year=${YEAR}`, { headers: auth });
  const bytes = Buffer.from(await pdfRes.arrayBuffer());
  const isPdf = bytes.subarray(0, 4).toString('latin1') === '%PDF';
  check('P9 PDF downloads as a valid, non-trivial file',
    pdfRes.status === 200 && isPdf && bytes.length > 1000,
    `status=${pdfRes.status} magic=${bytes.subarray(0, 4).toString('latin1')} bytes=${bytes.length}`);
  check('P9 PDF Content-Type is application/pdf',
    (pdfRes.headers.get('content-type') ?? '').includes('application/pdf'),
    pdfRes.headers.get('content-type') ?? 'none');

  // ------------------------------------------------------------------
  // Cross-tenant employer isolation: cardForEmployee() used to read
  // Organization.findFirst() with NO where clause — whichever org happened
  // to sort first stamped its name AND KRA PIN onto EVERY org's P9 card, a
  // statutory tax document. Prove the fix with a throwaway org B (zero
  // payroll data — cardForEmployee() resolves employer before touching any
  // payslips, so an employee with no salary/run history is enough), both
  // directions.
  // ------------------------------------------------------------------
  const brandingBefore = (await (await fetch(`${BASE}/organization/branding`, { headers: auth })).json()) as {
    name: string; kraPin: string | null;
  };
  const orgAName = brandingBefore.name;
  const orgAKraPin = 'P000000001A';
  await fetch(`${BASE}/organization/branding`, {
    method: 'PATCH', headers: authJson, body: JSON.stringify({ kraPin: orgAKraPin }),
  });

  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  const passwords = new PasswordService();
  const orgBName = `P9 Probe Co ${stamp}`;
  const orgBKraPin = 'Q000000002B';
  const orgB = await base.organization.create({ data: { name: orgBName, kraPin: orgBKraPin } });
  const roleB = await base.role.create({ data: { organizationId: orgB.id, name: 'Admin', permissions: { all: true } } });
  const orgBAdminEmail = `p9.b.admin.${stamp}@example.com`;
  const orgBAdminPassword = 'OrgBAdmin123!';
  const orgBAdminUser = await base.user.create({
    data: {
      organizationId: orgB.id, email: orgBAdminEmail,
      passwordHash: await passwords.hash(orgBAdminPassword),
      mustChangePassword: false, roleId: roleB.id,
    },
  });

  let empB: string | undefined;
  try {
    const loginB = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: orgBAdminEmail, password: orgBAdminPassword }),
    });
    const tokenB = ((await loginB.json()) as { accessToken?: string }).accessToken;
    if (!tokenB) { console.log('  FAIL  login as org B admin'); process.exit(1); }
    const authB = { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' };

    const empBRes = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authB,
      body: JSON.stringify({
        employeeNumber: `P9B-${stamp}`, firstName: 'P9Probe', lastName: 'B',
        nationalId: `${nid.slice(0, 7)}9`, employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    empB = ((await empBRes.json()) as { id?: string }).id;
    if (!empB) { console.log('  FAIL  org-B employee create'); process.exit(1); }

    const cardB = (await (await fetch(`${BASE}/employees/${empB}/p9?year=${YEAR}`, { headers: { Authorization: `Bearer ${tokenB}` } })).json()) as P9Card;
    check('org B\'s P9 card carries ITS OWN employer name', cardB.employer?.name === orgBName, cardB.employer?.name ?? 'undefined');
    check('org B\'s P9 card carries ITS OWN employer KRA PIN', cardB.employer?.kraPin === orgBKraPin, cardB.employer?.kraPin ?? 'undefined');
    check('org B\'s P9 card does NOT carry org A\'s employer name', cardB.employer?.name !== orgAName, cardB.employer?.name ?? 'undefined');

    // Bidirectional: org A's own card, re-fetched AFTER org B was created,
    // must still carry ITS OWN employer identity.
    const cardAAfter = (await (await fetch(`${BASE}/employees/${employeeId}/p9?year=${YEAR}`, { headers: auth })).json()) as P9Card;
    check('org A\'s P9 card still carries ITS OWN employer name after org B was created', cardAAfter.employer?.name === orgAName, cardAAfter.employer?.name ?? 'undefined');
    check('org A\'s P9 card still carries ITS OWN employer KRA PIN after org B was created', cardAAfter.employer?.kraPin === orgAKraPin, cardAAfter.employer?.kraPin ?? 'undefined');
  } finally {
    await fetch(`${BASE}/organization/branding`, {
      method: 'PATCH', headers: authJson, body: JSON.stringify({ kraPin: brandingBefore.kraPin ?? '' }),
    });
    // Organization itself is never deleted once real auth activity (a
    // login, here) has touched it — see verify-self-service.ts /
    // verify-attendance-ui.ts for the same rationale.
    await base.session.deleteMany({ where: { userId: orgBAdminUser.id } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgB.id } }).catch(() => undefined);
    if (empB) await base.employee.deleteMany({ where: { id: empB } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgB.id } }).catch(() => undefined);
    await (prisma as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
