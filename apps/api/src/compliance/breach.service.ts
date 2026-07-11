import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { hoursUntilOdpcDeadline, odpcDeadline, odpcNotificationStatus } from './breach-clock';
import type { CreateBreachDto } from './dto/create-breach.dto';
import type { UpdateBreachDto } from './dto/update-breach.dto';

interface BreachRow {
  id: string; detectedAt: Date; description: string; affectedEmployeeCount: number;
  odpcNotifiedAt: Date | null; employeesNotifiedAt: Date | null; status: string;
}

@Injectable()
export class BreachService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateBreachDto) {
    const row = (await this.prisma.breachIncident.create({
      data: {
        detectedAt: new Date(dto.detectedAt), description: dto.description,
        affectedEmployeeCount: dto.affectedEmployeeCount, status: 'OPEN',
      } as never,
    })) as unknown as BreachRow;
    return this.present(row);
  }

  async list(status?: string) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    const rows = (await this.prisma.breachIncident.findMany({
      where: where as never, orderBy: { detectedAt: 'desc' },
    })) as unknown as BreachRow[];
    return rows.map((r) => this.present(r));
  }

  async get(id: string) { return this.present(await this.mustOwn(id)); }

  async update(id: string, dto: UpdateBreachDto) {
    await this.mustOwn(id);
    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.affectedEmployeeCount !== undefined) data.affectedEmployeeCount = dto.affectedEmployeeCount;
    const updated = (await this.prisma.breachIncident.update({ where: { id }, data: data as never })) as unknown as BreachRow;
    return this.present(updated);
  }

  /** Record ODPC notification (first time wins — preserves the true notified instant). */
  async notifyOdpc(id: string) {
    const row = await this.mustOwn(id);
    if (row.odpcNotifiedAt) return this.present(row);
    const updated = (await this.prisma.breachIncident.update({
      where: { id }, data: { odpcNotifiedAt: new Date() } as never,
    })) as unknown as BreachRow;
    return this.present(updated);
  }

  async notifyEmployees(id: string) {
    const row = await this.mustOwn(id);
    if (row.employeesNotifiedAt) return this.present(row);
    const updated = (await this.prisma.breachIncident.update({
      where: { id }, data: { employeesNotifiedAt: new Date() } as never,
    })) as unknown as BreachRow;
    return this.present(updated);
  }

  private async mustOwn(id: string): Promise<BreachRow> {
    const row = (await this.prisma.breachIncident.findFirst({ where: { id } as never })) as unknown as BreachRow | null;
    if (!row) throw new NotFoundException('Breach incident not found');
    return row;
  }

  private present(r: BreachRow) {
    const now = new Date();
    const detectedAt = new Date(r.detectedAt);
    return {
      id: r.id, detectedAt: r.detectedAt, description: r.description,
      affectedEmployeeCount: r.affectedEmployeeCount,
      odpcNotifiedAt: r.odpcNotifiedAt, employeesNotifiedAt: r.employeesNotifiedAt, status: r.status,
      odpc: {
        deadline: odpcDeadline(detectedAt),
        status: odpcNotificationStatus(detectedAt, r.odpcNotifiedAt, now),
        hoursRemaining: hoursUntilOdpcDeadline(detectedAt, now),
      },
    };
  }
}
