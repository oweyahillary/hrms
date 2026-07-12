/**
 * Prove the payslip PDF path end-to-end over HTTP: a finalized run auto-renders
 * its payslip PDF, generation is idempotent, and the PDF downloads as a valid
 * file. Intended for the ephemeral CI database — it creates and finalizes a run
 * (which, being finalized, is immutable and cannot be cleaned up).
 *
 *   cd apps/api && npx ts-node scripts/verify-payslip-pdf.ts
 *
 * Requires the API to be running (BASE_URL, default http://localhost:3000/api).
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
  // 1. Authenticate.
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) {
    console.log('  FAIL  login — no access token');
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };

  // 2. Create an employee + salary structure for an unused period.
  const stamp = Date.now();
  const nid = String(stamp).slice(-8);
  const empRes = await fetch(`${BASE}/employees`, {
    method: 'POST',
    headers: authJson,
    body: JSON.stringify({
      employeeNumber: `PDF-${stamp}`, firstName: 'PDF', lastName: 'Verify',
      nationalId: nid, employmentType: 'PERMANENT', hireDate: '2026-01-01',
    }),
  });
  const employeeId = ((await empRes.json()) as { id?: string }).id;
  if (!employeeId) { console.log('  FAIL  employee create'); process.exit(1); }

  await fetch(`${BASE}/employees/${employeeId}/salary-structures`, {
    method: 'POST',
    headers: authJson,
    body: JSON.stringify({
      basicSalary: 90000, effectiveDate: '2026-01-01',
      components: [{ componentType: 'ALLOWANCE', name: 'House', amount: 15000, isTaxable: true }],
    }),
  });

  const runRes = await fetch(`${BASE}/payroll/runs`, {
    method: 'POST',
    headers: authJson,
    body: JSON.stringify({ periodMonth: 6, periodYear: 2031, employeeIds: [employeeId] }),
  });
  const runId = ((await runRes.json()) as { id?: string }).id;
  if (!runId) { console.log('  FAIL  run create'); process.exit(1); }

  // 3. Finalize (auto-generates PDFs, best-effort, after commit).
  const finRes = await fetch(`${BASE}/payroll/runs/${runId}/finalize`, { method: 'POST', headers: auth });
  const finalized = (await finRes.json()) as {
    pdfStatus?: { ready?: number; total?: number };
    payslips?: Array<{ id?: string }>;
  };
  const finReady = finalized.pdfStatus?.ready ?? 0;
  const finTotal = finalized.pdfStatus?.total ?? 0;
  check('finalize auto-generated the payslip PDF (ready == total >= 1)',
    finTotal >= 1 && finReady === finTotal, `ready=${finReady} total=${finTotal}`);

  const payslipId = finalized.payslips?.[0]?.id;
  if (!payslipId) { console.log('  FAIL  no payslip on finalized run'); process.exit(1); }

  // 4. Idempotent generate: re-running renders nothing new, reports all ready.
  const genRes = await fetch(`${BASE}/payroll/runs/${runId}/payslips/pdf`, { method: 'POST', headers: auth });
  const gen = (await genRes.json()) as { total?: number; ready?: number; failed?: number };
  check('generate-missing is idempotent (ready == total, failed == 0)',
    (gen.total ?? 0) >= 1 && gen.ready === gen.total && gen.failed === 0,
    `total=${gen.total} ready=${gen.ready} failed=${gen.failed}`);

  // 5. Download returns a valid PDF.
  const dl = await fetch(`${BASE}/payroll/runs/${runId}/payslips/${payslipId}/pdf`, { headers: auth });
  const bytes = Buffer.from(await dl.arrayBuffer());
  const isPdf = bytes.subarray(0, 4).toString('latin1') === '%PDF';
  check('download returns a valid, non-trivial PDF',
    dl.status === 200 && isPdf && bytes.length > 800,
    `status=${dl.status} magic=${bytes.subarray(0, 4).toString('latin1')} bytes=${bytes.length}`);

  // 6. Content-Type is application/pdf.
  check('download Content-Type is application/pdf',
    (dl.headers.get('content-type') ?? '').includes('application/pdf'),
    dl.headers.get('content-type') ?? 'none');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
