import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import type { CreateShiftDefinitionDto } from './dto/create-shift-definition.dto';
import type { UpdateShiftDefinitionDto } from './dto/update-shift-definition.dto';

export interface ShiftDefinitionRow {
  id: string; code: string; name: string; startTime: string; endTime: string;
  crossesMidnight: boolean; isNightShift: boolean; breakMinutes: number; active: boolean;
}

@Injectable()
export class ShiftDefinitionsService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateShiftDefinitionDto) {
    const code = dto.code.toUpperCase();
    const existing = await this.prisma.shiftDefinition.findFirst({ where: { code } as never });
    if (existing) throw new ConflictException(`A shift with code "${code}" already exists.`);
    const row = (await this.prisma.shiftDefinition.create({
      data: {
        code, name: dto.name, startTime: dto.startTime, endTime: dto.endTime,
        crossesMidnight: dto.crossesMidnight ?? false, isNightShift: dto.isNightShift ?? false,
        breakMinutes: dto.breakMinutes ?? 0,
      } as never,
    })) as unknown as ShiftDefinitionRow;
    return this.present(row);
  }

  async list(includeInactive: boolean) {
    const where: Record<string, unknown> = includeInactive ? {} : { active: true };
    const rows = (await this.prisma.shiftDefinition.findMany({
      where: where as never, orderBy: { code: 'asc' },
    })) as unknown as ShiftDefinitionRow[];
    return rows.map((r) => this.present(r));
  }

  async get(id: string) { return this.present(await this.mustOwn(id)); }

  async update(id: string, dto: UpdateShiftDefinitionDto) {
    await this.mustOwn(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startTime !== undefined) data.startTime = dto.startTime;
    if (dto.endTime !== undefined) data.endTime = dto.endTime;
    if (dto.crossesMidnight !== undefined) data.crossesMidnight = dto.crossesMidnight;
    if (dto.isNightShift !== undefined) data.isNightShift = dto.isNightShift;
    if (dto.breakMinutes !== undefined) data.breakMinutes = dto.breakMinutes;
    if (dto.active !== undefined) data.active = dto.active;
    const updated = (await this.prisma.shiftDefinition.update({
      where: { id }, data: data as never,
    })) as unknown as ShiftDefinitionRow;
    return this.present(updated);
  }

  /** code is immutable once created — CSV/XLSX rosters and the frontend both reference it by value. */
  async remove(id: string) {
    await this.mustOwn(id);
    const inUse = await this.prisma.shiftAssignment.count({ where: { shiftDefinitionId: id } as never });
    if (inUse > 0) {
      throw new ConflictException(
        `${inUse} roster assignment(s) reference this shift — deactivate it (PATCH active:false) instead of deleting.`,
      );
    }
    await this.prisma.shiftDefinition.delete({ where: { id } });
    return { success: true };
  }

  private async mustOwn(id: string): Promise<ShiftDefinitionRow> {
    const row = (await this.prisma.shiftDefinition.findFirst({
      where: { id } as never,
    })) as unknown as ShiftDefinitionRow | null;
    if (!row) throw new NotFoundException('Shift definition not found');
    return row;
  }

  private present(r: ShiftDefinitionRow) {
    return {
      id: r.id, code: r.code, name: r.name, startTime: r.startTime, endTime: r.endTime,
      crossesMidnight: r.crossesMidnight, isNightShift: r.isNightShift,
      breakMinutes: r.breakMinutes, active: r.active,
    };
  }
}
