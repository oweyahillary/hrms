import { api, downloadFile } from './client';

export const PAYROLL_RUN_STATUSES = ['DRAFT', 'PROCESSING', 'FINALIZED', 'PAID'] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_RUN_TYPES = ['REGULAR', 'ADJUSTMENT'] as const;
export type PayrollRunType = (typeof PAYROLL_RUN_TYPES)[number];

/** Mirrors the payslip's pdfStatus column — PENDING until PDF render is attempted. */
export type PdfStatus = 'PENDING' | 'READY' | 'FAILED';

export interface PayrollRunListItem {
  id: string;
  periodMonth: number;
  periodYear: number;
  status: PayrollRunStatus;
  runType: PayrollRunType;
  correctsRunId: string | null;
  runDate: string;
  payslipCount: number;
}

export interface Payslip {
  id: string;
  employeeId: string;
  grossPay: number;
  paye: number;
  nssfEmployee: number;
  nssfEmployer: number;
  shif: number;
  ahlEmployee: number;
  ahlEmployer: number;
  otherDeductions: number;
  netPay: number;
  /** Take-home vs one-third of basic pay, the statutory test used to gate finalize. */
  oneThirdRulePass: boolean;
  /** A looser, gross-based version of the same test — informational only. */
  grossBasedOneThirdPass: boolean;
  pdfStatus: PdfStatus;
  /**
   * Itemized breakdown of otherDeductions attributable to loan/advance installments.
   * `amount` is what was deducted; `scheduledAmount` is what the installment
   * schedule wanted; `deferredAmount` (= scheduled - amount) is how much the
   * one-third floor held back, carried forward in the loan balance.
   */
  loanRepayments: Array<{ loanId: string; amount: number; scheduledAmount: number; deferredAmount: number }>;
  /** One-off bonuses/deductions this run consumed for this employee. */
  adjustments: Array<{ id: string; type: 'BONUS' | 'DEDUCTION'; amount: number; reason: string | null }>;
  /** Approved overtime entries this run consumed for this employee — folded into grossPay above, itemized here. */
  overtime: Array<{ id: string; date: string; hours: number; category: 'NORMAL_DAY' | 'REST_DAY' | 'HOLIDAY'; amount: number }>;
}

/** An employee who was targeted but had no effective salary structure for the period. */
export interface SkippedEmployee {
  employeeId: string;
  employeeNumber: string;
  reason: string;
}

export interface PayrollTotals {
  gross: number;
  paye: number;
  nssf: number;
  shif: number;
  ahl: number;
  net: number;
}

export interface PayrollRunDetail extends PayrollRunListItem {
  oneThirdFailureEmployeeIds: string[];
  pdfStatus: { ready: number; total: number };
  totals: PayrollTotals;
  payslips: Payslip[];
  /**
   * One-off deductions the one-third floor withheld this run — kept PENDING for
   * the officer to re-target or carry forward, not silently dropped.
   */
  deferredDeductions: Array<{ id: string; employeeId: string; amount: number; reason: string | null }>;
  /** Only present on the response to the create/correction call that produced this run. */
  skipped?: SkippedEmployee[];
}

export interface CreatePayrollRunInput {
  periodMonth: number;
  periodYear: number;
  /** Omit to run for every ACTIVE/ON_LEAVE employee with an effective salary structure. */
  employeeIds?: string[];
  roundNetToShilling?: boolean;
}

export interface CreateCorrectionInput {
  employeeIds: string[];
  roundNetToShilling?: boolean;
}

export const listPayrollRuns = (): Promise<PayrollRunListItem[]> => api<PayrollRunListItem[]>('/payroll/runs');

export const getPayrollRun = (id: string): Promise<PayrollRunDetail> =>
  api<PayrollRunDetail>(`/payroll/runs/${id}`);

export const createPayrollRun = (input: CreatePayrollRunInput): Promise<PayrollRunDetail> =>
  api<PayrollRunDetail>('/payroll/runs', { method: 'POST', body: JSON.stringify(input) });

