import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { pickEffectiveOvertimePolicy, type OvertimeHourlyRateBasis } from './overtime-derivation';
import type { CreateOvertimePolicyDto } from './dto/create-overtime-policy.dto';
import type { UpdateOvertimePolicyDto } from './dto/update-overtime-policy.dto';

export interface OvertimePolicyRow {
  id: string; effectiveFrom: Date;
  normalDayMultiplier: unknown; restDayMultiplier: unknown; holidayMultiplier: unknown;
  hourlyRateBasis: string; normalWeeklyHours: number;
  minimumMinutesToCount: number; maxHoursPerDay: unknown; requiresApproval: boolean;
}

const DEFAULTS = {
  normalDayMultiplier: 1.5, restDayMultiplier: 2, holidayMultiplier: 2,
  hourlyRateBasis: 'MONTHLY_X12_DIV_52_WEEKLY_HOURS' as OvertimeHourlyRateBasis,
  normalWeeklyHours: 45, minimumMinutesToCount: 30, requiresApproval: true,
};

/** Same effective-dated CRUD shape as StatutoryRatesService — see docs there for the rationale (a version is immutable once in force; add a new one instead). */
@Injectable()
export class OvertimePolicyService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateOvertimePolicyDto) {
    const row = (await this.prisma.overtimePolicy.create({
      data: {
        effectiveFrom: new Date(dto.effectiveFrom),
        normalDayMultiplier: dto.normalDayMultiplier ?? DEFAULTS.normalDayMultiplier,
        restDayMultiplier: dto.restDayMultiplier ?? DEFAULTS.restDayMultiplier,
        holidayMultiplier: dto.holidayMultiplier ?? DEFAULTS.holidayMultiplier,
        hourlyRateBasis: dto.hourlyRateBasis ?? DEFAULTS.hourlyRateBasis,
        normalWeeklyHours: dto.normalWeeklyHours ?? DEFAULTS.normalWeeklyHours,
        minimumMinutesToCount: dto.minimumMinutesToCount ?? DEFAULTS.minimumMinutesToCount,
        maxHoursPerDay: dto.maxHoursPerDay ?? null,
        requiresApproval: dto.requiresApproval ?? DEFAULTS.requiresApproval,
      } as never,
    })) as unknown as OvertimePolicyRow;
    return this.present(row);
  }

  async list() {
    const rows = (await this.prisma.overtimePolicy.findMany({
      orderBy: { effectiveFrom: 'desc' },
    })) as unknown as OvertimePolicyRow[];
    return rows.map((r) => this.present(r));
  }

  /** The policy in force as of a date (default: today). Falls back to hardcoded defaults if the org has never configured one — so derive/payroll never hard-fail on a missing policy. */
  async effective(asOf?: string) {
    const at = asOf ? new Date(asOf) : new Date();
    const all = (await this.prisma.overtimePolicy.findMany({})) as unknown as OvertimePolicyRow[];
    const row = pickEffectiveOvertimePolicy(all, at);
    return row ? this.present(row) : { id: null, effectiveFrom: at.toISOString().slice(0, 10), ...DEFAULTS, maxHoursPerDay: null };
  }

  async update(id: string, dto: UpdateOvertimePolicyDto) {
    await this.mustBeEditable(id);
    const data: Record<string, unknown> = {};
    if (dto.effectiveFrom !== undefined) data.effectiveFrom = new Date(dto.effectiveFrom);
    if (dto.normalDayMultiplier !== undefined) data.normalDayMultiplier = dto.normalDayMultiplier;
    if (dto.restDayMultiplier !== undefined) data.restDayMultiplier = dto.restDayMultiplier;
    if (dto.holidayMultiplier !== undefined) data.holidayMultiplier = dto.holidayMultiplier;
    if (dto.hourlyRateBasis !== undefined) data.hourlyRateBasis = dto.hourlyRateBasis;
    if (dto.normalWeeklyHours !== undefined) data.normalWeeklyHours = dto.normalWeeklyHours;
    if (dto.minimumMinutesToCount !== undefined) data.minimumMinutesToCount = dto.minimumMinutesToCount;
    if (dto.maxHoursPerDay !== undefined) data.maxHoursPerDay = dto.maxHoursPerDay;
    if (dto.requiresApproval !== undefined) data.requiresApproval = dto.requiresApproval;

    const row = (await this.prisma.overtimePolicy.update({ where: { id }, data: data as never })) as unknown as OvertimePolicyRow;
    return this.present(row);
  }

  async remove(id: string) {
    await this.mustBeEditable(id);
    await this.prisma.overtimePolicy.delete({ where: { id } });
    return { success: true };
  }

  /** A version may only be changed while it is not yet in effect (future-dated) — mirrors StatutoryRatesService.mustBeEditable exactly. */
  private async mustBeEditable(id: string): Promise<OvertimePolicyRow> {
    const row = (await this.prisma.overtimePolicy.findFirst({ where: { id } as never })) as unknown as OvertimePolicyRow | null;
    if (!row) throw new NotFoundException('Overtime policy version not found');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (new Date(row.effectiveFrom).getTime() <= today.getTime()) {
      throw new ConflictException(
        'This policy version is already in effect and is immutable. Add a new effective-dated version instead.',
      );
    }
    return row;
  }

  private present(r: OvertimePolicyRow) {
    return {
      id: r.id, effectiveFrom: r.effectiveFrom,
      normalDayMultiplier: Number(r.normalDayMultiplier), restDayMultiplier: Number(r.restDayMultiplier),
      holidayMultiplier: Number(r.holidayMultiplier), hourlyRateBasis: r.hourlyRateBasis,
      normalWeeklyHours: r.normalWeeklyHours, minimumMinutesToCount: r.minimumMinutesToCount,
      maxHoursPerDay: r.maxHoursPerDay === null ? null : Number(r.maxHoursPerDay),
      requiresApproval: r.requiresApproval,
    };
  }
}
