/**
 * Reader -> preset -> neutral rows -> existing validator. attendance.service.ts
 * does the CSV reading (csv-parse, unchanged) and routes the raw parsed rows
 * through one of these; every preset produces the SAME neutral
 * RawAttendanceRow shape that parseAttendanceRow (attendance-csv.ts) already
 * validates, so adding a preset never touches validation.
 *
 * NEUTRAL is today's columns, byte-for-byte unchanged. ZKTECO covers two
 * real ZKTeco export shapes: a punch-EVENT export (one row per punch) and a
 * day-summary export (one row per employee/day, already has separate
 * check-in/check-out columns) — detected by header shape. Punch-event
 * grouping needs a shift-assignment lookup to attribute an early-morning
 * punch to the PREVIOUS day's night shift, which is DB access — kept out of
 * this file (and out of the pure pairPunches()) by having the caller
 * (attendance.service.ts) pre-resolve which (employeeNumber, date) pairs
 * are night-shift starts and pass that in as a synchronous dateFor closure.
 *
 * Column names below are the commonly documented ZKTeco/ZKTime headers —
 * NOT verified against a real export from this pilot client's actual
 * device. Flagged in the summary: get a real sample file before trusting
 * this preset in production, the same caution this codebase already
 * applies to any statutory/validated format (see dev_docs's P10 note).
 */
import { pairPunches, type Punch } from './punch-pairing';
import { parseDeviceTimestamp } from './device-timestamp';
import type { RawAttendanceRow, RowError } from './attendance-csv';

export type ImportPreset = 'NEUTRAL' | 'ZKTECO';
export type RawCsvRow = Record<string, string>;

/** A neutral row plus where it came from — a raw CSV line for NEUTRAL/day-export, or a synthetic index for grouped punch-event rows (see sourceLabel). */
export interface SourcedRow {
  row: RawAttendanceRow;
  sourceRow: number;
  /** Only set for grouped (punch-event) rows, where "row N" alone isn't self-explanatory. */
  sourceLabel?: string;
}

const DAY_EXPORT_CHECKIN_HEADERS = ['checkin', 'check in', 'timein', 'time in'];
const DAY_EXPORT_CHECKOUT_HEADERS = ['checkout', 'check out', 'timeout', 'time out'];
const EMPLOYEE_HEADERS = ['pin', 'person id', 'employeenumber', 'ac-no.', 'ac-no', 'id', 'badgenumber'];
const PUNCH_TIME_HEADERS = ['time', 'timestamp', 'punch time', 'datetime'];

function pick(row: RawCsvRow, keys: string[]): string | undefined {
  for (const header of Object.keys(row)) {
    if (keys.includes(header.trim().toLowerCase()) && row[header]?.trim()) return row[header].trim();
  }
  return undefined;
}

export function neutralPreset(rows: RawCsvRow[]): SourcedRow[] {
  return rows.map((r, i) => ({
    sourceRow: i + 2, // +2: header is row 1
    row: {
      employeeNumber: pick(r, ['employeenumber']),
      date: pick(r, ['date']),
      clockIn: pick(r, ['clockin']),
      clockOut: pick(r, ['clockout']),
      status: pick(r, ['status']),
    },
  }));
}

/** True if the file looks like a ZK day-summary export (has its own check-in/out columns) rather than raw punch events. */
export function isZkDayExport(rows: RawCsvRow[]): boolean {
  if (rows.length === 0) return false;
  const headers = Object.keys(rows[0]).map((h) => h.trim().toLowerCase());
  return headers.some((h) => DAY_EXPORT_CHECKIN_HEADERS.includes(h));
}

export function zkDayExportPreset(rows: RawCsvRow[]): SourcedRow[] {
  return rows.map((r, i) => ({
    sourceRow: i + 2,
    row: {
      employeeNumber: pick(r, EMPLOYEE_HEADERS),
      date: pick(r, ['date']),
      clockIn: pick(r, DAY_EXPORT_CHECKIN_HEADERS),
      clockOut: pick(r, DAY_EXPORT_CHECKOUT_HEADERS),
      status: undefined, // a ZK export never carries a status column — always derived
    },
  }));
}

/** Raw punches extracted from a ZK punch-event export, before grouping — lets the caller resolve shift context per employee first. */
export function extractZkPunches(rows: RawCsvRow[]): { punches: Punch[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const punches: Punch[] = [];
  rows.forEach((r, i) => {
    const rowNumber = i + 2;
    const employeeNumber = pick(r, EMPLOYEE_HEADERS);
    const timeStr = pick(r, PUNCH_TIME_HEADERS);
    if (!employeeNumber || !timeStr) {
      errors.push({ row: rowNumber, message: 'missing employee id or punch time' });
      return;
    }
    const ts = parseDeviceTimestamp(timeStr);
    if (Number.isNaN(ts.getTime())) {
      errors.push({ row: rowNumber, message: `unreadable punch time "${timeStr}"` });
      return;
    }
    punches.push({ employeeNumber, timestamp: ts });
  });
  return { punches, errors };
}

/** Groups already-extracted punches (see extractZkPunches) into neutral day rows using the caller's shift-aware dateFor. */
export function groupZkPunches(
  punches: Punch[],
  dateFor: (employeeNumber: string, timestamp: Date) => string,
): SourcedRow[] {
  const paired = pairPunches(punches, dateFor);
  return paired.map((p, i) => ({
    sourceRow: i + 1,
    sourceLabel: `${p.employeeNumber} on ${p.date} (grouped from punch events, not a single CSV line)`,
    row: {
      employeeNumber: p.employeeNumber,
      date: p.date,
      clockIn: p.clockIn.toISOString(),
      clockOut: p.clockOut ? p.clockOut.toISOString() : undefined,
      status: undefined,
    },
  }));
}
