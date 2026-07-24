import { api } from './client';

export const OVERTIME_CATEGORIES = ['NORMAL_DAY', 'REST_DAY', 'HOLIDAY'] as const;
export type OvertimeCategory = (typeof OVERTIME_CATEGORIES)[number];
export const OVERTIME_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type OvertimeStatus = (typeof OVERTIME_STATUSES)[number];
export type OvertimeSource = 'DERIVED' | 'MANUAL';

export interface OvertimeEntry {
  id: string;
  employeeId: string;
  date: string;
  hours: number;
  category: OvertimeCategory;
  source: OvertimeSource;
  status: OvertimeStatus;
  note: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  payrollRunId: string | null;
  /** null until a payroll run actually consumes this entry — see the API's schema comment. */
  amount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueryOvertimeParams {
  status?: OvertimeStatus;
  employeeId?: string;
  departmentId?: string;
  from?: string;
  to?: string;
}

export const listOvertime = (params: QueryOvertimeParams): Promise<OvertimeEntry[]> => {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.employeeId) qs.set('employeeId', params.employeeId);
  if (params.departmentId) qs.set('departmentId', params.departmentId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const q = qs.toString();
  return api<OvertimeEntry[]>(`/overtime${q ? `?${q}` : ''}`);
};

export interface DeriveOvertimeResult {
  derived: number;
  updated: number;
  removed: number;
  excessReported: Array<{ employeeId: string; date: string; hours: number; excessHours: number }>;
}

export const deriveOvertime = (from: string, to: string): Promise<DeriveOvertimeResult> =>
  api<DeriveOvertimeResult>('/overtime/derive', { method: 'POST', body: JSON.stringify({ from, to }) });

export interface CreateOvertimeEntryInput {
  employeeId: string;
  date: string;
  hours: number;
  category: OvertimeCategory;
  note?: string;
}

export const createOvertimeEntry = (input: CreateOvertimeEntryInput): Promise<OvertimeEntry> =>
  api<OvertimeEntry>('/overtime', { method: 'POST', body: JSON.stringify(input) });

export const updateOvertimeEntry = (id: string, patch: Partial<CreateOvertimeEntryInput>): Promise<OvertimeEntry> =>
  api<OvertimeEntry>(`/overtime/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteOvertimeEntry = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/overtime/${id}`, { method: 'DELETE' });

export const approveOvertimeEntry = (id: string): Promise<OvertimeEntry> =>
  api<OvertimeEntry>(`/overtime/${id}/approve`, { method: 'POST' });

export const rejectOvertimeEntry = (id: string, note: string): Promise<OvertimeEntry> =>
  api<OvertimeEntry>(`/overtime/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) });

export const bulkApproveOvertime = (from: string, to: string, departmentId?: string): Promise<{ approved: number }> =>
  api<{ approved: number }>('/overtime/bulk-approve', { method: 'POST', body: JSON.stringify({ from, to, departmentId }) });

export const getMyOvertime = (from?: string, to?: string): Promise<OvertimeEntry[]> => {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const q = qs.toString();
  return api<OvertimeEntry[]>(`/me/overtime${q ? `?${q}` : ''}`);
};

export const OVERTIME_HOURLY_RATE_BASES = ['MONTHLY_X12_DIV_52_WEEKLY_HOURS', 'MONTHLY_DIV_26_DIV_8'] as const;
export type OvertimeHourlyRateBasis = (typeof OVERTIME_HOURLY_RATE_BASES)[number];

export interface OvertimePolicy {
  id: string | null;
  effectiveFrom: string;
  normalDayMultiplier: number;
  restDayMultiplier: number;
  holidayMultiplier: number;
  hourlyRateBasis: OvertimeHourlyRateBasis;
  normalWeeklyHours: number;
  minimumMinutesToCount: number;
  maxHoursPerDay: number | null;
  requiresApproval: boolean;
}

export interface UpsertOvertimePolicyInput {
  effectiveFrom: string;
  normalDayMultiplier?: number;
  restDayMultiplier?: number;
  holidayMultiplier?: number;
  hourlyRateBasis?: OvertimeHourlyRateBasis;
  normalWeeklyHours?: number;
  minimumMinutesToCount?: number;
  maxHoursPerDay?: number | null;
  requiresApproval?: boolean;
}

export const listOvertimePolicies = (): Promise<OvertimePolicy[]> => api<OvertimePolicy[]>('/overtime-policies');

export const getEffectiveOvertimePolicy = (asOf?: string): Promise<OvertimePolicy> =>
  api<OvertimePolicy>(`/overtime-policies/effective${asOf ? `?asOf=${asOf}` : ''}`);

export const createOvertimePolicy = (input: UpsertOvertimePolicyInput): Promise<OvertimePolicy> =>
  api<OvertimePolicy>('/overtime-policies', { method: 'POST', body: JSON.stringify(input) });

export const updateOvertimePolicy = (id: string, patch: Partial<UpsertOvertimePolicyInput>): Promise<OvertimePolicy> =>
  api<OvertimePolicy>(`/overtime-policies/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteOvertimePolicy = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/overtime-policies/${id}`, { method: 'DELETE' });
