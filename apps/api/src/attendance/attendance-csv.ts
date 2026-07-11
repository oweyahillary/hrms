/**
 * Pure parsing/validation for biometric CSV rows. Expected columns:
 *   employeeNumber, date (YYYY-MM-DD), clockIn?, clockOut?, status?
 * Times may be 'HH:MM', 'HH:MM:SS', or a full ISO timestamp; bare times are
 * combined with the row's date (UTC).
 */
export interface RawAttendanceRow {
  employeeNumber?: string;
  date?: string;
  clockIn?: string;
  clockOut?: string;
  status?: string;
}

export interface ParsedAttendance {
  employeeNumber: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string | null;
}

export interface RowError { row: number; message: string; }

export const ATTENDANCE_STATUSES: ReadonlySet<string> = new Set([
  'PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE',
]);

/** Combine a date with a time into an ISO instant, or null if no time given. */
export function combineDateTime(date: string, time?: string | null): string | null | 'INVALID' {
  const t = (time ?? '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return t; // already ISO
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return 'INVALID';
  const hh = m[1].padStart(2, '0');
  if (Number(hh) > 23 || Number(m[2]) > 59) return 'INVALID';
  return `${date}T${hh}:${m[2]}:${m[3] ?? '00'}.000Z`;
}

export function parseAttendanceRow(raw: RawAttendanceRow, rowNumber: number): { record?: ParsedAttendance; error?: RowError } {
  const employeeNumber = (raw.employeeNumber ?? '').trim();
  const date = (raw.date ?? '').trim();
  if (!employeeNumber) return { error: { row: rowNumber, message: 'missing employeeNumber' } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: { row: rowNumber, message: 'invalid or missing date (expected YYYY-MM-DD)' } };

  const status = ((raw.status ?? '').trim().toUpperCase()) || null;
  if (status && !ATTENDANCE_STATUSES.has(status)) {
    return { error: { row: rowNumber, message: `invalid status "${status}"` } };
  }

  const clockIn = combineDateTime(date, raw.clockIn);
  if (clockIn === 'INVALID') return { error: { row: rowNumber, message: `invalid clockIn time "${raw.clockIn}"` } };
  const clockOut = combineDateTime(date, raw.clockOut);
  if (clockOut === 'INVALID') return { error: { row: rowNumber, message: `invalid clockOut time "${raw.clockOut}"` } };

  return { record: { employeeNumber, date, clockIn, clockOut, status } };
}

/** Explicit status wins; otherwise infer from whether the person clocked in. */
export function deriveStatus(explicit: string | null, clockIn: string | null): string {
  if (explicit) return explicit;
  return clockIn ? 'PRESENT' : 'ABSENT';
}