/**
 * 409 when unresolved one-third-rule failures exist and `override` is false —
 * the error body carries `{ message, failingEmployeeIds }`. Callers should
 * catch that, show the affected employees, and retry with `override: true`.
 */
export const finalizePayrollRun = (id: string, override = false): Promise<PayrollRunDetail> =>
  api<PayrollRunDetail>(`/payroll/runs/${id}/finalize${override ? '?override=true' : ''}`, { method: 'POST' });

export const createCorrection = (id: string, input: CreateCorrectionInput): Promise<PayrollRunDetail> =>
  api<PayrollRunDetail>(`/payroll/runs/${id}/correction`, { method: 'POST', body: JSON.stringify(input) });

/** Only a DRAFT run can be discarded — finalized runs are immutable. */
export const discardPayrollRun = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/payroll/runs/${id}`, { method: 'DELETE' });

export interface GeneratePdfsResult { total: number; ready: number; failed: number }

/** Idempotent retry — (re)renders only payslips not yet READY. */
export const generateMissingPdfs = (runId: string): Promise<GeneratePdfsResult> =>
  api<GeneratePdfsResult>(`/payroll/runs/${runId}/payslips/pdf`, { method: 'POST' });

export const downloadPayslipPdf = (runId: string, payslipId: string): Promise<void> =>
  downloadFile(`/payroll/runs/${runId}/payslips/${payslipId}/pdf`, `payslip-${payslipId.slice(0, 8)}.pdf`);

export type BankExportFormat = 'csv' | 'xlsx' | 'both';
export type BankExportTemplate = 'generic' | 'eft';

export interface BankExportBatch {
  id: string;
  format: 'CSV' | 'XLSX';
  template: 'GENERIC' | 'EFT';
  rowCount: number;
  generatedAt: string;
}

export interface GenerateBankExportResult {
  batches: Array<{ id: string; format: 'CSV' | 'XLSX'; template: 'GENERIC' | 'EFT'; rowCount: number }>;
  template: 'GENERIC' | 'EFT';
  included: number;
  totalAmount: number;
  skipped: Array<{ employeeNumber: string; reason: string }>;
  warnings: string[];
}

export const generateBankExport = (
  runId: string,
  format: BankExportFormat,
  template: BankExportTemplate,
): Promise<GenerateBankExportResult> =>
  api<GenerateBankExportResult>(
    `/payroll/runs/${runId}/bank-export?format=${format}&template=${template}`,
    { method: 'POST' },
  );

export const listBankExports = (runId: string): Promise<BankExportBatch[]> =>
  api<BankExportBatch[]>(`/payroll/runs/${runId}/bank-exports`);

export const downloadBankExport = (runId: string, batchId: string): Promise<void> =>
  downloadFile(`/payroll/runs/${runId}/bank-exports/${batchId}/download`, `bank-export-${batchId.slice(0, 8)}`);

export interface PreviewPayrollInput {
  grossPay: number;
  /** Act-faithful NSSF base; defaults to grossPay when omitted. */
  pensionablePay?: number;
  /** Which effective statutory rate set to use; defaults to today. */
  asOf?: string;
}

export interface NssfBreakdown { employee: number; employer: number; tierI: number; tierII: number }

export interface PayrollBreakdown {
  grossPay: number;
  pensionablePay: number;
  nssf: NssfBreakdown;
  shif: number;
  ahl: number;
  taxablePay: number;
  payeBeforeRelief: number;
  personalRelief: number;
  paye: number;
  totalEmployeeDeductions: number;
  netPay: number;
  employerCost: { nssf: number; ahl: number };
}

export interface PreviewPayrollResult {
  asOf: string;
  breakdown: PayrollBreakdown;
}

/** Stateless — computes a full statutory breakdown without touching any run or employee. */
export const previewPayroll = (input: PreviewPayrollInput): Promise<PreviewPayrollResult> =>
  api<PreviewPayrollResult>('/payroll/preview', { method: 'POST', body: JSON.stringify(input) });
