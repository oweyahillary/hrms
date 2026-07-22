import { api } from './client';

export type ContractTermType = 'FIXED_TERM' | 'UNSPECIFIED_WITH_CLAUSE' | 'NO_PROVISION';

/**
 * Plain-language labels for the applied KRA spreading bucket. Single source of
 * truth — the severance register (ReportsPage) and the per-employee severance
 * section both read from here.
 */
export const BUCKET_LABEL: Record<string, string> = {
  FIXED_TERM: 'Fixed term',
  UNSPECIFIED_WITH_CLAUSE: 'Unspecified',
  NO_PROVISION: 'No provision',
};

/** Only REDUNDANCY produces a statutory severance amount (Employment Act §40). */
export const EXIT_REASON_OPTIONS = [
  { value: 'REDUNDANCY', label: 'Redundancy — statutory severance applies' },
  { value: 'TERMINATION', label: 'Termination — no severance' },
  { value: 'RESIGNATION', label: 'Resignation — no severance' },
  { value: 'RETIREMENT', label: 'Retirement — no severance' },
];

export const PAY_FREQUENCY_OPTIONS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'BI_WEEKLY', label: 'Bi-weekly' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'DAILY', label: 'Daily' },
];

export const CONTRACT_TERM_OPTIONS = [
  { value: 'FIXED_TERM', label: 'Fixed term' },
  { value: 'UNSPECIFIED_WITH_CLAUSE', label: 'Unspecified with clause' },
  { value: 'NO_PROVISION', label: 'No provision' },
];

/** The stored calculation breakdown — partial/defensive; fields may be absent. */
export interface SeveranceBreakdown {
  severance?: { completedYears?: number; gross?: number; applies?: boolean };
  notice?: { payInLieu?: number; appliedDays?: number };
  paye?: {
    status?: string;
    bucket?: string | null;
    paye?: number | null;
    periods?: number;
    amountPerPeriod?: number;
    net?: number | null;
  };
  contractTermType?: string;
}

export interface SeveranceCalculation {
  id: string;
  employeeId: string;
  exitDate: string;
  reason: string;
  noticePeriodDays: number;
  severanceAmount: number;
  calculationBreakdown: SeveranceBreakdown;
  calculatedById: string;
  createdAt: string;
}

export interface CreateSeveranceInput {
  reason: string;
  exitDate: string;
  payFrequency: string;
  contractualNoticeDays?: number;
  contractTermType: ContractTermType;
  unexpiredTermMonths?: number;
}

export const listSeveranceCalculations = (employeeId: string): Promise<SeveranceCalculation[]> =>
  api<SeveranceCalculation[]>(`/employees/${employeeId}/severance-calculations`);

export const createSeveranceCalculation = (
  employeeId: string, input: CreateSeveranceInput,
): Promise<SeveranceCalculation> =>
  api<SeveranceCalculation>(`/employees/${employeeId}/severance-calculations`, {
    method: 'POST', body: JSON.stringify(input),
  });
