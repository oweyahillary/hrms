import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { wouldCreateCycle } from './department-tree';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';

interface DeptRow {
  id: string; name: string; parentDepartmentId: string | null;
  createdAt: Date; updatedAt: Date;
  _count?: { employees: number; subDepartments: number };
}

const withCounts = { _count: { select: { employees: true, subDepartments: true } } };

@Injectable()
export class DepartmentsService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateDepartmentDto) {
    if (dto.parentDepartmentId) await this.assertParentExists(dto.parentDepartmentId);
    const row = (await this.prisma.department.create({
      data: { name: dto.name, parentDepartmentId: dto.parentDepartmentId ?? null } as never,
      include: withCounts,
    })) as unknown as DeptRow;
    return this.toResponse(row);
  }

  async list() {
    const rows = (await this.prisma.department.findMany({
      orderBy: { name: 'asc' }, include: withCounts,
    })) as unknown as DeptRow[];
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: string) {
    const row = (await this.prisma.department.findFirst({
      where: { id }, include: withCounts,
    })) as unknown as DeptRow | null;
    if (!row) throw new NotFoundException('Department not found');
    return this.toResponse(row);
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    await this.ensureExists(id);

    if (dto.parentDepartmentId !== undefined && dto.parentDepartmentId !== null) {
      await this.assertParentExists(dto.parentDepartmentId);
      await this.assertNoCycle(id, dto.parentDepartmentId);
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.parentDepartmentId !== undefined) data.parentDepartmentId = dto.parentDepartmentId;

    const row = (await this.prisma.department.update({
      where: { id }, data: data as never, include: withCounts,
    })) as unknown as DeptRow;
    return this.toResponse(row);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    try {
      // Employees' departmentId is set null (schema onDelete: SetNull).
      await this.prisma.department.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2003') {
        throw new ConflictException('Department has sub-departments; reassign or delete them first');
      }
      throw err;
    }
  }

  private async assertParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.department.findFirst({ where: { id: parentId } });
    if (!parent) throw new BadRequestException('parentDepartmentId does not exist');
  }

  private async assertNoCycle(id: string, newParentId: string): Promise<void> {
    const all = (await this.prisma.department.findMany({
      select: { id: true, parentDepartmentId: true },
    })) as unknown as Array<{ id: string; parentDepartmentId: string | null }>;
    const parentOf = new Map(all.map((d) => [d.id, d.parentDepartmentId]));
    if (wouldCreateCycle(id, newParentId, parentOf)) {
      throw new BadRequestException('That parent would create a circular department hierarchy');
    }
  }

  private async ensureExists(id: string): Promise<void> {
    const row = await this.prisma.department.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Department not found');
  }

  private toResponse(row: DeptRow) {
    return {
      id: row.id,
      name: row.name,
      parentDepartmentId: row.parentDepartmentId,
      employeeCount: row._count?.employees ?? 0,
      subDepartmentCount: row._count?.subDepartments ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
