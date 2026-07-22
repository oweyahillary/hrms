import { Inject, Injectable } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import {
  renderRemittancePdf, renderPayrollSummaryPdf, renderLoanBookPdf, renderSeveranceRegisterPdf,
  renderAdjustmentsRegisterPdf,
} from './reports-document';
import { buildLoanBook, buildSeveranceRegister, buildAdjustmentsRegister } from './reports-math';

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

  /** Monthly gross/net/PAYE/statutory/headcount across a year — dashboard trend. */
  async yearTrend(year: number) {
    const runs = (await this.prisma.payrollRun.findMany({
      where: { periodYear: year, status: 'FINALIZED' } as never,
      select: { id: true, periodMonth: true },
    } as never)) as unknown as Array<{ id: string; periodMonth: number }>;

    const idsByMonth = new Map<number, string[]>();
    for (const r of runs) {
      const list = idsByMonth.get(r.periodMonth) ?? [];
      list.push(r.id);
      idsByMonth.set(r.periodMonth, list);
    }

    const months = [];
    for (let m = 1; m <= 12; m += 1) {
      const ids = idsByMonth.get(m) ?? [];
      if (ids.length === 0) {
        months.push({ month: m, employeesPaid: 0, grossPay: 0, paye: 0, statutory: 0, netPay: 0 });
        continue;
      }
      const agg = (await this.prisma.payslip.aggregate({
        where: { payrollRunId: { in: ids } } as never,
        _sum: {
          grossPay: true, paye: true, nssfEmployee: true, nssfEmployer: true, shif: true,
          ahlEmployee: true, ahlEmployer: true, netPay: true,
        },
        _count: true,
      } as never)) as unknown as { _sum: PeriodSums; _count: number };
      const s = agg._sum;
      const statutory = r2(
        num(s.paye) + num(s.nssfEmployee) + num(s.nssfEmployer)
        + num(s.shif) + num(s.ahlEmployee) + num(s.ahlEmployer),
      );
      months.push({
        month: m,
        employeesPaid: agg._count,
        grossPay: r2(num(s.grossPay)),
        paye: r2(num(s.paye)),
        statutory,
        netPay: r2(num(s.netPay)),
      });
    }

    const totals = {
      grossPay: r2(months.reduce((t, x) => t + x.grossPay, 0)),
      paye: r2(months.reduce((t, x) => t + x.paye, 0)),
      statutory: r2(months.reduce((t, x) => t + x.statutory, 0)),
      netPay: r2(months.reduce((t, x) => t + x.netPay, 0)),
    };
    return { year, months, totals };
  }

  /** Current staffing snapshot: counts by status, and active headcount by department. */
  async headcount() {
    const byStatusRaw = (await this.prisma.employee.groupBy({
      by: ['employmentStatus'], _count: true,
    } as never)) as unknown as Array<{ employmentStatus: string; _count: number }>;

    const byStatus: Record<string, number> = { ACTIVE: 0, ON_LEAVE: 0, SUSPENDED: 0, EXITED: 0 };
    for (const g of byStatusRaw) byStatus[g.employmentStatus] = g._count;
    const total = Object.values(byStatus).reduce((t, n) => t + n, 0);

    const byDeptRaw = (await this.prisma.employee.groupBy({
      by: ['departmentId'], where: { employmentStatus: 'ACTIVE' } as never, _count: true,
    } as never)) as unknown as Array<{ departmentId: string | null; _count: number }>;

    const depts = (await this.prisma.department.findMany({
      select: { id: true, name: true },
    } as never)) as unknown as Array<{ id: string; name: string }>;
    const deptName = new Map(depts.map((d) => [d.id, d.name]));

    const activeByDepartment = byDeptRaw
      .map((g) => ({
        department: g.departmentId ? (deptName.get(g.departmentId) ?? 'Unknown') : 'Unassigned',
        activeCount: g._count,
      }))
      .sort((a, b) => b.activeCount - a.activeCount);

    return { total, active: byStatus.ACTIVE, byStatus, activeByDepartment };
  }

  private async employerName(): Promise<string> {
    const org = (await this.prisma.organization.findFirst({
      select: { name: true },
    } as never)) as unknown as { name: string } | null;
    return org?.name ?? '';
  }

  async remittancePdf(year: number, month: number): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.statutoryRemittance(year, month);
    const buffer = await renderRemittancePdf({
      employer: await this.employerName(),
      period: data.period,
      employeesPaid: data.employeesPaid,
      items: data.items,
      grandTotal: data.grandTotal,
      generatedAt: new Date(),
    });
    return { buffer, filename: `statutory-remittance-${year}-${String(month).padStart(2, '0')}.pdf` };
  }

  async payrollSummaryPdf(year: number, month: number): Promise<{ buffer: Buffer; filename: string }> {
    const d = await this.payrollSummary(year, month);
    const buffer = await renderPayrollSummaryPdf({
      employer: await this.employerName(),
      period: d.period,
      employeesPaid: d.employeesPaid,
      grossPay: d.grossPay,
      paye: d.paye,
      nssf: d.nssf,
      shif: d.shif,
      ahl: d.ahl,
      otherDeductions: d.otherDeductions,
      netPay: d.netPay,
      generatedAt: new Date(),
    });
    return { buffer, filename: `payroll-summary-${year}-${String(month).padStart(2, '0')}.pdf` };
  }

  private async employeeNames(ids: string[]): Promise<Map<string, { employeeName: string; employeeNumber: string }>> {
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return new Map();
    const emps = (await this.prisma.employee.findMany({
      where: { id: { in: uniq } } as never,
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
    } as never)) as unknown as Array<{ id: string; firstName: string; lastName: string; employeeNumber: string }>;
    return new Map(emps.map((e) => [e.id, { employeeName: `${e.firstName} ${e.lastName}`, employeeNumber: e.employeeNumber }]));
  }

  /**
   * Loan book: every loan/advance with principal, balance, installments
   * remaining and next due amount. totalOutstanding is the active-balance
   * exposure figure a CFO wants at a glance. Filterable by employee and status.
   */
  async loanBook(filter: { employeeId?: string; status?: string } = {}) {
    const where: Record<string, unknown> = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.status) where.status = filter.status;
    const loans = (await this.prisma.loan.findMany({
      where: where as never,
      orderBy: [{ status: 'asc' }, { disbursedDate: 'desc' }],
    } as never)) as unknown as Array<{
      id: string; employeeId: string; type: string; status: string;
      principal: unknown; balance: unknown; installmentAmount: unknown;
      disbursedDate: Date; reason: string | null;
    }>;

    const book = buildLoanBook(loans.map((l) => ({
      id: l.id, employeeId: l.employeeId, type: l.type, status: l.status,
      principal: num(l.principal), balance: num(l.balance), installmentAmount: num(l.installmentAmount),
      disbursedDate: l.disbursedDate.toISOString().slice(0, 10), reason: l.reason,
    })));
    const names = await this.employeeNames(book.rows.map((r) => r.employeeId));
    return {
      filter: { employeeId: filter.employeeId ?? null, status: filter.status ?? null },
      rows: book.rows.map((r) => ({ ...r, ...(names.get(r.employeeId) ?? { employeeName: '', employeeNumber: '' }) })),
      totals: book.totals,
      generatedAt: new Date(),
    };
  }

  /**
   * Severance register: every severance calculation with years of service,
   * severance amount, notice pay and PAYE status. PROVISIONAL_UNVERIFIED PAYE
   * is flagged per row and counted in totals so an auditor can't miss it.
   */
  async severanceRegister() {
    const calcs = (await this.prisma.severanceCalculation.findMany({
      orderBy: { exitDate: 'desc' },
    } as never)) as unknown as Array<{
      id: string; employeeId: string; exitDate: Date; reason: string;
      severanceAmount: unknown; noticePeriodDays: number; calculationBreakdown: unknown;
    }>;

    const reg = buildSeveranceRegister(calcs.map((c) => ({
      id: c.id, employeeId: c.employeeId, exitDate: c.exitDate.toISOString().slice(0, 10),
      reason: c.reason, severanceAmount: num(c.severanceAmount),
      noticePeriodDays: c.noticePeriodDays, calculationBreakdown: c.calculationBreakdown,
    })));
    const names = await this.employeeNames(reg.rows.map((r) => r.employeeId));
    return {
      rows: reg.rows.map((r) => ({ ...r, ...(names.get(r.employeeId) ?? { employeeName: '', employeeNumber: '' }) })),
      totals: reg.totals,
      generatedAt: new Date(),
    };
  }

  async loanBookPdf(filter: { employeeId?: string; status?: string } = {}): Promise<{ buffer: Buffer; filename: string }> {
    const d = await this.loanBook(filter);
    const buffer = await renderLoanBookPdf({
      employer: await this.employerName(),
      rows: d.rows, totals: d.totals, filter: d.filter, generatedAt: d.generatedAt,
    });
    return { buffer, filename: `loan-book-${new Date().toISOString().slice(0, 10)}.pdf` };
  }

  async severanceRegisterPdf(): Promise<{ buffer: Buffer; filename: string }> {
    const d = await this.severanceRegister();
    const buffer = await renderSeveranceRegisterPdf({
      employer: await this.employerName(),
      rows: d.rows, totals: d.totals, generatedAt: d.generatedAt,
    });
    return { buffer, filename: `severance-register-${new Date().toISOString().slice(0, 10)}.pdf` };
  }

  /**
   * Adjustments register: every bonus/deduction across the organisation — the
   * org-wide data source for the Deductions page, mirroring the loan book.
   * Filterable by employee, status and target period (year/month).
   */
  async adjustmentsRegister(filter: { employeeId?: string; status?: string; year?: number; month?: number } = {}) {
    const where: Record<string, unknown> = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.status) where.status = filter.status;
    if (filter.year) where.targetPeriodYear = filter.year;
    if (filter.month) where.targetPeriodMonth = filter.month;
    const adjustments = (await this.prisma.payrollAdjustment.findMany({
      where: where as never,
      orderBy: [{ targetPeriodYear: 'desc' }, { targetPeriodMonth: 'desc' }, { createdAt: 'desc' }],
    } as never)) as unknown as Array<{
      id: string; employeeId: string; type: string; amount: unknown; isTaxable: boolean;
      reason: string; targetPeriodMonth: number; targetPeriodYear: number; status: string;
    }>;

    const register = buildAdjustmentsRegister(adjustments.map((a) => ({
      id: a.id, employeeId: a.employeeId, type: a.type, amount: num(a.amount), isTaxable: a.isTaxable,
      reason: a.reason, targetPeriodMonth: a.targetPeriodMonth, targetPeriodYear: a.targetPeriodYear, status: a.status,
    })));
    const names = await this.employeeNames(register.rows.map((r) => r.employeeId));
    return {
      filter: {
        employeeId: filter.employeeId ?? null, status: filter.status ?? null,
        year: filter.year ?? null, month: filter.month ?? null,
      },
      rows: register.rows.map((r) => ({ ...r, ...(names.get(r.employeeId) ?? { employeeName: '', employeeNumber: '' }) })),
      totals: register.totals,
      generatedAt: new Date(),
    };
  }

  async adjustmentsRegisterPdf(
    filter: { employeeId?: string; status?: string; year?: number; month?: number } = {},
  ): Promise<{ buffer: Buffer; filename: string }> {
    const d = await this.adjustmentsRegister(filter);
    const buffer = await renderAdjustmentsRegisterPdf({
      employer: await this.employerName(),
      rows: d.rows, totals: d.totals, filter: d.filter, generatedAt: d.generatedAt,
    });
    return { buffer, filename: `adjustments-register-${new Date().toISOString().slice(0, 10)}.pdf` };
  }
}
