import { ConflictException, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { getRequestContext } from '../common/context/request-context';
import type { CreatePayrollAdjustmentDto } from './dto/create-payroll-adjustment.dto';

interface AdjustmentRow {
  id: string; employeeId: string; type: string; amount: unknown; isTaxable: boolean; reason: string;
  targetPeriodMonth: number; targetPeriodYear: number; status: string;
  payrollRunId: string | null; payslipId: string | null; createdAt: Date;
}

@Injectable()
export class PayrollAdjustmentsService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(employeeId: string, dto: CreatePayrollAdjustmentDto) {
    await this.assertEmployee(employeeId);
    const ctx = getRequestContext();
    if (!ctx.userId) throw new InternalServerErrorException('Missing authenticated user in context');

    const created = (await this.prisma.payrollAdjustment.create({
      data: {
        employeeId,
        type: dto.type,
        amount: dto.amount,
        isTaxable: dto.type === 'BONUS' ? (dto.isTaxable ?? true) : false,
        reason: dto.reason,
        targetPeriodMonth: dto.targetPeriodMonth,
        targetPeriodYear: dto.targetPeriodYear,
        createdById: ctx.userId,
      } as never,
    })) as unknown as AdjustmentRow;
    return this.present(created);
  }

  async list(employeeId: string) {
    await this.assertEmployee(employeeId);
    const rows = (await this.prisma.payrollAdjustment.findMany({
      where: { employeeId } as never,
      orderBy: [{ targetPeriodYear: 'desc' }, { targetPeriodMonth: 'desc' }, { createdAt: 'desc' }],
    })) as unknown as AdjustmentRow[];
    return rows.map((r) => this.present(r));
  }

  async cancel(id: string) {
    const row = await this.mustOwn(id);
    if (row.status !== 'PENDING') {
      throw new ConflictException('Only a pending adjustment (not yet applied to a payroll run) can be cancelled.');
    }
    const updated = (await this.prisma.payrollAdjustment.update({
      where: { id }, data: { status: 'CANCELLED' } as never,
    })) as unknown as AdjustmentRow;
    return this.present(updated);
  }

  private async assertEmployee(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId } as never });
    if (!emp) throw new NotFoundException('Employee not found');
  }

  /** Scoped read-first: findFirst is org-filtered, so a hit proves ownership. */
  private async mustOwn(id: string): Promise<AdjustmentRow> {
    const row = (await this.prisma.payrollAdjustment.findFirst({
      where: { id } as never,
    })) as unknown as AdjustmentRow | null;
    if (!row) throw new NotFoundException('Payroll adjustment not found');
    return row;
  }

  private present(a: AdjustmentRow) {
    return {
      id: a.id, employeeId: a.employeeId, type: a.type, amount: Number(a.amount), isTaxable: a.isTaxable,
      reason: a.reason, targetPeriodMonth: a.targetPeriodMonth, targetPeriodYear: a.targetPeriodYear,
      status: a.status, payrollRunId: a.payrollRunId, payslipId: a.payslipId, createdAt: a.createdAt,
    };
  }
}
