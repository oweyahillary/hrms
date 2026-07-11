import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { pickEffective, validateRateParameters, type RateType } from './rate-parameters';
import type { CreateStatutoryRateDto } from './dto/create-statutory-rate.dto';
import type { UpdateStatutoryRateDto } from './dto/update-statutory-rate.dto';

export interface StatutoryRateRow {
  id: string; rateType: string; effectiveDate: Date; parameters: unknown;
}
const ALL_TYPES: RateType[] = ['PAYE_BAND', 'NSSF', 'SHIF', 'AHL'];

@Injectable()
export class StatutoryRatesService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateStatutoryRateDto) {
    this.assertValidParams(dto.rateType, dto.parameters);
    return (await this.prisma.statutoryRate.create({
      data: { rateType: dto.rateType, effectiveDate: new Date(dto.effectiveDate), parameters: dto.parameters } as never,
    })) as unknown as StatutoryRateRow;
  }

  async list(rateType?: string) {
    const where: Record<string, unknown> = {};
    if (rateType) where.rateType = rateType;
    return (await this.prisma.statutoryRate.findMany({
      where, orderBy: [{ rateType: 'asc' }, { effectiveDate: 'desc' }],
    })) as unknown as StatutoryRateRow[];
  }

  /** The full set of rates in force as of a date (default today), one per type. */
  async effective(asOf?: string) {
    const at = asOf ? new Date(asOf) : new Date();
    const all = (await this.prisma.statutoryRate.findMany({})) as unknown as StatutoryRateRow[];
    const rates: Record<string, StatutoryRateRow | null> = {};
    for (const type of ALL_TYPES) {
      rates[type] = pickEffective(all.filter((r) => r.rateType === type), at);
    }
    return { asOf: at.toISOString().slice(0, 10), rates };
  }

  async update(id: string, dto: UpdateStatutoryRateDto) {
    const row = await this.mustBeEditable(id);
    if (dto.parameters !== undefined) this.assertValidParams(row.rateType, dto.parameters);

    const data: Record<string, unknown> = {};
    if (dto.effectiveDate !== undefined) data.effectiveDate = new Date(dto.effectiveDate);
    if (dto.parameters !== undefined) data.parameters = dto.parameters;

    return (await this.prisma.statutoryRate.update({ where: { id }, data: data as never })) as unknown as StatutoryRateRow;
  }

  async remove(id: string) {
    await this.mustBeEditable(id);
    await this.prisma.statutoryRate.delete({ where: { id } });
    return { success: true };
  }

  private assertValidParams(rateType: string, params: unknown): void {
    const errors = validateRateParameters(rateType, params);
    if (errors.length) throw new BadRequestException({ message: 'Invalid rate parameters', errors });
  }

  /** A version may only be changed while it is not yet in effect (future-dated). */
  private async mustBeEditable(id: string): Promise<StatutoryRateRow> {
    const row = (await this.prisma.statutoryRate.findFirst({ where: { id } })) as unknown as StatutoryRateRow | null;
    if (!row) throw new NotFoundException('Statutory rate version not found');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (new Date(row.effectiveDate).getTime() <= today.getTime()) {
      throw new ConflictException(
        'This rate version is already in effect and is immutable. Add a new effective-dated version instead.',
      );
    }
    return row;
  }
}
