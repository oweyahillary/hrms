import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { availableDays, countWorkingDays, toISODate } from './leave-math';
import { awaitsApprovalBy, currentPendingStep, isLastStep, type ApprovalStepLike } from './leave-approval';
import type { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import type { QueryLeaveRequestDto } from './dto/query-leave-request.dto';

interface StepRow extends ApprovalStepLike { id: string; actedAt: Date | null; }
interface RequestRow {
  id: string; employeeId: string; leaveTypeId: string;
  startDate: Date; endDate: Date; daysRequested: unknown; status: string;
  reason: string | null; createdAt: Date;
  approvalSteps?: StepRow[];
  leaveType?: { name: string };
}

const num = (v: unknown): number => Number(v ?? 0);
const isPrivileged = (role: string) => HR_MANAGEMENT_ROLES.includes(role);

const requestInclude = {
  approvalSteps: { orderBy: { stepOrder: 'asc' as const } },
  leaveType: { select: { name: true } },
};

@Injectable()
export class LeaveRequestsService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async create(dto: CreateLeaveRequestDto, actor: AuthUser) {
    if (!isPrivileged(actor.role)) {
      const mine = await this.actorEmployeeId(actor.userId);
      if (!mine || mine !== dto.employeeId) {
        throw new ForbiddenException('You can only request leave for yourself');
      }
    }

    const [emp, type] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: dto.employeeId } }),
      this.prisma.leaveType.findFirst({ where: { id: dto.leaveTypeId } }),
    ]);
    if (!emp) throw new BadRequestException('employeeId does not exist');
    if (!type) throw new BadRequestException('leaveTypeId does not exist');

    const approverIds = dto.approverUserIds;
    if (new Set(approverIds).size !== approverIds.length) {
      throw new BadRequestException('approverUserIds contains duplicates');
    }
    const approvers = await this.prisma.user.findMany({ where: { id: { in: approverIds } } });
    if ((approvers as unknown[]).length !== approverIds.length) {
      throw new BadRequestException('One or more approverUserIds do not exist');
    }

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('endDate is before startDate');

    const holidays = await this.holidaySet(start, end);
    const days = countWorkingDays(start, end, holidays);
    if (days <= 0) throw new BadRequestException('No working days in the selected range');

    // Enforce balance only when one is configured for that type/year.
    const year = start.getUTCFullYear();
    const balance = (await this.prisma.leaveBalance.findFirst({
      where: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year },
    })) as unknown as { accruedDays: unknown; carriedOverDays: unknown; usedDays: unknown } | null;
    if (balance) {
      const avail = availableDays(num(balance.accruedDays), num(balance.carriedOverDays), num(balance.usedDays));
      if (days > avail) {
        throw new BadRequestException(`Insufficient balance: ${days} day(s) requested, ${avail} available`);
      }
    }

    const steps = approverIds.map((uid, i) => ({ stepOrder: i, approverUserId: uid }));
    const created = (await this.prisma.leaveRequest.create({
      data: {
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate: start,
        endDate: end,
        daysRequested: days,
        reason: dto.reason ?? null,
        approvalSteps: { create: steps },
      } as never,
      include: requestInclude,
    })) as unknown as RequestRow;

    return this.toResponse(created);
  }

  async list(actor: AuthUser, query: QueryLeaveRequestDto) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;

    if (isPrivileged(actor.role)) {
      if (query.employeeId) where.employeeId = query.employeeId;
    } else {
      where.employeeId = (await this.actorEmployeeId(actor.userId)) ?? '__none__';
    }

    const rows = (await this.prisma.leaveRequest.findMany({
      where, include: requestInclude, orderBy: { createdAt: 'desc' },
    })) as unknown as RequestRow[];
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: string) {
    const row = (await this.prisma.leaveRequest.findFirst({
      where: { id }, include: requestInclude,
    })) as unknown as RequestRow | null;
    if (!row) throw new NotFoundException('Leave request not found');
    return this.toResponse(row);
  }

  /** Requests currently awaiting THIS user's approval. */
  async inbox(actor: AuthUser) {
    const rows = (await this.prisma.leaveRequest.findMany({
      where: { status: 'PENDING' }, include: requestInclude,
    })) as unknown as RequestRow[];
    return rows
      .filter((r) => awaitsApprovalBy(r.approvalSteps ?? [], actor.userId))
      .map((r) => this.toResponse(r));
  }

  approve(id: string, actor: AuthUser) { return this.act(id, actor, 'APPROVED'); }
  reject(id: string, actor: AuthUser) { return this.act(id, actor, 'REJECTED'); }

  async cancel(id: string, actor: AuthUser) {
    const row = await this.loadRaw(id);
    if (row.status !== 'PENDING') throw new BadRequestException('Only pending requests can be cancelled');
    if (!isPrivileged(actor.role)) {
      const mine = await this.actorEmployeeId(actor.userId);
      if (mine !== row.employeeId) throw new ForbiddenException('You can only cancel your own request');
    }
    await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } as never });
    return this.get(id);
  }

  private async act(id: string, actor: AuthUser, action: 'APPROVED' | 'REJECTED') {
    const row = await this.loadRaw(id);
    if (row.status !== 'PENDING') throw new BadRequestException('Request is not pending');

    const steps = row.approvalSteps ?? [];
    const current = currentPendingStep(steps);
    if (!current) throw new BadRequestException('No pending approval step');
    if (current.approverUserId !== actor.userId) {
      throw new ForbiddenException('It is not your turn to approve this request');
    }

    // NOTE: sequential writes (each individually audited). Making the final
    // approval + balance deduction a single transaction is a hardening item.
    await this.prisma.leaveApprovalStep.update({
      where: { id: current.id }, data: { status: action, actedAt: new Date() } as never,
    });

    if (action === 'REJECTED') {
      await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'REJECTED' } as never });
    } else if (isLastStep(steps, current)) {
      await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'APPROVED' } as never });
      await this.deductBalance(row);
    }
    return this.get(id);
  }

  private async deductBalance(row: RequestRow): Promise<void> {
    const year = new Date(row.startDate).getUTCFullYear();
    const balance = (await this.prisma.leaveBalance.findFirst({
      where: { employeeId: row.employeeId, leaveTypeId: row.leaveTypeId, year },
    })) as unknown as { id: string } | null;
    if (balance) {
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { usedDays: { increment: num(row.daysRequested) } } as never,
      });
    }
  }

  private async loadRaw(id: string): Promise<RequestRow> {
    const row = (await this.prisma.leaveRequest.findFirst({
      where: { id }, include: requestInclude,
    })) as unknown as RequestRow | null;
    if (!row) throw new NotFoundException('Leave request not found');
    return row;
  }

  private async actorEmployeeId(userId: string): Promise<string | null> {
    const u = (await this.prisma.user.findFirst({
      where: { id: userId }, select: { employeeId: true },
    })) as unknown as { employeeId: string | null } | null;
    return u?.employeeId ?? null;
  }

  private async holidaySet(start: Date, end: Date): Promise<Set<string>> {
    const rows = (await this.prisma.publicHoliday.findMany({
      where: { date: { gte: start, lte: end } },
    })) as unknown as Array<{ date: Date }>;
    return new Set(rows.map((r) => toISODate(new Date(r.date))));
  }

  private toResponse(r: RequestRow) {
    const steps = (r.approvalSteps ?? []).slice().sort((a, b) => a.stepOrder - b.stepOrder);
    return {
      id: r.id,
      employeeId: r.employeeId,
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: r.leaveType?.name,
      startDate: r.startDate,
      endDate: r.endDate,
      daysRequested: num(r.daysRequested),
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt,
      currentApproverUserId: currentPendingStep(steps)?.approverUserId ?? null,
      approvalSteps: steps.map((s) => ({
        stepOrder: s.stepOrder,
        approverUserId: s.approverUserId,
        status: s.status,
        actedAt: s.actedAt,
      })),
    };
  }
}
