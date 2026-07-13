/**
 * KRA P10 (employer PAYE return) — Section B "Details of Salary Paid and PAYE
 * deducted" CSV builder. Produces the exact 24-column IMPORT CSV that populates
 * the `B_Employees_Dtls` sheet of the official P10_Return.xlsm via its
 * "IMPORT CSV" button.
 *
 * The column ORDER below is the canonical iTax import order taken from the real
 * template's ValidationList (NOT the sheet's visual column order — e.g. "Value
 * of Car Benefit" is last in the CSV but mid-sheet visually). The spreadsheet
 * itself computes the derived columns (Total Cash Pay, Taxable Pay, Tax Payable,
 * PAYE); the CSV supplies only the input fields below.
 *
 * Verified against P10_Return-Version-22.0.0.xlsm.
 */

/** Canonical import column order (documentation + verification anchor). */
export const P10_SHEET_B_COLUMNS: readonly string[] = [
  'PIN of Employee',
  'Name of the Employee',
  'Residential Status',
  'Type of Employee',
  'Basic Salary',
  'Housing Allowance',
  'Transport Allowance',
  'Leave Pay',
  'Over Time Allowance',
  "Director's Fee",
  'Lump Sum Payment if any',
  'Other Allowance',
  'Other Non cash Benefits',
  'Global Income',
  'Type of Housing',
  'Rent of House',
  'Rent Recovered from Employee',
  'Actual Contribution',
  'Mortgage Interest',
  'Deposit on Home Ownership Saving Plan',
  'Monthly Personal Relief',
  'Self Assessed PAYE Tax',
  'Amount of Insurance Relief',
  'Value of Car Benefit',
];

export interface P10EmployeeInput {
  kraPin: string;
  name: string;
  residentialStatus?: 'Resident' | 'Non-Resident';
  typeOfEmployee?: 'Primary Employee' | 'Secondary Employee';
  basicSalary: number;
  housingAllowance?: number;
  transportAllowance?: number;
  leavePay?: number;
  overtimeAllowance?: number;
  directorsFee?: number;
  lumpSum?: number;
  otherAllowance?: number;
  otherNonCashBenefits?: number;
  globalIncome?: number;
  typeOfHousing?: string;
  rentOfHouse?: number;
  rentRecovered?: number;
  actualContribution?: number; // pension / NSSF (the deductible retirement contribution)
  mortgageInterest?: number;
  hospDeposit?: number;
  monthlyPersonalRelief: number;
  selfAssessedPaye: number;
  insuranceRelief?: number;
  valueOfCarBenefit?: number;
}

const n = (v: number | undefined): string => {
  const x = Number(v ?? 0);
  if (!Number.isFinite(x)) return '0';
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
};

/** RFC-4180 style escaping: quote when the field has comma, quote, CR or LF. */
const esc = (s: string): string =>
  /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

function rowToFields(r: P10EmployeeInput): string[] {
  return [
    esc(r.kraPin ?? ''),
    esc(r.name ?? ''),
    r.residentialStatus ?? 'Resident',
    r.typeOfEmployee ?? 'Primary Employee',
    n(r.basicSalary),
    n(r.housingAllowance),
    n(r.transportAllowance),
    n(r.leavePay),
    n(r.overtimeAllowance),
    n(r.directorsFee),
    n(r.lumpSum),
    n(r.otherAllowance),
    n(r.otherNonCashBenefits),
    n(r.globalIncome),
    esc(r.typeOfHousing ?? 'Benefit not given'),
    n(r.rentOfHouse),
    n(r.rentRecovered),
    n(r.actualContribution),
    n(r.mortgageInterest),
    n(r.hospDeposit),
    n(r.monthlyPersonalRelief),
    n(r.selfAssessedPaye),
    n(r.insuranceRelief),
    n(r.valueOfCarBenefit),
  ];
}

/**
 * Build the Section B import CSV (data rows only — no header, as iTax's
 * IMPORT CSV maps positionally and would treat a header as a data row).
 * Lines are CRLF-terminated per CSV convention.
 */
export function buildP10SheetBCsv(rows: P10EmployeeInput[]): string {
  return rows.map((r) => rowToFields(r).join(',')).join('\r\n');
}
