import { Inject, Injectable } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => (v == null ? 0 : Number(v));

interface PeriodSums {
  grossPay: unknown; paye: unknown; nssfEmployee: unknown; nssfEmployer: unknown;
  shif: unknown; ahlEmployee: unknown; ahlEmployer: unknown; otherDeductions: unknown; netPay: unknown;
}

@Injectable()
export class ReportsService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  /**
   * Aggregate finalized payslips for a period. PayrollRun is tenant-scoped by
   * the Prisma extension, so resolving run IDs first bounds the aggregation to
   * the current organization (Payslip has no organizationId of its own).
   */
  private async periodTotals(year: number, month: number): Promise<{
    runsFinalized: number; employeesPaid: number; sums: PeriodSums;
  }> {
    const runs = (await this.prisma.payrollRun.findMany({
      where: { periodYear: year, periodMonth: month, status: 'FINALIZED' } as never,
      select: { id: true },
    } as never)) as unknown as Array<{ id: string }>;
    const runIds = runs.map((r) => r.id);

    const zero: PeriodSums = {
      grossPay: 0, paye: 0, nssfEmployee: 0, nssfEmployer: 0, shif: 0,
      ahlEmployee: 0, ahlEmployer: 0, otherDeductions: 0, netPay: 0,
    };
    if (runIds.length === 0) return { runsFinalized: 0, employeesPaid: 0, sums: zero };

    const agg = (await this.prisma.payslip.aggregate({
      where: { payrollRunId: { in: runIds } } as never,
      _sum: {
        grossPay: true, paye: true, nssfEmployee: true, nssfEmployer: true, shif: true,
        ahlEmployee: true, ahlEmployer: true, otherDeductions: true, netPay: true,
      },
      _count: true,
    } as never)) as unknown as { _sum: PeriodSums; _count: number };

    return { runsFinalized: runIds.length, employeesPaid: agg._count, sums: agg._sum };
  }

  /** Totals an SME owner reviews after a payroll month closes. */
  async payrollSummary(year: number, month: number) {
    const { runsFinalized, employeesPaid, sums } = await this.periodTotals(year, month);
    const nssf = r2(num(sums.nssfEmployee) + num(sums.nssfEmployer));
    const ahl = r2(num(sums.ahlEmployee) + num(sums.ahlEmployer));
    return {
      period: { year, month },
      runsFinalized,
      employeesPaid,
      grossPay: r2(num(sums.grossPay)),
      paye: r2(num(sums.paye)),
      nssf: { employee: r2(num(sums.nssfEmployee)), employer: r2(num(sums.nssfEmployer)), total: nssf },
      shif: r2(num(sums.shif)),
      ahl: { employee: r2(num(sums.ahlEmployee)), employer: r2(num(sums.ahlEmployer)), total: ahl },
      otherDeductions: r2(num(sums.otherDeductions)),
      netPay: r2(num(sums.netPay)),
    };
  }

  /** What the employer must remit to each statutory body for the period. */
  async statutoryRemittance(year: number, month: number) {
    const { runsFinalized, employeesPaid, sums } = await this.periodTotals(year, month);
    const paye = r2(num(sums.paye));
    const nssfEe = r2(num(sums.nssfEmployee));
    const nssfEr = r2(num(sums.nssfEmployer));
    const shif = r2(num(sums.shif));
    const ahlEe = r2(num(sums.ahlEmployee));
    const ahlEr = r2(num(sums.ahlEmployer));
    return {
      period: { year, month },
      runsFinalized,
      employeesPaid,
      items: [
        { levy: 'PAYE', payTo: 'KRA', employee: paye, employer: 0, total: paye },
        { levy: 'NSSF', payTo: 'NSSF', employee: nssfEe, employer: nssfEr, total: r2(nssfEe + nssfEr) },
        { levy: 'SHIF', payTo: 'SHA', employee: shif, employer: 0, total: shif },
        { levy: 'AHL', payTo: 'Affordable Housing Levy (KRA)', employee: ahlEe, employer: ahlEr, total: r2(ahlEe + ahlEr) },
      ],
      grandTotal: r2(paye + nssfEe + nssfEr + shif + ahlEe + ahlEr),
    };
  }
}
