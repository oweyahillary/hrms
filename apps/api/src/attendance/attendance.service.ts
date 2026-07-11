import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import {
  deriveStatus, parseAttendanceRow, type RawAttendanceRow, type RowError,
} from './attendance-csv';
import type { UpsertAttendanceDto } from './dto/upsert-attendance.dto';
import type { QueryAttendanceDto } from './dto/query-attendance.dto';

interface AttendanceRow {
  id: string; employeeId: string; date: Date;
  clockIn: Date | null; clockOut: Date | null; status: string; source: string;
}

@Injectable()
export class AttendanceService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  /** One record per employee/day: update the existing day's record or create it. */
  async upsert(dto: UpsertAttendanceDto) {
    const emp = await this.prisma.employee.findFirst({ where: { id: dto.employeeId } });
    if (!emp) throw new BadRequestException('employeeId does not exist');

    const date = new Date(`${dto.date}T00:00:00.000Z`);
    const clockIn = dto.clockIn ? new Date(dto.clockIn) : null;
    const status = deriveStatus(dto.status ?? null, dto.clockIn ?? null);
    const record = await this.writeRecord(dto.employeeId, date, clockIn, dto.clockOut ? new Date(dto.clockOut) : null, status, 'MANUAL');
    return this.toResponse(record);
  }

  async list(query: QueryAttendanceDto) {
    const where: Record<string, unknown> = { employeeId: query.employeeId };
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) range.lte = new Date(`${query.to}T00:00:00.000Z`);
      where.date = range;
    }
    const rows = (await this.prisma.attendanceRecord.findMany({
      where, orderBy: { date: 'desc' },
    })) as unknown as AttendanceRow[];
    return rows.map((r) => this.toResponse(r));
  }

  /** Import biometric CSV. Resolves employeeNumber -> employee; skips bad rows. */
  async importCsv(buffer: Buffer) {
    let rows: RawAttendanceRow[];
    try {
      rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as RawAttendanceRow[];
    } catch {
      throw new BadRequestException('Could not parse CSV');
    }

    const parsed: ReturnType<typeof parseAttendanceRow>[] = rows.map((r, i) => parseAttendanceRow(r, i + 2)); // +2: header is row 1
    const errors: RowError[] = parsed.filter((p) => p.error).map((p) => p.error as RowError);
    const valid = parsed.filter((p) => p.record).map((p) => p.record!);

    // Resolve employeeNumbers in one query.
    const numbers = [...new Set(valid.map((v) => v.employeeNumber))];
    const employees = (await this.prisma.employee.findMany({
      where: { employeeNumber: { in: numbers } }, select: { id: true, employeeNumber: true },
    })) as unknown as Array<{ id: string; employeeNumber: string }>;
    const idByNumber = new Map(employees.map((e) => [e.employeeNumber, e.id]));

    let imported = 0;
    for (const [idx, rec] of valid.entries()) {
      const employeeId = idByNumber.get(rec.employeeNumber);
      if (!employeeId) {
        errors.push({ row: idx + 2, message: `unknown employeeNumber "${rec.employeeNumber}"` });
        continue;
      }
      const date = new Date(`${rec.date}T00:00:00.000Z`);
      const status = deriveStatus(rec.status, rec.clockIn);
      await this.writeRecord(
        employeeId, date,
        rec.clockIn ? new Date(rec.clockIn) : null,
        rec.clockOut ? new Date(rec.clockOut) : null,
        status, 'BIOMETRIC',
      );
      imported += 1;
    }

    return { imported, skipped: errors.length, errors };
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

  private toResponse(r: AttendanceRow) {
    return {
      id: r.id, employeeId: r.employeeId, date: r.date,
      clockIn: r.clockIn, clockOut: r.clockOut, status: r.status, source: r.source,
    };
  }
}
