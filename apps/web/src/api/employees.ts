import { api } from './client';

/**
 * The list row deliberately carries no PII — the API's list projection omits the
 * encrypted columns (national ID, KRA PIN, bank account). Those live on the
 * detail record only. Don't add them to this type: if they appear here it means
 * the server contract regressed.
 */
export interface EmployeeListRow {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  departmentId: string | null;
  jobTitleId: string | null;
  employmentType: string;
  employmentStatus: string;
  hireDate: string;
  exitDate: string | null;
  createdAt: string;
}

export interface EmployeeListResponse {
  data: EmployeeListRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Mirrors EMPLOYEE_SORT_FIELDS on the API — anything else is a 400. */
export type EmployeeSort = 'name' | 'employeeNumber' | 'hireDate' | 'createdAt';
export type SortOrder = 'asc' | 'desc';

export const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED'] as const;

export interface ListEmployeesParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
  departmentId?: string;
  sort?: EmployeeSort;
  order?: SortOrder;
}

/**
 * The full employee record. Unlike the list row this DOES carry PII —
 * `nationalId`, `kraPin` and `bankAccountNumber` are decrypted server-side and
 * returned in full to HR roles, or masked to `****5678` for everyone else.
 * `piiMasked` tells you which you got; never infer it from the value.
 */
export interface EmployeeDetail {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  kraPin: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  bankCode: string | null;
  bankBranchCode: string | null;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  departmentId: string | null;
  jobTitleId: string | null;
  employmentType: string;
  employmentStatus: string;
  hireDate: string;
  exitDate: string | null;
  nextOfKin: unknown;
  createdAt: string;
  updatedAt: string;
  piiMasked: boolean;
}

/**
 * Create payload. Optional fields must be OMITTED rather than sent empty — the
 * API validates with forbidNonWhitelisted and format regexes, so `kraPin: ''`
 * is a 400 whereas an absent key is simply skipped.
 */
export interface CreateEmployeeInput {
  /** Omit to let the server allocate from the org's prefix + counter. */
  employeeNumber?: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  employmentType: string;
  hireDate: string;
  kraPin?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  departmentId?: string;
  jobTitleId?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankCode?: string;
  bankBranchCode?: string;
  nextOfKin?: Record<string, unknown>;
}

/** Preview only — the real number is allocated server-side at save time. */
export interface NextNumber {
  autoNumbering: boolean;
  prefix: string | null;
  next: string | null;
}

export const getNextNumber = (): Promise<NextNumber> => api<NextNumber>('/employees/next-number');

/**
 * Update payload. `null` CLEARS a field; `undefined` (an absent key) leaves it
 * untouched — the API only writes keys that are present. Send only what changed.
 *
 * nationalId, employmentType and hireDate are non-nullable: they can be changed
 * but never cleared.
 */
export interface UpdateEmployeeInput {
  employeeNumber?: string;
  firstName?: string;
  lastName?: string;
  nationalId?: string;
  employmentType?: string;
  hireDate?: string;
  kraPin?: string | null;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  departmentId?: string | null;
  jobTitleId?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankCode?: string | null;
  bankBranchCode?: string | null;
  nextOfKin?: Record<string, unknown>;
}

export const updateEmployee = (id: string, patch: UpdateEmployeeInput): Promise<EmployeeDetail> =>
  api<EmployeeDetail>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

/** exitDate defaults to today server-side when omitted. */
export const terminateEmployee = (id: string, exitDate?: string): Promise<EmployeeDetail> =>
  api<EmployeeDetail>(`/employees/${id}/terminate`, {
    method: 'POST',
    body: JSON.stringify(exitDate ? { exitDate } : {}),
  });

export const createEmployee = (input: CreateEmployeeInput): Promise<EmployeeDetail> =>
  api<EmployeeDetail>('/employees', { method: 'POST', body: JSON.stringify(input) });

export const getEmployee = (id: string): Promise<EmployeeDetail> =>
  api<EmployeeDetail>(`/employees/${id}`);

export function listEmployees(params: ListEmployeesParams): Promise<EmployeeListResponse> {
  const qs = new URLSearchParams();
  // Only send what's set. The API rejects unknown params (forbidNonWhitelisted),
  // and an empty `q` would be a wasted round trip.
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.q) qs.set('q', params.q);
  if (params.status) qs.set('status', params.status);
  if (params.departmentId) qs.set('departmentId', params.departmentId);
  if (params.sort) qs.set('sort', params.sort);
  if (params.order) qs.set('order', params.order);
  const query = qs.toString();
  return api<EmployeeListResponse>(`/employees${query ? `?${query}` : ''}`);
}
