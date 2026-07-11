import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { availableDays } from './leave-math';
import type { UpsertLeaveBalanceDto } from './dto/upsert-leave-balance.dto';

interface BalanceRow {
  id: string; employeeId: string; leaveTypeId: string; year: number;
  accruedDays: unknown; usedDays: unknown; carriedOverDays: unknown; updatedAt: Date;
  leaveType?: { name: string };
}

const num = (v: unknown): number => Number(v ?? 0);

@Injectable()
export class LeaveBalancesService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  /** HR sets or tops up a balance. usedDays is managed by the approval flow, not here. */
  async upsert(dto: UpsertLeaveBalanceDto) {
    await this.assertRefs(dto.employeeId, dto.leaveTypeId);

    const existing = (await this.prisma.leaveBalance.findFirst({
      where: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year },
    })) as unknown as BalanceRow | null;

    const row = existing
      ? ((await this.prisma.leaveBalance.update({
          where: { id: existing.id },
          data: { accruedDays: dto.accruedDays, carriedOverDays: dto.carriedOverDays ?? 0 } as never,
          include: { leaveType: { select: { name: true } } },
        })) as unknown as BalanceRow)
      : ((await this.prisma.leaveBalance.create({
          data: {
            employeeId: dto.employeeId,
            leaveTypeId: dto.leaveTypeId,
            year: dto.year,
            accruedDays: dto.accruedDays,
            carriedOverDays: dto.carriedOverDays ?? 0,
          } as never,
          include: { leaveType: { select: { name: true } } },
        })) as unknown as BalanceRow);

    return this.toResponse(row);
  }

  async listForEmployee(employeeId: string, year?: number) {
    const where: Record<string, unknown> = { employeeId };
    if (year !== undefined) where.year = year;
    const rows = (await this.prisma.leaveBalance.findMany({
      where, orderBy: { year: 'desc' }, include: { leaveType: { select: { name: true } } },
    })) as unknown as BalanceRow[];
    return rows.map((r) => this.toResponse(r));
  }

  private async assertRefs(employeeId: string, leaveTypeId: string): Promise<void> {
    const [emp, type] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: employeeId } }),
      this.prisma.leaveType.findFirst({ where: { id: leaveTypeId } }),
    ]);
    if (!emp) throw new BadRequestException('employeeId does not exist');
    if (!type) throw new BadRequestException('leaveTypeId does not exist');
  }

  private toResponse(row: BalanceRow) {
    const accrued = num(row.accruedDays);
    const carriedOver = num(row.carriedOverDays);
    const used = num(row.usedDays);
    return {
      id: row.id,
      employeeId: row.employeeId,
      leaveTypeId: row.leaveTypeId,
      leaveTypeName: row.leaveType?.name,
      year: row.year,
      accruedDays: accrued,
      carriedOverDays: carriedOver,
      usedDays: used,
      availableDays: availableDays(accrued, carriedOver, used),
      updatedAt: row.updatedAt,
    };
  }
}
