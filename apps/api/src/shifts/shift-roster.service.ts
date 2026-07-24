import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { parseRosterRow, type RawRosterRow, type RowError } from './shift-roster-import';
import { readCsvRosterRows, readXlsxRosterRows } from './shift-roster-readers';
import type { ShiftDefinitionRow } from './shift-definitions.service';
import type { UpsertRosterDto } from './dto/upsert-roster.dto';
import type { QueryRosterDto } from './dto/query-roster.dto';

interface AssignmentRow {
  id: string; employeeId: string; date: Date; shiftDefinitionId: string; source: string;
}
interface EmployeeJoin { id: string; employeeNumber: string; firstName: string; lastName: string }

export interface RosterEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  date: Date;
  shiftDefinitionId: string;
  shiftCode: string;
  shiftName: string;
  source: string;
}

@Injectable()
export class ShiftRosterService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async getRoster(query: QueryRosterDto): Promise<RosterEntry[]> {
    return this.queryAndJoin({
      from: query.from, to: query.to,
      employeeWhere: query.departmentId ? { departmentId: query.departmentId } : undefined,
    });
  }

  /** Self-service: one employee's roster, no department filter — used by /me/shifts. */
  async getEmployeeRoster(employeeId: string, from: string, to: string): Promise<RosterEntry[]> {
    return this.queryAndJoin({ from, to, employeeId });
  }

  private async queryAndJoin(opts: {
    from: string; to: string; employeeId?: string; employeeWhere?: Record<string, unknown>;
  }): Promise<RosterEntry[]> {
    const where: Record<string, unknown> = {
      date: {
        gte: new Date(`${opts.from}T00:00:00.000Z`),
        lte: new Date(`${opts.to}T00:00:00.000Z`),
      },
    };
    if (opts.employeeId) where.employeeId = opts.employeeId;
    else if (opts.employeeWhere) where.employee = opts.employeeWhere;

    const rows = (await this.prisma.shiftAssignment.findMany({
      where: where as never, orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
    })) as unknown as AssignmentRow[];
    if (rows.length === 0) return [];

    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const shiftIds = [...new Set(rows.map((r) => r.shiftDefinitionId))];
    const [employees, shifts] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: employeeIds } }, select: { id: true, employeeNumber: true, firstName: true, lastName: true },
      }) as unknown as Promise<EmployeeJoin[]>,
      this.prisma.shiftDefinition.findMany({
        where: { id: { in: shiftIds } } as never,
      }) as unknown as Promise<ShiftDefinitionRow[]>,
    ]);
    const empById = new Map(employees.map((e) => [e.id, e]));
    const shiftById = new Map(shifts.map((s) => [s.id, s]));

    return rows.map((r) => {
      const emp = empById.get(r.employeeId);
      const shift = shiftById.get(r.shiftDefinitionId);
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeName: emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown',
        employeeNumber: emp?.employeeNumber ?? '—',
        date: r.date,
        shiftDefinitionId: r.shiftDefinitionId,
        shiftCode: shift?.code ?? '?',
        shiftName: shift?.name ?? 'Unknown shift',
        source: r.source,
      };
    });
  }

  async upsert(dto: UpsertRosterDto) {
    const emp = await this.prisma.employee.findFirst({ where: { id: dto.employeeId } });
    if (!emp) throw new BadRequestException('employeeId does not exist');
    const shift = (await this.prisma.shiftDefinition.findFirst({
      where: { id: dto.shiftDefinitionId } as never,
    })) as unknown as ShiftDefinitionRow | null;
    if (!shift) throw new BadRequestException('shiftDefinitionId does not exist');
    if (!shift.active) throw new BadRequestException(`Shift "${shift.code}" is inactive and cannot be assigned.`);

    const date = new Date(`${dto.date}T00:00:00.000Z`);
    const conflict = await this.leaveConflict(dto.employeeId, date);
    if (conflict) throw new BadRequestException(conflict);

    const record = await this.writeAssignment(dto.employeeId, date, dto.shiftDefinitionId, 'MANUAL');
    return this.toResponse(record);
  }

  /** Clears a single day's assignment — the "clear" action on the roster grid. */
  async remove(id: string) {
    const row = (await this.prisma.shiftAssignment.findFirst({ where: { id } as never })) as unknown as AssignmentRow | null;
    if (!row) throw new NotFoundException('Roster assignment not found');
    await this.prisma.shiftAssignment.delete({ where: { id } });
    return { success: true };
  }

  /** Import biometric-style roster CSV/XLSX. Resolves employeeNumber -> employee and shiftCode -> definition; skips bad rows. */
  async importFile(buffer: Buffer, format: 'csv' | 'xlsx') {
    let raw: RawRosterRow[];
    try {
      raw = format === 'xlsx' ? await readXlsxRosterRows(buffer) : readCsvRosterRows(buffer);
    } catch {
      throw new BadRequestException(`Could not parse the ${format.toUpperCase()} file`);
    }

    const errors: RowError[] = [];
    const candidates: Array<{ row: number; employeeNumber: string; date: string; shiftCode: string }> = [];
    raw.forEach((r, i) => {
      const rowNumber = i + 2; // +2: header is row 1
      const { record, error } = parseRosterRow(r, rowNumber);
      if (error) { errors.push(error); return; }
      candidates.push({ row: rowNumber, ...record! });
    });

    // Duplicate (employeeNumber, date) within the same file — the file's own upload, not a DB conflict.
    const seenAt = new Map<string, number>();
    const deduped: typeof candidates = [];
    for (const c of candidates) {
      const key = `${c.employeeNumber}|${c.date}`;
      const firstRow = seenAt.get(key);
      if (firstRow) {
        errors.push({ row: c.row, message: `duplicate employeeNumber+date in this file (already set on row ${firstRow})` });
        continue;
      }
      seenAt.set(key, c.row);
      deduped.push(c);
    }

    const numbers = [...new Set(deduped.map((c) => c.employeeNumber))];
    const codes = [...new Set(deduped.map((c) => c.shiftCode.toUpperCase()))];
    const [employees, shifts] = await Promise.all([
      this.prisma.employee.findMany({
        where: { employeeNumber: { in: numbers } }, select: { id: true, employeeNumber: true },
      }) as unknown as Promise<Array<{ id: string; employeeNumber: string }>>,
      this.prisma.shiftDefinition.findMany({
        where: { code: { in: codes } } as never,
      }) as unknown as Promise<ShiftDefinitionRow[]>,
    ]);
    const employeeIdByNumber = new Map(employees.map((e) => [e.employeeNumber, e.id]));
    const shiftByCode = new Map(shifts.map((s) => [s.code, s]));

    let imported = 0;
    for (const c of deduped) {
      const employeeId = employeeIdByNumber.get(c.employeeNumber);
      if (!employeeId) { errors.push({ row: c.row, message: `unknown employeeNumber "${c.employeeNumber}"` }); continue; }

      const shift = shiftByCode.get(c.shiftCode.toUpperCase());
      if (!shift) { errors.push({ row: c.row, message: `unknown shiftCode "${c.shiftCode}"` }); continue; }
      if (!shift.active) { errors.push({ row: c.row, message: `shiftCode "${c.shiftCode}" is inactive` }); continue; }

      const date = new Date(`${c.date}T00:00:00.000Z`);
      const conflict = await this.leaveConflict(employeeId, date);
      if (conflict) { errors.push({ row: c.row, message: conflict }); continue; }

      await this.writeAssignment(employeeId, date, shift.id, 'IMPORT');
      imported += 1;
    }

    return { imported, skipped: errors.length, errors };
  }

  private async leaveConflict(employeeId: string, date: Date): Promise<string | null> {
    const approved = await this.prisma.leaveRequest.findFirst({
      where: { employeeId, status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } } as never,
    });
    return approved ? 'Employee has an approved leave request covering this date.' : null;
  }

  /** Application-level upsert on (employeeId, date) — no DB unique conflict target for a raw SQL upsert here, same pattern as AttendanceService. */
  private async writeAssignment(
    employeeId: string, date: Date, shiftDefinitionId: string, source: string,
  ): Promise<AssignmentRow> {
    const existing = (await this.prisma.shiftAssignment.findFirst({
      where: { employeeId, date },
    })) as unknown as AssignmentRow | null;
    if (existing) {
      return (await this.prisma.shiftAssignment.update({
        where: { id: existing.id }, data: { shiftDefinitionId, source } as never,
      })) as unknown as AssignmentRow;
    }
    return (await this.prisma.shiftAssignment.create({
      data: { employeeId, date, shiftDefinitionId, source } as never,
    })) as unknown as AssignmentRow;
  }

  private toResponse(r: AssignmentRow) {
    return { id: r.id, employeeId: r.employeeId, date: r.date, shiftDefinitionId: r.shiftDefinitionId, source: r.source };
  }
}
