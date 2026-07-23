/**
 * Two format readers, one output shape (RawRosterRow[]) — both feed the same
 * parseRosterRow validator in shift-roster-import.ts, so adding a format
 * means adding a reader here, never touching the validation logic.
 */
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import type { RawRosterRow } from './shift-roster-import';

export function readCsvRosterRows(buffer: Buffer): RawRosterRow[] {
  return parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as RawRosterRow[];
}

/** Excel date cells arrive as JS Date objects — normalise to YYYY-MM-DD (UTC), matching the CSV column format. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellToString((value as { result: ExcelJS.CellValue }).result);
    if ('text' in value) return String((value as { text: unknown }).text ?? '');
    if ('richText' in value) {
      return (value as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
    }
  }
  return String(value);
}

export async function readXlsxRosterRows(buffer: Buffer): Promise<RawRosterRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = cellToString(cell.value).trim();
  });

  const rows: RawRosterRow[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    if (row.cellCount === 0) continue;
    const obj: Record<string, string> = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) obj[key] = cellToString(cell.value).trim();
    });
    if (Object.keys(obj).length > 0) rows.push(obj as RawRosterRow);
  }
  return rows;
}
