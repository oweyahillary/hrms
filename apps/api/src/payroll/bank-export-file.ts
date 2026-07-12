import ExcelJS from 'exceljs';

/**
 * Pure builders for a bank salary-payment file. No DB, no Nest — they take
 * already-resolved rows and return a string (CSV) or Buffer (XLSX), so they are
 * fully unit-testable. Columns cover same-bank uploads (account no + name +
 * amount) and grow into interbank (bank/branch codes) when those are present.
 */
export interface BankPaymentRow {
  employeeNumber: string;
  accountName: string;
  accountNumber: string;
  bankName?: string | null;
  bankCode?: string | null;
  bankBranchCode?: string | null;
  amount: number;
  narration: string;
  email?: string | null;
}

/** Employer-level fields the bank EFT/RTGS template requires. */
export interface EmployerPaymentInfo {
  debitAccount: string;
  purposeCode: string;
}

/** Amounts at/above this use RTGS; below it use ACH (EFT). */
export const RTGS_THRESHOLD = 1_000_000;

const HEADERS = [
  'Employee No', 'Account Name', 'Account Number', 'Bank Name',
  'Bank Code', 'Branch Code', 'Amount', 'Narration',
];

// RFC 4180: quote a field only if it contains a comma, quote, or newline.
function csvField(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildSalaryCsv(rows: BankPaymentRow[]): string {
  const lines = [HEADERS.map(csvField).join(',')];
  for (const r of rows) {
    lines.push([
      r.employeeNumber, r.accountName, r.accountNumber, r.bankName,
      r.bankCode, r.bankBranchCode, r.amount.toFixed(2), r.narration,
    ].map(csvField).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export async function buildSalaryXlsx(rows: BankPaymentRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Salary Payments');
  ws.columns = [
    { header: HEADERS[0], key: 'employeeNumber', width: 14 },
    { header: HEADERS[1], key: 'accountName', width: 28 },
    { header: HEADERS[2], key: 'accountNumber', width: 20 },
    { header: HEADERS[3], key: 'bankName', width: 20 },
    { header: HEADERS[4], key: 'bankCode', width: 12 },
    { header: HEADERS[5], key: 'bankBranchCode', width: 12 },
    { header: HEADERS[6], key: 'amount', width: 14 },
    { header: HEADERS[7], key: 'narration', width: 26 },
  ];
  ws.getRow(1).font = { name: 'Arial', bold: true };

  // Keep account/bank/branch codes as TEXT so Excel never strips leading zeros
  // or renders them in scientific notation.
  ws.getColumn('accountNumber').numFmt = '@';
  ws.getColumn('bankCode').numFmt = '@';
  ws.getColumn('bankBranchCode').numFmt = '@';

  for (const r of rows) {
    const row = ws.addRow({
      employeeNumber: r.employeeNumber,
      accountName: r.accountName,
      accountNumber: r.accountNumber,
      bankName: r.bankName ?? '',
      bankCode: r.bankCode ?? '',
      bankBranchCode: r.bankBranchCode ?? '',
      amount: Number(r.amount.toFixed(2)),
      narration: r.narration,
    });
    row.font = { name: 'Arial' };
  }
  ws.getColumn('amount').numFmt = '#,##0.00';

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Bank EFT/RTGS bulk layout — matches the bank's "Bulk EFT/RTGS" template.
// Columns (exact order): Beneficiary Name, Beneficiary Account Number, Bank
// Code, Branch Code, Amount, Payment Currency, Payment Type, Debit Account
// Number, Purpose of payments, Notes to Payee, Email Address.
// ---------------------------------------------------------------------------
const EFT_HEADERS = [
  'Beneficiary Name', 'Beneficiary Account Number', 'Bank Code', 'Branch Code',
  'Amount', 'Payment Currency', 'Payment Type', 'Debit Account Number',
  'Purpose of payments', 'Notes to Payee', 'Email Address',
];

function paymentType(amount: number): 'ACH' | 'RTGS' {
  return amount >= RTGS_THRESHOLD ? 'RTGS' : 'ACH';
}

function eftValues(r: BankPaymentRow, emp: EmployerPaymentInfo): Array<string | number | null> {
  return [
    r.accountName,
    r.accountNumber,
    r.bankCode ?? '',
    r.bankBranchCode ?? '',
    r.amount, // numeric in xlsx; formatted for csv below
    'KES',
    paymentType(r.amount),
    emp.debitAccount,
    emp.purposeCode,
    r.narration,
    r.email ?? '',
  ];
}

export function buildEftCsv(rows: BankPaymentRow[], emp: EmployerPaymentInfo): string {
  const lines = [EFT_HEADERS.map(csvField).join(',')];
  for (const r of rows) {
    const v = eftValues(r, emp);
    v[4] = r.amount.toFixed(2); // amount as fixed-2 string in CSV
    lines.push(v.map(csvField).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export async function buildEftXlsx(rows: BankPaymentRow[], emp: EmployerPaymentInfo): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bulk Payments');
  ws.columns = EFT_HEADERS.map((h) => ({ header: h, width: h.length + 6 }));
  ws.getRow(1).font = { name: 'Arial', bold: true };

  // Text columns (1-based): account no(2), bank code(3), branch(4), debit acct(8),
  // purpose(9) — keep as text so leading zeros / codes survive.
  for (const c of [2, 3, 4, 8, 9]) ws.getColumn(c).numFmt = '@';

  for (const r of rows) {
    const row = ws.addRow(eftValues(r, emp));
    row.font = { name: 'Arial' };
  }
  ws.getColumn(5).numFmt = '#,##0.00'; // Amount

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
