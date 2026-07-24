import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { wouldCreateCycle } from './department-tree';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';

interface DeptRow {
  id: string; name: string; parentDepartmentId: string | null;
  headEmployeeId: string | null; active: boolean;
  createdAt: Date; updatedAt: Date;
  _count?: { employees: number; subDepartments: number };
}

const withCounts = { _count: { select: { employees: true, subDepartments: true } } };

@Injectable()
export class DepartmentsService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateDepartmentDto) {
    if (dto.parentDepartmentId) await this.assertParentExists(dto.parentDepartmentId);
    if (dto.headEmployeeId) await this.assertEmployeeExists(dto.headEmployeeId);
    const row = (await this.prisma.department.create({
      data: {
        name: dto.name,
        parentDepartmentId: dto.parentDepartmentId ?? null,
        headEmployeeId: dto.headEmployeeId ?? null,
      } as never,
      include: withCounts,
    })) as unknown as DeptRow;
    return this.toResponse(row);
  }

  /**
   * headEmployeeId is a plain column, not a FK (see schema.prisma), so nothing
   * at the database level stops a dangling id — check it here.
   */
  private async assertEmployeeExists(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId } });
    if (!emp) throw new BadRequestException('headEmployeeId does not exist');
  }

  async list(includeInactive = false) {
    const where: Record<string, unknown> = includeInactive ? {} : { active: true };
    const rows = (await this.prisma.department.findMany({
      where: where as never, orderBy: { name: 'asc' }, include: withCounts,
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

    if (dto.headEmployeeId) await this.assertEmployeeExists(dto.headEmployeeId);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.parentDepartmentId !== undefined) data.parentDepartmentId = dto.parentDepartmentId;
    if (dto.headEmployeeId !== undefined) data.headEmployeeId = dto.headEmployeeId;
    if (dto.active !== undefined) data.active = dto.active;

    const row = (await this.prisma.department.update({
      where: { id }, data: data as never, include: withCounts,
    })) as unknown as DeptRow;
    return this.toResponse(row);
  }

  /**
   * Blocked (not cascaded) while ANY employee is still assigned — deactivate
   * instead. Employee.departmentId has onDelete: SetNull at the DB level, so
   * without this check a delete would silently detach every employee in the
   * department rather than refuse; that's the opposite of what "delete a
   * department" should mean for a directory people are actively assigned to.
   */
  async remove(id: string) {
    const row = await this.get(id);
    if (row.employeeCount > 0) {
      throw new ConflictException(
        `${row.employeeCount} employee(s) are still assigned to this department — reassign or deactivate it instead.`,
      );
    }
    try {
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
      headEmployeeId: row.headEmployeeId,
      active: row.active,
      employeeCount: row._count?.employees ?? 0,
      subDepartmentCount: row._count?.subDepartments ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
