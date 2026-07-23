/**
 * Pure parsing/validation for roster import rows — CSV and XLSX both funnel
 * into this same shape via their own reader (shift-roster-readers.ts), so
 * there is exactly one validator regardless of source format. Expected
 * columns: employeeNumber, date (YYYY-MM-DD), shiftCode.
 *
 * Mirrors attendance-csv.ts's parse/validate split deliberately: resolution
 * against real employees, shift definitions and leave conflicts needs DB
 * access and happens in ShiftRosterService — this file has none, so it's
 * trivially unit-testable.
 */
export interface RawRosterRow {
  employeeNumber?: string;
  date?: string;
  shiftCode?: string;
}

export interface ParsedRosterRow {
  employeeNumber: string;
  date: string;
  shiftCode: string;
}

export interface RowError { row: number; message: string; }

export function parseRosterRow(raw: RawRosterRow, rowNumber: number): { record?: ParsedRosterRow; error?: RowError } {
  const employeeNumber = (raw.employeeNumber ?? '').trim();
  const date = (raw.date ?? '').trim();
  const shiftCode = (raw.shiftCode ?? '').trim();
  if (!employeeNumber) return { error: { row: rowNumber, message: 'missing employeeNumber' } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: { row: rowNumber, message: 'invalid or missing date (expected YYYY-MM-DD)' } };
  }
  if (!shiftCode) return { error: { row: rowNumber, message: 'missing shiftCode' } };
  return { record: { employeeNumber, date, shiftCode } };
}

/** The template header row every reader/preset expects, in order. */
export const ROSTER_IMPORT_HEADERS = ['employeeNumber', 'date', 'shiftCode'] as const;
