import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import type { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import type { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';

export interface HolidayRow { id: string; date: Date; name: string; }

@Injectable()
export class PublicHolidaysService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreatePublicHolidayDto) {
    return (await this.prisma.publicHoliday.create({
      data: { date: new Date(dto.date), name: dto.name } as never,
    })) as unknown as HolidayRow;
  }

  async list(year?: number) {
    const where: Record<string, unknown> = {};
    if (year !== undefined) {
      where.date = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
    }
    return (await this.prisma.publicHoliday.findMany({ where, orderBy: { date: 'asc' } })) as unknown as HolidayRow[];
  }

  async update(id: string, dto: UpdatePublicHolidayDto) {
    await this.ensureExists(id);
    const data: Record<string, unknown> = {};
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.name !== undefined) data.name = dto.name;
    return (await this.prisma.publicHoliday.update({ where: { id }, data: data as never })) as unknown as HolidayRow;
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.publicHoliday.delete({ where: { id } });
    return { success: true };
  }

  private async ensureExists(id: string): Promise<void> {
    const row = await this.prisma.publicHoliday.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Public holiday not found');
  }
}
