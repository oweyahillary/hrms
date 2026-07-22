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
  buildSeveranceComputation, daysPerMonthForBasis, classifySeveranceTaxTreatment,
  type ExitReason, type PayFrequency, type SeveranceDayRateBasis,
  type ContractTermType, type SeveranceTaxSpread,
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
 * ⚠️  PROVISIONAL / UNVERIFIED — the flag reflects that the methodology has not
 * had a tax firm's sign-off, NOT that the code is missing. The lump sum is now
 * spread per the KRA three-bucket rule (fixed-term → unexpired term;
 * unspecified-term with a termination-pay clause → forward at the pre-termination
 * rate; no provision → evenly over the 3 years after exit) and each monthly slice
 * is taxed through the ordinary PAYE bands + personal relief — no NSSF/SHIF/AHL,
 * which don't apply to a lump sum. Once a firm confirms the methodology, flipping
 * the status to verified is a one-line change here. See docs/severance.md.
 */
const PAYE_NOTE =
  'PROVISIONAL / UNVERIFIED: severance lump sum spread per the KRA three-bucket ' +
  'rule; each monthly slice taxed at ordinary PAYE bands + personal relief (no ' +
  'NSSF/SHIF/AHL — not applicable to a lump sum). Methodology awaits a tax firm ' +
  'sign-off before a real payout — see docs/severance.md.';

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

    // KRA three-bucket spreading of the lump sum for PAYE. Classified from the
    // contract terms supplied for THIS exit; annual gross approximated as basic
    // × 12 (allowances aren't loaded in this context — consistent with the
    // basic-based severance calc, and adequate while this stays provisional).
    const spread = classifySeveranceTaxTreatment({
      severanceAmount: severance.gross,
      contractTermType: dto.contractTermType as ContractTermType,
      unexpiredTermMonths: dto.unexpiredTermMonths ?? null,
      annualGross: round2(basicSalary * 12),
    });

    breakdown.contractTermType = dto.contractTermType;
    breakdown.paye = await this.provisionalPaye(severance.gross, exitDate, spread);
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
   * Provisional PAYE on the severance lump sum, spread per the KRA bucket. Each
   * equal monthly slice runs through the ordinary PAYE bands + personal relief
   * (the way a normal month is taxed), instead of taxing the whole lump sum in
   * one month. Still PROVISIONAL_UNVERIFIED — this is the methodology, not a tax
   * firm's sign-off. Best-effort: with no statutory rates in force it degrades
   * to an "unavailable" marker rather than blocking the severance entitlement.
   */
  private async provisionalPaye(
    gross: number, asOf: Date, spread: SeveranceTaxSpread,
  ): Promise<Record<string, unknown>> {
    if (gross <= 0) {
      return { status: 'N/A', bucket: spread.bucket, paye: 0, net: 0, note: 'No severance — no tax.' };
    }
    try {
      const rateSet = assembleRateSet((await this.rates.effective(asOf.toISOString().slice(0, 10))).rates);
      const relief = rateSet.paye.personalRelief;
      const payePerPeriodBeforeRelief = computePayeTax(spread.amountPerPeriod, rateSet.paye);
      const payePerPeriod = round2(Math.max(0, payePerPeriodBeforeRelief - relief));
      const paye = round2(payePerPeriod * spread.periods);
      // Full per-period breakdown — the audit trail if the methodology is reviewed.
      const periodBreakdown = Array.from({ length: spread.periods }, (_, i) => ({
        period: i + 1,
        taxable: spread.amountPerPeriod,
        payeBeforeRelief: payePerPeriodBeforeRelief,
        personalRelief: relief,
        paye: payePerPeriod,
      }));
      return {
        status: 'PROVISIONAL_UNVERIFIED',
        method: 'KRA three-bucket spreading; each monthly slice taxed through ordinary PAYE bands + personal relief',
        bucket: spread.bucket,
        rule: spread.rule,
        periods: spread.periods,
        amountPerPeriod: spread.amountPerPeriod,
        payePerPeriod,
        personalRelief: relief,
        taxableGross: gross,
        paye,
        net: round2(gross - paye),
        periodBreakdown,
        note: PAYE_NOTE,
      };
    } catch {
      return {
        status: 'UNAVAILABLE',
        bucket: spread.bucket,
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
