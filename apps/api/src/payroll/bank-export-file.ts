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
}

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
