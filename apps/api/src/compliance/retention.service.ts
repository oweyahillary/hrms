import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import type { UpsertRetentionPolicyDto } from './dto/retention-policy.dto';

interface PolicyRow {
  id: string; recordType: string; retentionPeriodMonths: number;
  legalBasisNote: string | null; updatedAt: Date;
}

@Injectable()
export class RetentionService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  /** One policy per recordType (unique per org): update if present, else create. */
  async upsert(dto: UpsertRetentionPolicyDto) {
    const existing = (await this.prisma.retentionPolicy.findFirst({
      where: { recordType: dto.recordType } as never,
    })) as unknown as PolicyRow | null;

    if (existing) {
      const updated = (await this.prisma.retentionPolicy.update({
        where: { id: existing.id },
        data: { retentionPeriodMonths: dto.retentionPeriodMonths, legalBasisNote: dto.legalBasisNote ?? null } as never,
      })) as unknown as PolicyRow;
      return this.present(updated);
    }
    const created = (await this.prisma.retentionPolicy.create({
      data: {
        recordType: dto.recordType, retentionPeriodMonths: dto.retentionPeriodMonths,
        legalBasisNote: dto.legalBasisNote ?? null,
      } as never,
    })) as unknown as PolicyRow;
    return this.present(created);
  }

  async list() {
    const rows = (await this.prisma.retentionPolicy.findMany({ orderBy: { recordType: 'asc' } })) as unknown as PolicyRow[];
    return rows.map((r) => this.present(r));
  }

  async get(id: string) { return this.present(await this.mustOwn(id)); }

  async remove(id: string) {
    await this.mustOwn(id);
    await this.prisma.retentionPolicy.delete({ where: { id } });
    return { success: true };
  }

  private present(r: PolicyRow) {
    return {
      id: r.id, recordType: r.recordType, retentionPeriodMonths: r.retentionPeriodMonths,
      legalBasisNote: r.legalBasisNote, updatedAt: r.updatedAt,
    };
  }

  private async mustOwn(id: string): Promise<PolicyRow> {
    const row = (await this.prisma.retentionPolicy.findFirst({ where: { id } as never })) as unknown as PolicyRow | null;
    if (!row) throw new NotFoundException('Retention policy not found');
    return row;
  }
}
