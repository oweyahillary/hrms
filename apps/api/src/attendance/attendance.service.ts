import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { getRequestContext } from '../common/context/request-context';
import { deriveStatus, lateMinutes as computeLateMinutes, type ShiftWindow } from './derive-status';
import { parseAttendanceRow, type RowError } from './attendance-csv';
import {
  neutralPreset, isZkDayExport, zkDayExportPreset, extractZkPunches, groupZkPunches,
  type ImportPreset, type RawCsvRow, type SourcedRow,
} from './attendance-import-presets';
import type { Punch } from './punch-pairing';
import type { UpsertAttendanceDto } from './dto/upsert-attendance.dto';
import type { QueryAttendanceDto } from './dto/query-attendance.dto';

interface AttendanceRow {
  id: string; employeeId: string; date: Date;
  clockIn: Date | null; clockOut: Date | null; status: string; source: string;
}
interface ShiftDefRow { id: string; code: string; startTime: string; active: boolean; crossesMidnight: boolean }
interface ShiftAssignmentRow { employeeId: string; date: Date; shiftDefinitionId: string }

const DEFAULT_GRACE_MINUTES = 15;

@Injectable()
export class AttendanceService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  /** One record per employee/day: update the existing day's record or create it. */
  async upsert(dto: UpsertAttendanceDto) {
    const emp = await this.prisma.employee.findFirst({ where: { id: dto.employeeId } });
    if (!emp) throw new BadRequestException('employeeId does not exist');

    const date = new Date(`${dto.date}T00:00:00.000Z`);
    const clockIn = dto.clockIn ? new Date(dto.clockIn) : null;
    const clockOut = dto.clockOut ? new Date(dto.clockOut) : null;

    let status = dto.status ?? null;
    if (!status) {
      const grace = await this.lateGraceMinutes();
      const general = await this.generalShift();
      const { shift } = await this.resolveShiftFor(dto.employeeId, date, general);
      status = shift ? deriveStatus(clockIn, clockOut, shift, grace) : (clockIn ? 'PRESENT' : 'ABSENT');
    }

    const record = await this.writeRecord(dto.employeeId, date, clockIn, clockOut, status, 'MANUAL');
    return this.toResponse(record, await this.enrichOne(record));
  }

  /**
   * employeeId narrows to one person's history (self-service, or an HR
   * lookup on one employee). Omitting it returns an org-wide register for
   * the date range instead — the tenant extension still bounds it to the
   * caller's org via attendanceRecord's own organizationId, exactly as with
   * employeeId set. departmentId (only meaningful without employeeId)
   * narrows that register to one department via the employee relation.
   */
  async list(query: QueryAttendanceDto) {
    const where: Record<string, unknown> = {};
    if (query.employeeId) where.employeeId = query.employeeId;
    else if (query.departmentId) where.employee = { departmentId: query.departmentId };
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) range.lte = new Date(`${query.to}T00:00:00.000Z`);
      where.date = range;
    }
    const rows = (await this.prisma.attendanceRecord.findMany({
      where: where as never, orderBy: [{ date: 'desc' }, { employeeId: 'asc' }],
    })) as unknown as AttendanceRow[];
    if (rows.length === 0) return [];

    // One batched lookup for the whole result set instead of one per row —
    // works the same whether this is one employee's history or an org-wide
    // register, since the (employeeId, date) key still identifies each row.
    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const dates = [...new Set(rows.map((r) => r.date.getTime()))].map((t) => new Date(t));
    const assignments = (await this.prisma.shiftAssignment.findMany({
      where: { employeeId: { in: employeeIds }, date: { in: dates } } as never,
    })) as unknown as ShiftAssignmentRow[];
    const shiftIds = [...new Set(assignments.map((a) => a.shiftDefinitionId))];
    const shiftDefs = shiftIds.length
      ? (await this.prisma.shiftDefinition.findMany({ where: { id: { in: shiftIds } } as never })) as unknown as ShiftDefRow[]
      : [];
    const general = await this.generalShift();
    const assignmentByKey = new Map(assignments.map((a) => [`${a.employeeId}|${a.date.getTime()}`, a]));
    const shiftById = new Map(shiftDefs.map((s) => [s.id, s]));

    return rows.map((r) => {
      const assignment = assignmentByKey.get(`${r.employeeId}|${r.date.getTime()}`);
      const assignedShift = assignment ? shiftById.get(assignment.shiftDefinitionId) : undefined;
      const shift: ShiftWindow | null = assignedShift ?? general;
      return this.toResponse(r, {
        shiftCode: assignedShift?.code ?? null,
        unassigned: !assignment,
        lateMinutes: shift ? computeLateMinutes(r.clockIn, shift) : 0,
      });
    });
  }

  /**
   * Import a biometric-style CSV. preset NEUTRAL keeps today's columns
   * unchanged; ZKTECO auto-detects a punch-event export (grouped via
   * pairPunches, crossesMidnight-aware) vs a day-summary export (already
   * one row per employee/day). All three funnel into the same neutral rows
   * -> parseAttendanceRow validation -> employeeNumber resolution -> write
   * path — the format only changes how SourcedRow[] gets built.
   */
  async importCsv(buffer: Buffer, preset: ImportPreset = 'NEUTRAL') {
    let rawRows: RawCsvRow[];
    try {
      rawRows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as RawCsvRow[];
    } catch {
      throw new BadRequestException('Could not parse CSV');
    }

    let sourced: SourcedRow[];
    let presetErrors: RowError[] = [];

    if (preset === 'NEUTRAL') {
      sourced = neutralPreset(rawRows);
    } else if (isZkDayExport(rawRows)) {
      sourced = zkDayExportPreset(rawRows);
    } else {
      const extracted = extractZkPunches(rawRows);
      presetErrors = extracted.errors;
      const dateFor = await this.buildNightShiftAwareDateFor(extracted.punches);
      sourced = groupZkPunches(extracted.punches, dateFor);
    }

    const parsed = sourced.map((s) => ({ ...parseAttendanceRow(s.row, s.sourceRow), sourceRow: s.sourceRow, sourceLabel: s.sourceLabel }));
    const errors: RowError[] = [
      ...presetErrors,
      ...parsed.filter((p) => p.error).map((p) => ({
        row: p.error!.row,
        message: p.sourceLabel ? `${p.sourceLabel}: ${p.error!.message}` : p.error!.message,
      })),
    ];
    // Keep each valid record paired with its own sourceRow — valid is a
    // FILTERED subset, so a plain array index no longer lines up with the
    // original row once any earlier row was rejected (a pre-existing bug
    // in this file before this change, now fixed alongside it).
    const valid = parsed.filter((p) => p.record).map((p) => ({ record: p.record!, sourceRow: p.sourceRow, sourceLabel: p.sourceLabel }));

    // Resolve employeeNumbers in one query.
    const numbers = [...new Set(valid.map((v) => v.record.employeeNumber))];
    const employees = (await this.prisma.employee.findMany({
      where: { employeeNumber: { in: numbers } }, select: { id: true, employeeNumber: true },
    })) as unknown as Array<{ id: string; employeeNumber: string }>;
    const idByNumber = new Map(employees.map((e) => [e.employeeNumber, e.id]));

    // Batch-invariant lookups fetched once, not per row.
    const grace = await this.lateGraceMinutes();
    const general = await this.generalShift();

    let imported = 0;
    for (const { record: rec, sourceRow, sourceLabel } of valid) {
      const employeeId = idByNumber.get(rec.employeeNumber);
      if (!employeeId) {
        const message = `unknown employeeNumber "${rec.employeeNumber}"`;
        errors.push({ row: sourceRow, message: sourceLabel ? `${sourceLabel}: ${message}` : message });
        continue;
      }
      const date = new Date(`${rec.date}T00:00:00.000Z`);
      const clockIn = rec.clockIn ? new Date(rec.clockIn) : null;
      const clockOut = rec.clockOut ? new Date(rec.clockOut) : null;

      let status = rec.status ?? null;
      if (!status) {
        const { shift } = await this.resolveShiftFor(employeeId, date, general);
        status = shift ? deriveStatus(clockIn, clockOut, shift, grace) : (clockIn ? 'PRESENT' : 'ABSENT');
      }

      await this.writeRecord(employeeId, date, clockIn, clockOut, status, 'BIOMETRIC');
      imported += 1;
    }

    return { imported, skipped: errors.length, errors };
  }

  /**
   * Writes/updates an AttendanceRecord from device-derived punches (see
   * src/attendance-devices), deriving status the same way upsert()/
   * importCsv() do. Never overwrites a MANUAL-sourced record — there's no
   * separate "was this status explicit" flag on the row, so `source` IS
   * that signal: MANUAL means HR touched this day directly and it's never
   * clobbered by (re-)materialization; BIOMETRIC is always safe to rewrite,
   * which is also what makes re-materialization idempotent.
   */
  async materializeFromPunches(employeeId: string, dateStr: string, clockIn: Date, clockOut: Date | null): Promise<void> {
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    const existing = (await this.prisma.attendanceRecord.findFirst({
      where: { employeeId, date },
    })) as unknown as AttendanceRow | null;
    if (existing?.source === 'MANUAL') return;

    const grace = await this.lateGraceMinutes();
    const general = await this.generalShift();
    const { shift } = await this.resolveShiftFor(employeeId, date, general);
    const status = shift ? deriveStatus(clockIn, clockOut, shift, grace) : 'PRESENT';
    await this.writeRecord(employeeId, date, clockIn, clockOut, status, 'BIOMETRIC');
  }

  /**
   * A synchronous dateFor for pairPunches (see punch-pairing.ts) that
   * attributes an early-morning punch to the PREVIOUS day when — and only
   * when — that employee actually has a crossesMidnight shift assignment
   * starting that previous day. Pre-fetches every relevant ShiftAssignment
   * in one query so pairPunches itself stays a pure, DB-free function.
   * Public: src/attendance-devices reuses this verbatim for materializing
   * device-pushed punches, same as the CSV/ZK import path.
   */
  async buildNightShiftAwareDateFor(
    punches: Punch[],
  ): Promise<(employeeNumber: string, timestamp: Date) => string> {
    if (punches.length === 0) return (_e, ts) => ts.toISOString().slice(0, 10);

    const numbers = [...new Set(punches.map((p) => p.employeeNumber))];
    const employees = (await this.prisma.employee.findMany({
      where: { employeeNumber: { in: numbers } }, select: { id: true, employeeNumber: true },
    })) as unknown as Array<{ id: string; employeeNumber: string }>;
    const numberById = new Map(employees.map((e) => [e.id, e.employeeNumber]));
    const employeeIds = employees.map((e) => e.id);
    if (employeeIds.length === 0) return (_e, ts) => ts.toISOString().slice(0, 10);

    const timestamps = punches.map((p) => p.timestamp.getTime());
    const minDate = new Date(Math.min(...timestamps));
    minDate.setUTCDate(minDate.getUTCDate() - 1);
    const maxDate = new Date(Math.max(...timestamps));
    maxDate.setUTCDate(maxDate.getUTCDate() + 1);

    const assignments = (await this.prisma.shiftAssignment.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: minDate, lte: maxDate } } as never,
    })) as unknown as ShiftAssignmentRow[];
    if (assignments.length === 0) return (_e, ts) => ts.toISOString().slice(0, 10);

    const shiftIds = [...new Set(assignments.map((a) => a.shiftDefinitionId))];
    const shiftDefs = (await this.prisma.shiftDefinition.findMany({
      where: { id: { in: shiftIds } } as never,
    })) as unknown as ShiftDefRow[];
    const crossesMidnightIds = new Set(shiftDefs.filter((s) => s.crossesMidnight).map((s) => s.id));

    // employeeNumber -> set of dates (YYYY-MM-DD) that START a crossesMidnight shift.
    const nightStartDates = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!crossesMidnightIds.has(a.shiftDefinitionId)) continue;
      const employeeNumber = numberById.get(a.employeeId);
      if (!employeeNumber) continue;
      const set = nightStartDates.get(employeeNumber) ?? new Set<string>();
      set.add(a.date.toISOString().slice(0, 10));
      nightStartDates.set(employeeNumber, set);
    }

    return (employeeNumber: string, ts: Date): string => {
      const calendarDate = ts.toISOString().slice(0, 10);
      if (ts.getUTCHours() < 12) {
        const prev = new Date(ts);
        prev.setUTCDate(prev.getUTCDate() - 1);
        const prevStr = prev.toISOString().slice(0, 10);
        if (nightStartDates.get(employeeNumber)?.has(prevStr)) return prevStr;
      }
      return calendarDate;
    };
  }

  /** Application-level upsert (no DB unique on employee+date). */
  private async writeRecord(
    employeeId: string, date: Date, clockIn: Date | null, clockOut: Date | null, status: string, source: string,
  ): Promise<AttendanceRow> {
    const existing = (await this.prisma.attendanceRecord.findFirst({
      where: { employeeId, date },
    })) as unknown as AttendanceRow | null;

    if (existing) {
      return (await this.prisma.attendanceRecord.update({
        where: { id: existing.id }, data: { clockIn, clockOut, status, source } as never,
      })) as unknown as AttendanceRow;
    }
    return (await this.prisma.attendanceRecord.create({
      data: { employeeId, date, clockIn, clockOut, status, source } as never,
    })) as unknown as AttendanceRow;
  }

  /** The ShiftDefinition applying to employeeId on date — their actual assignment if one exists, else the org's General ('G') shift as a fallback for derivation only (never surfaced as if it were a real assignment). */
  private async resolveShiftFor(
    employeeId: string, date: Date, general: ShiftDefRow | null,
  ): Promise<{ shift: ShiftDefRow | null; assigned: boolean }> {
    const assignment = (await this.prisma.shiftAssignment.findFirst({
      where: { employeeId, date } as never,
    })) as unknown as ShiftAssignmentRow | null;
    if (assignment) {
      const def = (await this.prisma.shiftDefinition.findFirst({
        where: { id: assignment.shiftDefinitionId } as never,
      })) as unknown as ShiftDefRow | null;
      if (def) return { shift: def, assigned: true };
    }
    return { shift: general, assigned: false };
  }

  private async generalShift(): Promise<ShiftDefRow | null> {
    return (await this.prisma.shiftDefinition.findFirst({
      where: { code: 'G' } as never,
    })) as unknown as ShiftDefRow | null;
  }

  private async lateGraceMinutes(): Promise<number> {
    const orgId = getRequestContext().organizationId;
    if (!orgId) return DEFAULT_GRACE_MINUTES;
    // Organization is deliberately unscoped by the tenant extension (it IS
    // the tenant) — filter by the request's own org explicitly, never a
    // bare findFirst() (see the T1 summary's note on approvalPolicy()'s bug
    // of exactly this shape).
    const org = (await this.prisma.organization.findFirst({
      where: { id: orgId }, select: { lateGraceMinutes: true },
    } as never)) as unknown as { lateGraceMinutes: number } | null;
    return org?.lateGraceMinutes ?? DEFAULT_GRACE_MINUTES;
  }

  /** For a single freshly-written record (upsert path) — same shape as the batched list() enrichment. */
  private async enrichOne(r: AttendanceRow): Promise<{ shiftCode: string | null; unassigned: boolean; lateMinutes: number }> {
    const general = await this.generalShift();
    const { shift, assigned } = await this.resolveShiftFor(r.employeeId, r.date, general);
    return {
      shiftCode: assigned ? (shift?.code ?? null) : null,
      unassigned: !assigned,
      lateMinutes: shift ? computeLateMinutes(r.clockIn, shift) : 0,
    };
  }

  private toResponse(r: AttendanceRow, enrichment: { shiftCode: string | null; unassigned: boolean; lateMinutes: number }) {
    return {
      id: r.id, employeeId: r.employeeId, date: r.date,
      clockIn: r.clockIn, clockOut: r.clockOut, status: r.status, source: r.source,
      shiftCode: enrichment.shiftCode, unassigned: enrichment.unassigned, lateMinutes: enrichment.lateMinutes,
    };
  }
}
