import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { StatutoryRatesService } from './statutory-rates.service';
import { assembleRateSet } from './rate-set';
import { computePayroll } from './payroll-engine';
import { deriveStructureAmounts, pickEffectiveStructure, type ComponentInput } from '../salary/salary-math';
import { buildP9Card, type P9MonthFigures } from './p9-model';
import { renderP9Pdf } from './p9-document';

interface EmpRow {
  employeeNumber: string; firstName: string; lastName: string; kraPin: string | null;
}
interface ComponentRow { componentType: string; amount: unknown; isTaxable: boolean; }
interface StructureRow {
  employeeId: string; basicSalary: unknown; effectiveDate: Date; endDate: Date | null; components: ComponentRow[];
}
interface SlipRow { paye: unknown; payrollRun: { periodMonth: number } }
interface OrgRow { name: string; kraPin: string | null }

@Injectable()
export class P9Service {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly crypto: CryptoService,
    private readonly rates: StatutoryRatesService,
  ) {}

  /**
   * Build an employee's P9 card for a year from their FINALIZED payslips. Each
   * month is recomputed through the same engine path the run used (same
   * effective salary structure + period rates), so the card's PAYE reconciles
   * to what was actually deducted — surfaced per-row and in aggregate.
   */
  async cardForEmployee(employeeId: string, year: number) {
    const emp = (await this.prisma.employee.findFirst({
      where: { id: employeeId } as never,
      select: { employeeNumber: true, firstName: true, lastName: true, kraPin: true },
    } as never)) as unknown as EmpRow | null;
    if (!emp) throw new NotFoundException('Employee not found');

    const org = (await this.prisma.organization.findFirst({
      select: { name: true, kraPin: true },
    } as never)) as unknown as OrgRow | null;

    // Finalized payslips for this employee in the requested year.
    const slips = (await this.prisma.payslip.findMany({
      where: { employeeId, payrollRun: { periodYear: year, status: 'FINALIZED' } } as never,
      select: { paye: true, payrollRun: { select: { periodMonth: true } } },
    } as never)) as unknown as SlipRow[];

    // All salary structures for this employee, for effective-date resolution.
    const structures = (await this.prisma.salaryStructure.findMany({
      where: { employeeId } as never, include: { components: true },
    } as never)) as unknown as StructureRow[];

    const months: P9MonthFigures[] = [];
    for (const slip of slips) {
      const month = slip.payrollRun.periodMonth;
      const asOf = new Date(Date.UTC(year, month, 0)); // last day of the period month
      const struct = pickEffectiveStructure(structures, asOf);
      if (!struct) continue; // finalized month without a resolvable structure — skip defensively

      const comps: ComponentInput[] = struct.components.map((c) => ({
        componentType: c.componentType as ComponentInput['componentType'],
        amount: Number(c.amount), isTaxable: c.isTaxable,
      }));
      const d = deriveStructureAmounts(Number(struct.basicSalary), comps);
      const rateSet = assembleRateSet((await this.rates.effective(asOf.toISOString().slice(0, 10))).rates);
      const b = computePayroll(
        { grossPay: d.gross, taxableGross: d.taxableGross, pensionablePay: d.pensionable }, rateSet,
      );

      months.push({
        month,
        basicSalary: Number(struct.basicSalary),
        grossPay: b.grossPay,
        pensionContribution: b.nssf.employee,
        ahl: b.ahl,
        shif: b.shif,
        taxCharged: b.payeBeforeRelief,
        personalRelief: b.personalRelief,
        payeDeducted: Number(slip.paye),
      });
    }

    const card = buildP9Card(months);
    const employeePin = emp.kraPin && this.crypto.isEncrypted(emp.kraPin)
      ? await this.crypto.decrypt(emp.kraPin)
      : emp.kraPin;

    return {
      year,
      employer: { name: org?.name ?? '', kraPin: org?.kraPin ?? '' },
      employee: {
        employeeNumber: emp.employeeNumber,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        kraPin: employeePin ?? '',
      },
      monthsIncluded: card.rows.length,
      reconciles: card.reconciles,
      rows: card.rows,
      totals: card.totals,
    };
  }

  /** Render the employee's P9 card for a year as a KRA-layout PDF. */
  async pdfForEmployee(employeeId: string, year: number): Promise<{ buffer: Buffer; filename: string }> {
    const card = await this.cardForEmployee(employeeId, year);
    const buffer = await renderP9Pdf({
      year: card.year,
      employer: card.employer,
      employee: {
        name: card.employee.name,
        employeeNumber: card.employee.employeeNumber,
        kraPin: card.employee.kraPin,
      },
      rows: card.rows,
      totals: card.totals,
      reconciles: card.reconciles,
      generatedAt: new Date(),
    });
    return { buffer, filename: `P9-${card.employee.employeeNumber}-${year}.pdf` };
  }
}
