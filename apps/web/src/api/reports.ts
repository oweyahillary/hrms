import { api, downloadFile } from './client';

export interface TrendMonth {
  month: number;
  employeesPaid: number;
  grossPay: number;
  paye: number;
  statutory: number;
  netPay: number;
}
export interface YearTrend {
  year: number;
  months: TrendMonth[];
  totals: { grossPay: number; paye: number; statutory: number; netPay: number };
}
export interface Headcount {
  total: number;
  active: number;
  byStatus: Record<string, number>;
  activeByDepartment: Array<{ department: string; activeCount: number }>;
}

export const getYearTrend = (year: number): Promise<YearTrend> =>
  api<YearTrend>(`/reports/year-trend?year=${year}`);

export const getHeadcount = (): Promise<Headcount> =>
  api<Headcount>('/reports/headcount');

export const getLeaveInboxCount = async (): Promise<number> => {
  const rows = await api<unknown[]>('/leave-requests/inbox');
  return Array.isArray(rows) ? rows.length : 0;
};

// -- Period summaries --------------------------------------------------------
export interface PayrollSummary {
  period: { year: number; month: number };
  runsFinalized: number;
  employeesPaid: number;
  grossPay: number;
  paye: number;
  nssf: { employee: number; employer: number; total: number };
  shif: number;
  ahl: { employee: number; employer: number; total: number };
  otherDeductions: number;
  netPay: number;
}
export interface StatutoryRemittance {
  period: { year: number; month: number };
  runsFinalized: number;
  employeesPaid: number;
  items: Array<{ levy: string; payTo: string; employee: number; employer: number; total: number }>;
  grandTotal: number;
}

export const getPayrollSummary = (year: number, month: number): Promise<PayrollSummary> =>
  api<PayrollSummary>(`/reports/payroll-summary?year=${year}&month=${month}`);

export const getStatutoryRemittance = (year: number, month: number): Promise<StatutoryRemittance> =>
  api<StatutoryRemittance>(`/reports/statutory-remittance?year=${year}&month=${month}`);

export const downloadPayrollSummaryPdf = (year: number, month: number): Promise<void> =>
  downloadFile(`/reports/payroll-summary/pdf?year=${year}&month=${month}`, `payroll-summary-${year}-${month}.pdf`);

export const downloadRemittancePdf = (year: number, month: number): Promise<void> =>
  downloadFile(`/reports/statutory-remittance/pdf?year=${year}&month=${month}`, `statutory-remittance-${year}-${month}.pdf`);

// -- Loan book ---------------------------------------------------------------
export interface LoanBookRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  type: string;
  status: string;
  principal: number;
  balance: number;
  installmentAmount: number;
  installmentsRemaining: number;
  nextDueAmount: number;
  disbursedDate: string;
  reason: string | null;
}
export interface LoanBook {
  filter: { employeeId: string | null; status: string | null };
  rows: LoanBookRow[];
  totals: { count: number; totalPrincipal: number; totalOutstanding: number; byStatus: Record<string, number> };
  generatedAt: string;
}

export interface LoanBookParams {
  employeeId?: string;
  status?: string;
}
function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return entries.length ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&')}` : '';
}

export const getLoanBook = (params: LoanBookParams = {}): Promise<LoanBook> =>
  api<LoanBook>(`/reports/loan-book${qs({ employeeId: params.employeeId, status: params.status })}`);

export const downloadLoanBookPdf = (params: LoanBookParams = {}): Promise<void> =>
  downloadFile(`/reports/loan-book/pdf${qs({ employeeId: params.employeeId, status: params.status })}`, 'loan-book.pdf');

// -- Severance register ------------------------------------------------------
export interface SeveranceRegisterRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  exitDate: string;
  reason: string;
  completedYears: number | null;
  severanceAmount: number;
  noticeDays: number;
  noticePayInLieu: number | null;
  payeStatus: string;
  provisional: boolean;
  bucket: string | null;
}
export interface SeveranceRegister {
  rows: SeveranceRegisterRow[];
  totals: { count: number; totalSeverance: number; totalNoticePayInLieu: number; provisionalCount: number };
  generatedAt: string;
}

export const getSeveranceRegister = (): Promise<SeveranceRegister> =>
  api<SeveranceRegister>('/reports/severance-register');

export const downloadSeveranceRegisterPdf = (): Promise<void> =>
  downloadFile('/reports/severance-register/pdf', 'severance-register.pdf');

// -- Adjustments register ----------------------------------------------------
export interface AdjustmentRegisterRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  type: string;
  amount: number;
  isTaxable: boolean;
  reason: string;
  targetPeriodMonth: number;
  targetPeriodYear: number;
  status: string;
}
export interface AdjustmentsRegister {
  filter: { employeeId: string | null; status: string | null; year: number | null; month: number | null };
  rows: AdjustmentRegisterRow[];
  totals: { count: number; totalBonuses: number; totalDeductions: number; byStatus: Record<string, number> };
  generatedAt: string;
}
export interface AdjustmentsRegisterParams {
  employeeId?: string;
  status?: string;
  year?: number;
  month?: number;
}
function adjustmentsQs(params: AdjustmentsRegisterParams): string {
  return qs({
    employeeId: params.employeeId,
    status: params.status,
    year: params.year != null ? String(params.year) : undefined,
    month: params.month != null ? String(params.month) : undefined,
  });
}

export const getAdjustmentsRegister = (params: AdjustmentsRegisterParams = {}): Promise<AdjustmentsRegister> =>
  api<AdjustmentsRegister>(`/reports/adjustments-register${adjustmentsQs(params)}`);

export const downloadAdjustmentsRegisterPdf = (params: AdjustmentsRegisterParams = {}): Promise<void> =>
  downloadFile(`/reports/adjustments-register/pdf${adjustmentsQs(params)}`, 'adjustments-register.pdf');

// -- P9 (per-employee annual tax deduction card) -----------------------------
export const downloadP9Pdf = (employeeId: string, year: number): Promise<void> =>
  downloadFile(`/employees/${employeeId}/p9/pdf?year=${year}`, `p9-${year}.pdf`);
