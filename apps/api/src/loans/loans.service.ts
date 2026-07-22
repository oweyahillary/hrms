import { BadRequestException, ConflictException, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { getRequestContext } from '../common/context/request-context';
import { advanceExceedsCap, computeInstallmentPlan, maxAdvancePrincipal } from './loan-math';
import { pickEffectiveStructure } from '../salary/salary-math';
import type { CreateLoanDto } from './dto/create-loan.dto';

interface RepaymentRow { id: string; payrollRunId: string; payslipId: string; amount: unknown; balanceAfter: unknown; createdAt: Date; }
interface StructureRow { basicSalary: unknown; effectiveDate: Date; endDate: Date | null; }
interface LoanRow {
  id: string; employeeId: string; type: string; principal: unknown; interestRate: unknown;
  numberOfInstallments: number; installmentAmount: unknown; balance: unknown; status: string;
  disbursedDate: Date; reason: string | null; createdAt: Date; repayments?: RepaymentRow[];
}

@Injectable()
export class LoansService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(employeeId: string, dto: CreateLoanDto) {
    await this.assertEmployee(employeeId);
    const ctx = getRequestContext();
    if (!ctx.userId) throw new InternalServerErrorException('Missing authenticated user in context');

    // Employment Act §19: an employer-issued ADVANCE may not exceed two months'
    // basic salary. Does NOT apply to a LOAN. Reject over-limit requests rather
    // than silently clamping the amount.
    if (dto.type === 'ADVANCE') {
      const structures = (await this.prisma.salaryStructure.findMany({
        where: { employeeId } as never,
      })) as unknown as StructureRow[];
      const structure = pickEffectiveStructure(structures, new Date(dto.disbursedDate));
      if (!structure) {
        throw new BadRequestException('Cannot issue an advance: no salary structure is in effect on the disbursement date.');
      }
      const basicSalary = Number(structure.basicSalary);
      if (advanceExceedsCap(dto.principal, basicSalary)) {
        throw new BadRequestException(
          `A salary advance may not exceed two months' basic salary (maximum ${maxAdvancePrincipal(basicSalary)} for this employee); requested ${dto.principal}.`,
        );
      }
    }

    const plan = computeInstallmentPlan({
      principal: dto.principal,
      interestRate: dto.interestRate ?? 0,
      numberOfInstallments: dto.numberOfInstallments,
    });

    const created = (await this.prisma.loan.create({
      data: {
        employeeId,
        type: dto.type,
        principal: dto.principal,
        interestRate: dto.interestRate ?? 0,
        numberOfInstallments: dto.numberOfInstallments,
        installmentAmount: plan.installmentAmount,
        balance: plan.totalPayable,
        disbursedDate: new Date(dto.disbursedDate),
        reason: dto.reason,
        createdById: ctx.userId,
      } as never,
    })) as unknown as LoanRow;
    return this.present(created);
  }

  async list(employeeId: string) {
    await this.assertEmployee(employeeId);
    const rows = (await this.prisma.loan.findMany({
      where: { employeeId } as never,
      orderBy: { disbursedDate: 'desc' },
    })) as unknown as LoanRow[];
    return rows.map((r) => this.present(r));
  }

  async findOne(id: string) {
    const row = await this.mustOwn(id, { repayments: { orderBy: { createdAt: 'asc' } } });
    return this.present(row);
  }

  async cancel(id: string) {
    const row = await this.mustOwn(id);
    if (row.status !== 'ACTIVE') {
      throw new ConflictException('Only an active loan/advance can be cancelled.');
    }
    const updated = (await this.prisma.loan.update({
      where: { id }, data: { status: 'CANCELLED' } as never,
    })) as unknown as LoanRow;
    return this.present(updated);
  }

  private async assertEmployee(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId } as never });
    if (!emp) throw new NotFoundException('Employee not found');
  }

  /** Scoped read-first: findFirst is org-filtered, so a hit proves ownership. */
  private async mustOwn(id: string, include?: Record<string, unknown>): Promise<LoanRow> {
    const row = (await this.prisma.loan.findFirst({
      where: { id } as never, include: include as never,
    })) as unknown as LoanRow | null;
    if (!row) throw new NotFoundException('Loan not found');
    return row;
  }

  private present(l: LoanRow) {
    const principal = Number(l.principal);
    const interestRate = Number(l.interestRate);
    const totalPayable = Math.round((principal + principal * (interestRate / 100) + Number.EPSILON) * 100) / 100;
    const balance = Number(l.balance);
    return {
      id: l.id, employeeId: l.employeeId, type: l.type,
      principal, interestRate, numberOfInstallments: l.numberOfInstallments,
      installmentAmount: Number(l.installmentAmount),
      balance, totalPayable, amountRepaid: Math.round((totalPayable - balance + Number.EPSILON) * 100) / 100,
      status: l.status, disbursedDate: l.disbursedDate, reason: l.reason, createdAt: l.createdAt,
      ...(l.repayments
        ? {
            repayments: l.repayments.map((r) => ({
              id: r.id, payrollRunId: r.payrollRunId, payslipId: r.payslipId,
              amount: Number(r.amount), balanceAfter: Number(r.balanceAfter), createdAt: r.createdAt,
            })),
          }
        : {}),
    };
  }
}
