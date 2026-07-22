import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { deriveStructureAmounts, pickEffectiveStructure, type ComponentInput } from './salary-math';
import type { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import type { UpdateSalaryStructureDto } from './dto/update-salary-structure.dto';
import type { SalaryComponentDto } from './dto/salary-component.dto';

interface ComponentRow { componentType: string; name: string; amount: unknown; isTaxable: boolean; }
interface StructureRow {
  id: string; employeeId: string; basicSalary: unknown;
  effectiveDate: Date; endDate: Date | null; reason: string; approvedById: string | null;
  components: ComponentRow[];
}

@Injectable()
export class SalaryStructuresService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(employeeId: string, dto: CreateSalaryStructureDto) {
    await this.assertEmployee(employeeId);
    const effective = new Date(dto.effectiveDate);

    // Auto-close any currently-open earlier structure so timelines don't overlap.
    const open = (await this.prisma.salaryStructure.findFirst({
      where: { employeeId, endDate: null } as never,
    })) as unknown as StructureRow | null;
    if (open && new Date(open.effectiveDate).getTime() < effective.getTime()) {
      await this.prisma.salaryStructure.update({ where: { id: open.id }, data: { endDate: effective } as never });
    }

    const created = (await this.prisma.salaryStructure.create({
      data: {
        employeeId,
        basicSalary: dto.basicSalary,
        effectiveDate: effective,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        reason: dto.reason,
        approvedById: dto.approvedById ?? null,
        components: { create: (dto.components ?? []).map(this.toComponentData) },
      } as never,
      include: { components: true },
    })) as unknown as StructureRow;
    return this.withDerived(created);
  }

  async list(employeeId: string) {
    await this.assertEmployee(employeeId);
    const rows = (await this.prisma.salaryStructure.findMany({
      where: { employeeId } as never,
      include: { components: true },
      orderBy: { effectiveDate: 'desc' },
    })) as unknown as StructureRow[];
    return rows.map((r) => this.withDerived(r));
  }

  async effective(employeeId: string, asOf?: string) {
    await this.assertEmployee(employeeId);
    const at = asOf ? new Date(asOf) : new Date();
    const rows = (await this.prisma.salaryStructure.findMany({
      where: { employeeId } as never, include: { components: true },
    })) as unknown as StructureRow[];
    const picked = pickEffectiveStructure(rows, at);
    return { asOf: at.toISOString().slice(0, 10), structure: picked ? this.withDerived(picked) : null };
  }

  async findOne(id: string) {
    const row = await this.mustOwn(id);
    return this.withDerived(row);
  }

  async update(id: string, dto: UpdateSalaryStructureDto) {
    await this.mustOwn(id);
    const data: Record<string, unknown> = {};
    if (dto.basicSalary !== undefined) data.basicSalary = dto.basicSalary;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.components !== undefined) {
      data.components = { deleteMany: {}, create: dto.components.map(this.toComponentData) };
    }
    const updated = (await this.prisma.salaryStructure.update({
      where: { id }, data: data as never, include: { components: true },
    })) as unknown as StructureRow;
    return this.withDerived(updated);
  }

  async remove(id: string) {
    await this.mustOwn(id);
    await this.prisma.salaryStructure.delete({ where: { id } }); // components cascade
    return { success: true };
  }

  private toComponentData(c: SalaryComponentDto) {
    return { componentType: c.componentType, name: c.name, amount: c.amount, isTaxable: c.isTaxable ?? true };
  }

  private async assertEmployee(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId } as never });
    if (!emp) throw new NotFoundException('Employee not found');
  }

  /** Scoped read-first: findFirst is org-filtered, so a hit proves ownership. */
  private async mustOwn(id: string): Promise<StructureRow> {
    const row = (await this.prisma.salaryStructure.findFirst({
      where: { id } as never, include: { components: true },
    })) as unknown as StructureRow | null;
    if (!row) throw new NotFoundException('Salary structure not found');
    return row;
  }

  private withDerived(s: StructureRow) {
    const components: ComponentInput[] = s.components.map((c) => ({
      componentType: c.componentType as ComponentInput['componentType'],
      amount: Number(c.amount),
      isTaxable: c.isTaxable,
    }));
    const derived = deriveStructureAmounts(Number(s.basicSalary), components);
    return {
      id: s.id, employeeId: s.employeeId,
      basicSalary: Number(s.basicSalary),
      effectiveDate: s.effectiveDate, endDate: s.endDate,
      reason: s.reason, approvedById: s.approvedById,
      components: s.components.map((c) => ({
        componentType: c.componentType, name: c.name, amount: Number(c.amount), isTaxable: c.isTaxable,
      })),
      derived,
    };
  }
}
