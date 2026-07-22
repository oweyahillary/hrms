/**
 * Prove the bank-export path end-to-end over HTTP: both the generic salary
 * layout and the bank EFT/RTGS template (File 1) generate, the EFT template is
 * rejected until the employer debit account is configured, and the downloaded
 * files parse back correctly (CSV headers/rows, and the XLSX via exceljs with
 * the 11-column EFT header exact and the amount cell numeric).
 *
 *   cd apps/api && npx ts-node scripts/verify-bank-export.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Creates and finalizes its own run on the ephemeral CI database.
 */
import 'dotenv/config';
import ExcelJS from 'exceljs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

const EFT_HEADERS = [
  'Beneficiary Name', 'Beneficiary Account Number', 'Bank Code', 'Branch Code',
  'Amount', 'Payment Currency', 'Payment Type', 'Debit Account Number',
  'Purpose of payments', 'Notes to Payee', 'Email Address',
];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

async function main(): Promise<void> {
  // 1. Authenticate.
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) { console.log('  FAIL  login — no access token'); process.exit(1); }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };

  // 2. Employee WITH bank details (so there is a payable row).
  const stamp = Date.now();
  const nid = String(stamp).slice(-8);
  const empRes = await fetch(`${BASE}/employees`, {
    method: 'POST',
    headers: authJson,
    body: JSON.stringify({
      employeeNumber: `BANK-${stamp}`, firstName: 'Bank', lastName: 'Verify',
      nationalId: nid, employmentType: 'PERMANENT', hireDate: '2026-01-01',
      email: 'bank@verify.co.ke', bankName: 'Equity Bank',
      bankAccountNumber: '0110123456789', bankCode: '68', bankBranchCode: '068000',
    }),
  });
  const employeeId = ((await empRes.json()) as { id?: string }).id;
  if (!employeeId) { console.log('  FAIL  employee create'); process.exit(1); }

  await fetch(`${BASE}/employees/${employeeId}/salary-structures`, {
    method: 'POST',
    headers: authJson,
    body: JSON.stringify({
      basicSalary: 80000, effectiveDate: '2026-01-01', reason: 'Salary revision',
      components: [{ componentType: 'ALLOWANCE', name: 'House', amount: 20000, isTaxable: true }],
    }),
  });

  const runRes = await fetch(`${BASE}/payroll/runs`, {
    method: 'POST',
    headers: authJson,
    body: JSON.stringify({ periodMonth: 7, periodYear: 2032, employeeIds: [employeeId] }),
  });
  const runId = ((await runRes.json()) as { id?: string }).id;
  if (!runId) { console.log('  FAIL  run create'); process.exit(1); }

  await fetch(`${BASE}/payroll/runs/${runId}/finalize?__skipPdf=true`, { method: 'POST', headers: auth });

  // 3. Negative: clear the employer debit account, EFT must be rejected (409).
  await fetch(`${BASE}/organization/branding`, {
    method: 'PATCH', headers: authJson,
    body: JSON.stringify({ bankAccountNumber: '', bankPurposeCode: '' }),
  });
  const noCfg = await fetch(`${BASE}/payroll/runs/${runId}/bank-export?template=eft&format=csv`, {
    method: 'POST', headers: auth,
  });
  check('EFT without employer debit account is rejected (409)', noCfg.status === 409, `status=${noCfg.status}`);

  // 4. Configure employer debit account + purpose code.
  await fetch(`${BASE}/organization/branding`, {
    method: 'PATCH', headers: authJson,
    body: JSON.stringify({ bankAccountNumber: '0100XXXXXX00', bankPurposeCode: '048' }),
  });

  // 5. Generic export — both formats.
  const genRes = await fetch(`${BASE}/payroll/runs/${runId}/bank-export?template=generic&format=both`, {
    method: 'POST', headers: auth,
  });
  const gen = (await genRes.json()) as { batches?: Array<{ id: string; format: string }>; included?: number };
  check('generic export: employee included, 2 batches',
    (gen.included ?? 0) >= 1 && (gen.batches?.length ?? 0) === 2,
    `included=${gen.included} batches=${gen.batches?.length}`);
  const genCsvId = gen.batches?.find((b) => b.format === 'CSV')?.id;
  const gcsv = await fetch(`${BASE}/payroll/runs/${runId}/bank-exports/${genCsvId}/download`, { headers: auth });
  const gcsvText = await gcsv.text();
  check('generic CSV: header + account row',
    gcsvText.includes('Employee No,Account Name') && gcsvText.includes('0110123456789'),
    (gcsvText.split('\r\n')[1] ?? '').slice(0, 60));

  // 6. EFT export — both formats.
  const eftRes = await fetch(`${BASE}/payroll/runs/${runId}/bank-export?template=eft&format=both`, {
    method: 'POST', headers: auth,
  });
  const eft = (await eftRes.json()) as {
    batches?: Array<{ id: string; format: string; template: string }>; template?: string;
  };
  check('EFT export: 2 batches, template EFT',
    (eft.batches?.length ?? 0) === 2 && eft.template === 'EFT',
    `batches=${eft.batches?.length} template=${eft.template}`);
  const eftCsvId = eft.batches?.find((b) => b.format === 'CSV')?.id;
  const eftXlsxId = eft.batches?.find((b) => b.format === 'XLSX')?.id;

  // 6a. EFT CSV — header matches File 1 exactly; row is ACH with debit + purpose.
  const ecsv = await fetch(`${BASE}/payroll/runs/${runId}/bank-exports/${eftCsvId}/download`, { headers: auth });
  const eLines = (await ecsv.text()).split('\r\n');
  check('EFT CSV: 11-column header matches File 1', eLines[0] === EFT_HEADERS.join(','), eLines[0] ?? '');
  check('EFT CSV: row is ACH with debit account + purpose code',
    (eLines[1] ?? '').includes(',KES,ACH,0100XXXXXX00,048,'), eLines[1] ?? '');

  // 6b. EFT XLSX — parse back with exceljs.
  const exl = await fetch(`${BASE}/payroll/runs/${runId}/bank-exports/${eftXlsxId}/download`, { headers: auth });
  const xbuf = Buffer.from(await exl.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xbuf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  const hdr = (ws.getRow(1).values as unknown as unknown[]).slice(1).map((v) => String(v));
  check('EFT XLSX: 11-column header matches File 1',
    JSON.stringify(hdr) === JSON.stringify(EFT_HEADERS), hdr.join('|'));
  const amountCell = ws.getRow(2).getCell(5).value;
  check('EFT XLSX: amount cell is numeric', typeof amountCell === 'number',
    `type=${typeof amountCell} value=${String(amountCell)}`);
  const acctCell = ws.getRow(2).getCell(2).value;
  check('EFT XLSX: account number preserved as text (leading zero intact)',
    String(acctCell) === '0110123456789', String(acctCell));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
