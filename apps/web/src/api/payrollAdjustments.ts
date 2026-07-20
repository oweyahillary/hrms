import { api } from './client';

export const ADJUSTMENT_TYPES = ['BONUS', 'DEDUCTION'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const ADJUSTMENT_STATUSES = ['PENDING', 'APPLIED', 'CANCELLED'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export interface PayrollAdjustment {
  id: string;
  employeeId: string;
  type: AdjustmentType;
  amount: number;
  isTaxable: boolean;
  reason: string;
  targetPeriodMonth: number;
  targetPeriodYear: number;
  status: AdjustmentStatus;
  payrollRunId: string | null;
  payslipId: string | null;
  createdAt: string;
}

export interface CreatePayrollAdjustmentInput {
  type: AdjustmentType;
  amount: number;
  /** BONUS only — whether it also folds into the PAYE taxable base. Defaults to true. */
  isTaxable?: boolean;
  reason: string;
  targetPeriodMonth: number;
  targetPeriodYear: number;
}

export const listPayrollAdjustments = (employeeId: string): Promise<PayrollAdjustment[]> =>
  api<PayrollAdjustment[]>(`/employees/${employeeId}/payroll-adjustments`);

export const createPayrollAdjustment = (employeeId: string, input: CreatePayrollAdjustmentInput): Promise<PayrollAdjustment> =>
  api<PayrollAdjustment>(`/employees/${employeeId}/payroll-adjustments`, { method: 'POST', body: JSON.stringify(input) });

/** Only a PENDING adjustment (not yet applied to a payroll run) can be cancelled. */
export const cancelPayrollAdjustment = (id: string): Promise<PayrollAdjustment> =>
  api<PayrollAdjustment>(`/payroll-adjustments/${id}/cancel`, { method: 'PATCH' });
