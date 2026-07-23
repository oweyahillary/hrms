import { api } from './client';

// -- Data subject requests ---------------------------------------------------

export const DSR_REQUEST_TYPES = ['ACCESS', 'CORRECTION', 'ERASURE'] as const;
export type DsrRequestType = (typeof DSR_REQUEST_TYPES)[number];

export const DSR_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'] as const;
export type DsrStatus = (typeof DSR_STATUSES)[number];

/** Statuses a request can move to next — always forward, never back to RECEIVED. */
export const DSR_TRANSITIONS = ['IN_PROGRESS', 'COMPLETED', 'REJECTED'] as const;

export interface DataSubjectRequest {
  id: string;
  employeeId: string;
  requestType: DsrRequestType;
  status: DsrStatus;
  submittedAt: string;
  /** Calendar SLA deadline — 30 days from submission (Kenya DPA General Regulations 2021). */
  dueDate: string;
  resolvedAt: string | null;
  notes: string | null;
  overdue: boolean;
  /** Whole calendar days left (negative once past due). */
  daysUntilDue: number;
}

export interface CreateDsrInput {
  requestType: DsrRequestType;
  notes?: string;
}

export interface TransitionDsrInput {
  status: (typeof DSR_TRANSITIONS)[number];
  notes?: string;
}

export const createDsr = (employeeId: string, input: CreateDsrInput): Promise<DataSubjectRequest> =>
  api<DataSubjectRequest>(`/employees/${employeeId}/data-subject-requests`, {
    method: 'POST', body: JSON.stringify(input),
  });

export const listDsr = (status?: DsrStatus): Promise<DataSubjectRequest[]> =>
  api<DataSubjectRequest[]>(`/data-subject-requests${status ? `?status=${status}` : ''}`);

export const getDsr = (id: string): Promise<DataSubjectRequest> =>
  api<DataSubjectRequest>(`/data-subject-requests/${id}`);

export const transitionDsr = (id: string, input: TransitionDsrInput): Promise<DataSubjectRequest> =>
  api<DataSubjectRequest>(`/data-subject-requests/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

// -- Breach incidents ---------------------------------------------------------

export const BREACH_STATUSES = ['OPEN', 'CONTAINED', 'CLOSED'] as const;
export type BreachStatus = (typeof BREACH_STATUSES)[number];

export type OdpcClockStatus = 'NOTIFIED_ON_TIME' | 'NOTIFIED_LATE' | 'WITHIN_WINDOW' | 'OVERDUE';

export interface BreachIncident {
  id: string;
  /** When the breach was detected — the instant the 72-hour ODPC clock starts (Kenya DPA s.43). */
  detectedAt: string;
  description: string;
  affectedEmployeeCount: number;
  odpcNotifiedAt: string | null;
  employeesNotifiedAt: string | null;
  status: BreachStatus;
  odpc: {
    deadline: string;
    status: OdpcClockStatus;
    hoursRemaining: number;
  };
}

export interface CreateBreachInput {
  detectedAt: string;
  description: string;
  affectedEmployeeCount: number;
}

export interface UpdateBreachInput {
  status?: BreachStatus;
  description?: string;
  affectedEmployeeCount?: number;
}

export const createBreach = (input: CreateBreachInput): Promise<BreachIncident> =>
  api<BreachIncident>('/breach-incidents', { method: 'POST', body: JSON.stringify(input) });

export const listBreaches = (status?: BreachStatus): Promise<BreachIncident[]> =>
  api<BreachIncident[]>(`/breach-incidents${status ? `?status=${status}` : ''}`);

export const getBreach = (id: string): Promise<BreachIncident> =>
  api<BreachIncident>(`/breach-incidents/${id}`);

export const updateBreach = (id: string, input: UpdateBreachInput): Promise<BreachIncident> =>
  api<BreachIncident>(`/breach-incidents/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const notifyOdpc = (id: string): Promise<BreachIncident> =>
  api<BreachIncident>(`/breach-incidents/${id}/notify-odpc`, { method: 'POST' });

export const notifyEmployeesOfBreach = (id: string): Promise<BreachIncident> =>
  api<BreachIncident>(`/breach-incidents/${id}/notify-employees`, { method: 'POST' });

// -- Consent records ----------------------------------------------------------

export const LAWFUL_BASES = ['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST'] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];

export interface ConsentRecord {
  id: string;
  employeeId: string;
  purpose: string;
  lawfulBasis: LawfulBasis;
  grantedAt: string;
  withdrawnAt: string | null;
  active: boolean;
}

export interface CreateConsentInput {
  purpose: string;
  lawfulBasis: LawfulBasis;
  grantedAt?: string;
}

export const grantConsent = (employeeId: string, input: CreateConsentInput): Promise<ConsentRecord> =>
  api<ConsentRecord>(`/employees/${employeeId}/consents`, { method: 'POST', body: JSON.stringify(input) });

/** No org-wide list exists — consent is always looked up one employee at a time. */
export const listConsentsForEmployee = (employeeId: string): Promise<ConsentRecord[]> =>
  api<ConsentRecord[]>(`/employees/${employeeId}/consents`);

export const withdrawConsent = (id: string): Promise<ConsentRecord> =>
  api<ConsentRecord>(`/consents/${id}/withdraw`, { method: 'POST' });

// -- Retention policies ---------------------------------------------------------

export interface RetentionPolicy {
  id: string;
  recordType: string;
  retentionPeriodMonths: number;
  legalBasisNote: string | null;
  updatedAt: string;
}

export interface UpsertRetentionPolicyInput {
  recordType: string;
  retentionPeriodMonths: number;
  legalBasisNote?: string;
}

/** One policy per recordType — creates it if new, updates it if the type already has one. */
export const upsertRetentionPolicy = (input: UpsertRetentionPolicyInput): Promise<RetentionPolicy> =>
  api<RetentionPolicy>('/retention-policies', { method: 'PUT', body: JSON.stringify(input) });

export const listRetentionPolicies = (): Promise<RetentionPolicy[]> =>
  api<RetentionPolicy[]>('/retention-policies');

export const deleteRetentionPolicy = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/retention-policies/${id}`, { method: 'DELETE' });
