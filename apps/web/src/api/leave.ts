import { api } from './client';

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export interface ApprovalStep {
  stepOrder: number;
  approverUserId: string;
  status: string;
  actedAt: string | null;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string | null;
  employeeNumber: string | null;
  leaveTypeId: string;
  leaveTypeName?: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  status: string;
  reason: string | null;
  createdAt: string;
  currentApproverUserId: string | null;
  approvalSteps: ApprovalStep[];
}

export interface LeaveType {
  id: string;
  name: string;
  isPaid: boolean;
  requiresApproval: boolean;
  accrualMethod: string;
  annualDays: number | null;
  carryOverMax: number | null;
  carryOverExpiryMonths: number | null;
}

export interface LeaveBalance {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveTypeName?: string;
  year: number;
  accruedDays: number;
  carriedOverDays: number;
  usedDays: number;
  /** Expiry-aware: lapsed carry-over is already excluded. */
  availableDays: number;
  /** Last day carried days can be used, or null if they never expire. */
  carryOverExpiresOn: string | null;
  /** Unused carried days still at risk — 0 once already lapsed. */
  expiringDays: number;
  /** Unused carried days already lost. */
  expiredDays: number;
  updatedAt: string;
}

export interface ListRequestsParams {
  employeeId?: string;
  status?: string;
}

export function listLeaveRequests(params: ListRequestsParams = {}): Promise<LeaveRequest[]> {
  const qs = new URLSearchParams();
  if (params.employeeId) qs.set('employeeId', params.employeeId);
  if (params.status) qs.set('status', params.status);
  const q = qs.toString();
  return api<LeaveRequest[]>(`/leave-requests${q ? `?${q}` : ''}`);
}

/** Requests waiting on the signed-in user specifically. */
export const leaveInbox = (): Promise<LeaveRequest[]> => api<LeaveRequest[]>('/leave-requests/inbox');

export const approveLeave = (id: string): Promise<LeaveRequest> =>
  api<LeaveRequest>(`/leave-requests/${id}/approve`, { method: 'POST' });

export const rejectLeave = (id: string): Promise<LeaveRequest> =>
  api<LeaveRequest>(`/leave-requests/${id}/reject`, { method: 'POST' });

export const cancelLeave = (id: string): Promise<LeaveRequest> =>
  api<LeaveRequest>(`/leave-requests/${id}/cancel`, { method: 'POST' });

export interface Approver {
  id: string;
  name: string;
  role: string;
}

/** Users who can be chosen to approve a request. Not a general user directory. */
export const getApprovers = (): Promise<Approver[]> => api<Approver[]>('/leave-requests/approvers');

export interface ResolvedApprover {
  step: number;
  userId: string;
  name: string;
  role: string;
}

/** Who WILL approve this employee's leave, under the organisation's policy. */
export interface ApproversFor {
  approvers: ResolvedApprover[];
  rule: string;
  explanation: string;
  employeeMayChoose: boolean;
  unresolved: boolean;
}

export const getApproversFor = (employeeId: string): Promise<ApproversFor> =>
  api<ApproversFor>(`/leave-requests/approvers-for?employeeId=${employeeId}`);

export interface CreateLeaveRequestInput {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string;
  /** Only honoured when the org allows employees to choose. Otherwise derived. */
  approverUserIds?: string[];
}

export const createLeaveRequest = (input: CreateLeaveRequestInput): Promise<LeaveRequest> =>
  api<LeaveRequest>('/leave-requests', { method: 'POST', body: JSON.stringify(input) });

export interface PublicHoliday {
  id: string;
  name: string;
  date: string;
}

export const getPublicHolidays = (year: number): Promise<PublicHoliday[]> =>
  api<PublicHoliday[]>(`/public-holidays?year=${year}`);

export const getLeaveTypes = (): Promise<LeaveType[]> => api<LeaveType[]>('/leave-types');

export interface LeaveTypeInput {
  name: string;
  isPaid?: boolean;
  requiresApproval?: boolean;
  accrualMethod?: string;
  annualDays?: number;
  carryOverMax?: number;
  carryOverExpiryMonths?: number;
}

export const createLeaveType = (input: LeaveTypeInput): Promise<LeaveType> =>
  api<LeaveType>('/leave-types', { method: 'POST', body: JSON.stringify(input) });

export const updateLeaveType = (id: string, patch: Partial<LeaveTypeInput>): Promise<LeaveType> =>
  api<LeaveType>(`/leave-types/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export interface UpsertBalanceInput {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  accruedDays: number;
  carriedOverDays?: number;
}

/** NOTE: usedDays is not settable — it only moves through approved requests. */
export const upsertLeaveBalance = (input: UpsertBalanceInput): Promise<LeaveBalance> =>
  api<LeaveBalance>('/leave-balances', { method: 'POST', body: JSON.stringify(input) });

export interface AccrualResult {
  year: number; month: number; employees: number; leaveTypes: number;
  created: number; updated: number; unchanged: number;
}

/** Idempotent — grants each employee what they've earned to date, no more. */
export const runAccrual = (year: number, month: number): Promise<AccrualResult> =>
  api<AccrualResult>('/leave/accrual/run', { method: 'POST', body: JSON.stringify({ year, month }) });

export const getLeaveBalances = (employeeId: string, year?: number): Promise<LeaveBalance[]> => {
  const qs = new URLSearchParams({ employeeId });
  if (year) qs.set('year', String(year));
  return api<LeaveBalance[]>(`/leave-balances?${qs.toString()}`);
};
