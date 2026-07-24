import { api } from './client';

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: AttendanceStatus;
  source: 'MANUAL' | 'BIOMETRIC';
  /** null if the employee had no ShiftAssignment that day — derivation fell back to the org's General shift, but this wasn't a real assignment. */
  shiftCode: string | null;
  unassigned: boolean;
  lateMinutes: number;
}

export interface QueryAttendanceParams {
  /** Omit for an org-wide register over the range (optionally narrowed by departmentId). */
  employeeId?: string;
  departmentId?: string;
  from?: string;
  to?: string;
}

export const listAttendance = (params: QueryAttendanceParams): Promise<AttendanceRecord[]> => {
  const qs = new URLSearchParams();
  if (params.employeeId) qs.set('employeeId', params.employeeId);
  if (params.departmentId) qs.set('departmentId', params.departmentId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const q = qs.toString();
  return api<AttendanceRecord[]>(`/attendance${q ? `?${q}` : ''}`);
};

export interface UpsertAttendanceInput {
  employeeId: string;
  date: string;
  /** Full ISO instants, not bare times — combine with `date` before calling. */
  clockIn?: string;
  clockOut?: string;
  /** Explicit status always wins over shift-aware derivation. */
  status?: AttendanceStatus;
}

/** One record per employee/day — writes upsert that day's record rather than duplicating it. */
export const upsertAttendance = (input: UpsertAttendanceInput): Promise<AttendanceRecord> =>
  api<AttendanceRecord>('/attendance', { method: 'POST', body: JSON.stringify(input) });

export type AttendanceImportPreset = 'NEUTRAL' | 'ZKTECO';

export interface ImportAttendanceResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export const importAttendance = (file: File, preset: AttendanceImportPreset): Promise<ImportAttendanceResult> => {
  const form = new FormData();
  form.append('file', file);
  return api<ImportAttendanceResult>(`/attendance/import?preset=${preset}`, { method: 'POST', body: form });
};

export const NEUTRAL_TEMPLATE_CSV = 'employeeNumber,date,clockIn,clockOut,status\nEMP-001,2026-08-04,08:00,17:00,\n';
export const ZKTECO_TEMPLATE_CSV = 'PIN,Time\nEMP-001,2026-08-04 08:00:00\nEMP-001,2026-08-04 17:00:00\n';
