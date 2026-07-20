import {
  BadRequestException, Inject, Injectable, InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { getRequestContext } from '../common/context/request-context';
import { StatutoryRatesService } from '../payroll/statutory-rates.service';
import { assembleRateSet } from '../payroll/rate-set';
import { computePayeTax, round2 } from '../payroll/payroll-engine';
import { pickEffectiveStructure } from '../salary/salary-math';
import {
  buildSeveranceComputation, daysPerMonthForBasis,
  type ExitReason, type PayFrequency, type SeveranceDayRateBasis,
} from './severance-math';
import type { CreateSeveranceDto } from './dto/create-severance.dto';

interface EmployeeRow { id: string; hireDate: Date; }
interface StructureRow { basicSalary: unknown; effectiveDate: Date; endDate: Date | null; }
interface SeveranceRow {
  id: string; employeeId: string; exitDate: Date; reason: string; noticePeriodDays: number;
  severanceAmount: unknown; calculationBreakdown: unknown; calculatedById: string; createdAt: Date;
}

/**
 * Provisional PAYE treatment of the severance lump sum.
 *
 * ⚠️  UNVERIFIED — DO NOT TRUST FOR A REAL PAYOUT WITHOUT KRA GUIDANCE.
 * Kenyan practice on taxing a severance/redundancy lump sum (spreading the
 * amount back across the years of service, and any exemption threshold) is not
 * settled between the sources we have, so we do NOT hardcode a spreading rule or
 * an exemption number here. As an interim, we tax the FULL gross severance as
 * ordinary taxable income for the exit month using the standard PAYE bands and
 * personal relief only — no spreading, no exemption, and none of the monthly
 * statutory deductions (NSSF/SHIF/AHL), which do not apply to a lump sum. See
 * docs/severance.md. When KRA guidance is confirmed, change it there and here.
 */
const PAYE_NOTE =
  'PROVISIONAL / UNVERIFIED: full gross taxed as ordinary income for the exit ' +
  'month (PAYE bands + personal relief only; no spreading, no exemption, no ' +
  'NSSF/SHIF/AHL). Requires KRA guidance before a real payout — see docs/severance.md.';

@Injectable()
export class SeveranceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly rates: StatutoryRatesService,
  ) {}

  async create(employeeId: string, dto: CreateSeveranceDto) {
    const ctx = getRequestContext();
    if (!ctx.userId) throw new InternalServerErrorException('Missing authenticated user in context');

    const employee = (await this.prisma.employee.findFirst({
      where: { id: employeeId } as never,
    })) as unknown as EmployeeRow | null;
    if (!employee) throw new NotFoundException('Employee not found');

    const exitDate = new Date(dto.exitDate);

    // Basic salary in force ON the exit date — a severance run months after a
    // raise/cut must use the structure that actually applied at exit.
    const structures = (await this.prisma.salaryStructure.findMany({
      where: { employeeId } as never,
    })) as unknown as StructureRow[];
    const structure = pickEffectiveStructure(structures, exitDate);
    if (!structure) {
      throw new BadRequestException('No salary structure is in effect on the exit date for this employee.');
    }
    const basicSalary = Number(structure.basicSalary);

    // The day-rate basis is an organisation setting (÷30 vs ÷26). Snapshot the
    // resolved divisor into this calculation so editing the org setting later
    // never retroactively changes what was already worked out here.
    const org = (await this.prisma.organization.findFirst({
      where: { id: ctx.organizationId } as never,
      select: { severanceDayRateBasis: true } as never,
    })) as unknown as { severanceDayRateBasis: SeveranceDayRateBasis } | null;
    const daysPerMonth = daysPerMonthForBasis(org?.severanceDayRateBasis ?? 'CALENDAR_30');

    const { severance, notice, breakdown } = buildSeveranceComputation({
      reason: dto.reason as ExitReason,
      hireDate: employee.hireDate,
      exitDate,
      basicSalary,
      payFrequency: dto.payFrequency as PayFrequency,
      contractualNoticeDays: dto.contractualNoticeDays ?? null,
      daysPerMonth,
    });

    breakdown.paye = await this.provisionalPaye(severance.gross, exitDate);
    breakdown.totals = {
      severanceGross: severance.gross,
      noticePayInLieu: notice.payInLieu,
      // Informational only — accrued leave, final salary, etc. are out of scope here.
      grossExitPay: round2(severance.gross + notice.payInLieu),
    };

    const created = (await this.prisma.severanceCalculation.create({
      data: {
        employeeId,
        exitDate,
        reason: dto.reason,
        noticePeriodDays: notice.appliedDays,
        severanceAmount: severance.gross,
        calculationBreakdown: breakdown as never,
        calculatedById: ctx.userId,
      } as never,
    })) as unknown as SeveranceRow;

    return this.present(created);
  }

  async list(employeeId: string) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId } as never });
    if (!emp) throw new NotFoundException('Employee not found');
    const rows = (await this.prisma.severanceCalculation.findMany({
      where: { employeeId } as never,
      orderBy: { createdAt: 'desc' },
    })) as unknown as SeveranceRow[];
    return rows.map((r) => this.present(r));
  }

  async findOne(id: string) {
    const row = (await this.prisma.severanceCalculation.findFirst({
      where: { id } as never,
    })) as unknown as SeveranceRow | null;
    if (!row) throw new NotFoundException('Severance calculation not found');
    return this.present(row);
  }

  /**
   * Provisional PAYE on the severance lump sum. Best-effort: if no statutory
   * rates are in force it degrades to an "unavailable" marker rather than
   * blocking the (rate-independent) severance entitlement itself.
   */
  private async provisionalPaye(gross: number, asOf: Date): Promise<Record<string, unknown>> {
    if (gross <= 0) {
      return { status: 'N/A', paye: 0, net: 0, note: 'No severance — no tax.' };
    }
    try {
      const rateSet = assembleRateSet((await this.rates.effective(asOf.toISOString().slice(0, 10))).rates);
      const payeBeforeRelief = computePayeTax(gross, rateSet.paye);
      const paye = round2(Math.max(0, payeBeforeRelief - rateSet.paye.personalRelief));
      return {
        status: 'PROVISIONAL_UNVERIFIED',
        method: 'ordinary-income PAYE bands on full gross; personal relief applied; no spreading/exemption',
        taxableGross: gross,
        payeBeforeRelief,
        personalRelief: rateSet.paye.personalRelief,
        paye,
        net: round2(gross - paye),
        note: PAYE_NOTE,
      };
    } catch {
      return {
        status: 'UNAVAILABLE',
        paye: null,
        net: null,
        note: `${PAYE_NOTE} (No effective statutory rate found for the exit date — PAYE not computed.)`,
      };
    }
  }

  private present(r: SeveranceRow) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      exitDate: r.exitDate,
      reason: r.reason,
      noticePeriodDays: r.noticePeriodDays,
      severanceAmount: Number(r.severanceAmount),
      calculationBreakdown: r.calculationBreakdown,
      calculatedById: r.calculatedById,
      createdAt: r.createdAt,
    };
  }
}
