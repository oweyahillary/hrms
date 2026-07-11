import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import type { CreateJobTitleDto } from './dto/create-job-title.dto';
import type { UpdateJobTitleDto } from './dto/update-job-title.dto';

interface JobTitleRow {
  id: string; title: string; grade: string | null;
  createdAt: Date; updatedAt: Date; _count?: { employees: number };
}

const withCounts = { _count: { select: { employees: true } } };

@Injectable()
export class JobTitlesService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateJobTitleDto) {
    const row = (await this.prisma.jobTitle.create({
      data: { title: dto.title, grade: dto.grade ?? null } as never,
      include: withCounts,
    })) as unknown as JobTitleRow;
    return this.toResponse(row);
  }

  async list() {
    const rows = (await this.prisma.jobTitle.findMany({
      orderBy: { title: 'asc' }, include: withCounts,
    })) as unknown as JobTitleRow[];
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: string) {
    const row = (await this.prisma.jobTitle.findFirst({
      where: { id }, include: withCounts,
    })) as unknown as JobTitleRow | null;
    if (!row) throw new NotFoundException('Job title not found');
    return this.toResponse(row);
  }

  async update(id: string, dto: UpdateJobTitleDto) {
    await this.ensureExists(id);
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.grade !== undefined) data.grade = dto.grade;
    const row = (await this.prisma.jobTitle.update({
      where: { id }, data: data as never, include: withCounts,
    })) as unknown as JobTitleRow;
    return this.toResponse(row);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    // Employees' jobTitleId is set null (schema onDelete: SetNull).
    await this.prisma.jobTitle.delete({ where: { id } });
    return { success: true };
  }

  private async ensureExists(id: string): Promise<void> {
    const row = await this.prisma.jobTitle.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Job title not found');
  }

  private toResponse(row: JobTitleRow) {
    return {
      id: row.id,
      title: row.title,
      grade: row.grade,
      employeeCount: row._count?.employees ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
