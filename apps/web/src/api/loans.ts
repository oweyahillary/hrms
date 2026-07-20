import { api } from './client';

export const LOAN_TYPES = ['LOAN', 'ADVANCE'] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export const LOAN_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export interface LoanRepayment {
  id: string;
  payrollRunId: string;
  payslipId: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
}

export interface Loan {
  id: string;
  employeeId: string;
  type: LoanType;
  principal: number;
  interestRate: number;
  numberOfInstallments: number;
  installmentAmount: number;
  balance: number;
  totalPayable: number;
  amountRepaid: number;
  status: LoanStatus;
  disbursedDate: string;
  reason: string | null;
  createdAt: string;
  repayments?: LoanRepayment[];
}

export interface CreateLoanInput {
  type: LoanType;
  principal: number;
  /** Flat, one-time % of principal — defaults to 0 (interest-free). */
  interestRate?: number;
  numberOfInstallments: number;
  disbursedDate: string;
  reason?: string;
}

export const listLoans = (employeeId: string): Promise<Loan[]> =>
  api<Loan[]>(`/employees/${employeeId}/loans`);

export const createLoan = (employeeId: string, input: CreateLoanInput): Promise<Loan> =>
  api<Loan>(`/employees/${employeeId}/loans`, { method: 'POST', body: JSON.stringify(input) });

/** Includes the full repayment history. */
export const getLoan = (id: string): Promise<Loan> => api<Loan>(`/loans/${id}`);

/** Write-off: only an ACTIVE loan can be cancelled; past repayments are not reversed. */
export const cancelLoan = (id: string): Promise<Loan> =>
  api<Loan>(`/loans/${id}/cancel`, { method: 'PATCH' });
