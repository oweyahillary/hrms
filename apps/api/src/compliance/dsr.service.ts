import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { computeDueDate, daysUntilDue, isOverdue } from './dsr-sla';
import { isEmployeeAnonymized } from '../employees/anonymization';
import type { CreateDsrDto } from './dto/create-dsr.dto';
import type { TransitionDsrDto } from './dto/transition-dsr.dto';

interface DsrRow {
  id: string; employeeId: string; requestType: string; status: string;
  submittedAt: Date; dueDate: Date; resolvedAt: Date | null; notes: string | null;
}
const TERMINAL = new Set(['COMPLETED', 'REJECTED']);

@Injectable()
export class DsrService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(employeeId: string, dto: CreateDsrDto) {
    await this.assertEmployee(employeeId);
    const submittedAt = new Date();
    const row = (await this.prisma.dataSubjectRequest.create({
      data: {
        employeeId, requestType: dto.requestType, status: 'RECEIVED',
        submittedAt, dueDate: computeDueDate(submittedAt), notes: dto.notes ?? null,
      } as never,
    })) as unknown as DsrRow;
    return this.present(row);
  }

  async list(status?: string) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    const rows = (await this.prisma.dataSubjectRequest.findMany({
      where: where as never, orderBy: { dueDate: 'asc' },
    })) as unknown as DsrRow[];
    return rows.map((r) => this.present(r));
  }

  async get(id: string) { return this.present(await this.mustOwn(id)); }

  async transition(id: string, dto: TransitionDsrDto) {
    const r = await this.mustOwn(id);
    if (TERMINAL.has(r.status)) throw new ConflictException(`Request is already ${r.status.toLowerCase()} and cannot change.`);

    let appendNote: string | undefined;
    if (dto.status === 'COMPLETED' && r.requestType === 'ERASURE') {
      const emp = (await this.prisma.employee.findFirst({ where: { id: r.employeeId } as never })) as unknown as { firstName: string } | null;
      if (!emp || !isEmployeeAnonymized(emp.firstName)) {
        throw new ConflictException(
          'Cannot complete an erasure request until the employee is anonymized. Run POST /employees/:id/anonymize (Admin) first.',
        );
      }
      const payslips = await this.prisma.payslip.count({ where: { employeeId: r.employeeId } as never });
      appendNote = `Erasure fulfilled via anonymization. ${payslips} statutory record(s) retained under legal retention obligations.`;
    }

    const notes = [r.notes, dto.notes, appendNote].filter(Boolean).join(' | ') || null;
    const data: Record<string, unknown> = { status: dto.status, notes };
    if (TERMINAL.has(dto.status)) data.resolvedAt = new Date();

    const updated = (await this.prisma.dataSubjectRequest.update({
      where: { id }, data: data as never,
    })) as unknown as DsrRow;
    return this.present(updated);
  }

  private async assertEmployee(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId } as never });
    if (!emp) throw new NotFoundException('Employee not found');
  }

  private async mustOwn(id: string): Promise<DsrRow> {
    const row = (await this.prisma.dataSubjectRequest.findFirst({ where: { id } as never })) as unknown as DsrRow | null;
    if (!row) throw new NotFoundException('Data subject request not found');
    return row;
  }

  private present(r: DsrRow) {
    const now = new Date();
    return {
      id: r.id, employeeId: r.employeeId, requestType: r.requestType, status: r.status,
      submittedAt: r.submittedAt, dueDate: r.dueDate, resolvedAt: r.resolvedAt, notes: r.notes,
      overdue: isOverdue(new Date(r.dueDate), r.resolvedAt, now),
      daysUntilDue: daysUntilDue(new Date(r.dueDate), now),
    };
  }
}
