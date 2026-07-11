import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import type { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import type { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';

export interface LeaveTypeRow {
  id: string; name: string; isPaid: boolean; requiresApproval: boolean;
  maxDaysPerYear: number | null; createdAt: Date; updatedAt: Date;
}

@Injectable()
export class LeaveTypesService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateLeaveTypeDto) {
    try {
      return (await this.prisma.leaveType.create({
        data: {
          name: dto.name,
          isPaid: dto.isPaid ?? true,
          requiresApproval: dto.requiresApproval ?? true,
          maxDaysPerYear: dto.maxDaysPerYear ?? null,
        } as never,
      })) as unknown as LeaveTypeRow;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('A leave type with that name already exists');
      }
      throw err;
    }
  }

  async list() {
    return (await this.prisma.leaveType.findMany({ orderBy: { name: 'asc' } })) as unknown as LeaveTypeRow[];
  }

  async get(id: string) {
    const row = (await this.prisma.leaveType.findFirst({ where: { id } })) as unknown as LeaveTypeRow | null;
    if (!row) throw new NotFoundException('Leave type not found');
    return row;
  }

  async update(id: string, dto: UpdateLeaveTypeDto) {
    await this.get(id);
    try {
      return (await this.prisma.leaveType.update({ where: { id }, data: dto as never })) as unknown as LeaveTypeRow;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('A leave type with that name already exists');
      }
      throw err;
    }
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.leaveType.delete({ where: { id } });
    return { success: true };
  }
}
