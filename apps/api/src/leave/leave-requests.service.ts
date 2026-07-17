import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  availableDaysAsOf, carryOverLastUsableDate, countWorkingDays, expiredCarryOverDays, toISODate,
} from './leave-math';
import { awaitsApprovalBy, currentPendingStep, isLastStep, type ApprovalStepLike } from './leave-approval';
import {
  describeRule, resolveApprovers, type LeaveApprovalMode, type ResolvedApprovers,
} from './leave-approver-policy';
import type { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import type { QueryLeaveRequestDto } from './dto/query-leave-request.dto';

interface StepRow extends ApprovalStepLike { id: string; actedAt: Date | null; }
interface RequestRow {
  id: string; employeeId: string; leaveTypeId: string;
  startDate: Date; endDate: Date; daysRequested: unknown; status: string;
  reason: string | null; createdAt: Date;
  approvalSteps?: StepRow[];
  leaveType?: { name: string };
  employee?: { firstName: string; lastName: string; employeeNumber: string };
}

const num = (v: unknown): number => Number(v ?? 0);
const isPrivileged = (role: string) => HR_MANAGEMENT_ROLES.includes(role);

const requestInclude = {
  approvalSteps: { orderBy: { stepOrder: 'asc' as const } },
  leaveType: { select: { name: true } },
  // Name, not just id: a request list is unreadable as UUIDs, and the
  // alternative — having every caller fetch the whole staff list to resolve one
  // name — would hand the employee directory to people who shouldn't see it.
  // These columns are plaintext (only nationalId/kraPin/bank are encrypted).
  employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
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

    const policy = await this.approvalPolicy();

    let approverIds: string[];
    if (policy.allowEmployeeChosenApprovers && dto.approverUserIds?.length) {
      // The organisation has explicitly opted into letting applicants choose.
      approverIds = dto.approverUserIds;
      if (new Set(approverIds).size !== approverIds.length) {
        throw new BadRequestException('approverUserIds contains duplicates');
      }
      const approvers = await this.prisma.user.findMany({ where: { id: { in: approverIds } } });
      if ((approvers as unknown[]).length !== approverIds.length) {
        throw new BadRequestException('One or more approverUserIds do not exist');
      }
    } else {
      // Derived from policy. Anything the client sent is ignored on purpose:
      // silently honouring it would let a caller bypass the whole control by
      // posting straight to the API.
      const resolved = await this.resolveFor(dto.employeeId, policy);
      if (resolved.approverUserIds.length === 0) {
        throw new BadRequestException(
          'No approver could be determined for this employee. '
          + 'Set a leave approver in Settings, or give the department a head who has a login.',
        );
      }
      approverIds = resolved.approverUserIds;
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
      // Availability is judged as of the leave START date, not today: carried
      // days that lapse before the leave is taken can't pay for it. Booking in
      // March for April leave must not spend days that expire on 1 April.
      const expiryMonths = (type as { carryOverExpiryMonths?: number | null }).carryOverExpiryMonths ?? null;
      const accrued = num(balance.accruedDays);
      const carried = num(balance.carriedOverDays);
      const used = num(balance.usedDays);
      const avail = availableDaysAsOf(accrued, carried, used, year, expiryMonths, start);

      if (days > avail) {
        // Say WHY when expiry is the reason, or the number looks arbitrary.
        const lapsed = expiredCarryOverDays(carried, used, year, expiryMonths, start);
        const lastUsable = carryOverLastUsableDate(year, expiryMonths);
        const because = lapsed > 0 && lastUsable
          ? ` — ${lapsed} carried day(s) had to be used by ${lastUsable}`
          : '';
        throw new BadRequestException(
          `Insufficient balance: ${days} day(s) requested, ${avail} available${because}`,
        );
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
  /** The organisation's leave approval policy. */
  private async approvalPolicy(): Promise<{
    mode: LeaveApprovalMode; hrApproverUserId: string | null; allowEmployeeChosenApprovers: boolean;
  }> {
    const org = (await this.prisma.organization.findFirst({
      select: {
        leaveApprovalMode: true, leaveHrApproverUserId: true, allowEmployeeChosenApprovers: true,
      },
    } as never)) as unknown as {
      leaveApprovalMode: string;
      leaveHrApproverUserId: string | null;
      allowEmployeeChosenApprovers: boolean;
    } | null;
    return {
      mode: (org?.leaveApprovalMode ?? 'DEPT_HEAD_THEN_HR') as LeaveApprovalMode,
      hrApproverUserId: org?.leaveHrApproverUserId ?? null,
      allowEmployeeChosenApprovers: org?.allowEmployeeChosenApprovers ?? false,
    };
  }

  /**
   * Gather what the policy needs — the applicant's login, their department's
   * head, and that head's login — and resolve the approver chain.
   *
   * A head with no user account can't be an approver (an approval step points at
   * a User), so the policy falls back to HR rather than creating a request that
   * nobody is able to action.
   */
  private async resolveFor(
    employeeId: string,
    policy: { mode: LeaveApprovalMode; hrApproverUserId: string | null },
  ): Promise<ResolvedApprovers> {
    const emp = (await this.prisma.employee.findFirst({
      where: { id: employeeId },
      select: { id: true, departmentId: true, user: { select: { id: true } } },
    } as never)) as unknown as {
      id: string; departmentId: string | null; user?: { id: string } | null;
    } | null;

    let headEmployeeId: string | null = null;
    let headUserId: string | null = null;
    if (emp?.departmentId) {
      const dept = (await this.prisma.department.findFirst({
        where: { id: emp.departmentId }, select: { headEmployeeId: true },
      } as never)) as unknown as { headEmployeeId: string | null } | null;
      headEmployeeId = dept?.headEmployeeId ?? null;
      if (headEmployeeId) {
        const headUser = (await this.prisma.user.findFirst({
          where: { employeeId: headEmployeeId, isActive: true }, select: { id: true },
        } as never)) as unknown as { id: string } | null;
        headUserId = headUser?.id ?? null;
      }
    }

    return resolveApprovers({
      mode: policy.mode,
      applicantEmployeeId: employeeId,
      applicantUserId: emp?.user?.id ?? null,
      departmentHeadEmployeeId: headEmployeeId,
      departmentHeadUserId: headUserId,
      hrApproverUserId: policy.hrApproverUserId,
    });
  }

  /**
   * Preview who will approve a given employee's leave, so the apply screen can
   * state it plainly instead of asking the applicant to choose.
   */
  async approversFor(employeeId: string) {
    const policy = await this.approvalPolicy();
    const resolved = await this.resolveFor(employeeId, policy);

    const users = resolved.approverUserIds.length
      ? ((await this.prisma.user.findMany({
          where: { id: { in: resolved.approverUserIds } },
          include: {
            role: { select: { name: true } },
            employee: { select: { firstName: true, lastName: true } },
          },
        } as never)) as unknown as Array<{
          id: string; email: string;
          role?: { name: string };
          employee?: { firstName: string; lastName: string } | null;
        }>)
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      // Order matters: these approve in sequence.
      approvers: resolved.approverUserIds.map((id, i) => {
        const u = byId.get(id);
        return {
          step: i + 1,
          userId: id,
          name: u ? (u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email) : 'Unknown',
          role: u?.role?.name ?? '',
        };
      }),
      rule: resolved.rule,
      explanation: describeRule(resolved.rule),
      /** True when the applicant may override the chain. */
      employeeMayChoose: policy.allowEmployeeChosenApprovers,
      /** True when nothing can be approved — the apply screen should say so. */
      unresolved: resolved.approverUserIds.length === 0,
    };
  }

  /**
   * People who can be picked as approvers on a leave request.
   *
   * Deliberately NOT a general user directory: it returns only users holding an
   * HR/management role, and only id/name/role — no emails, no login state. Any
   * authenticated user can read it because anyone applying for leave has to
   * choose an approver, and you're about to send that person your request
   * anyway.
   *
   * (There is no manager relationship on Employee, so the approver can't be
   * derived — it has to be chosen. If a reporting line is added later, this is
   * the thing to replace.)
   */
  async approvers() {
    const rows = (await this.prisma.user.findMany({
      where: { isActive: true, role: { name: { in: [...HR_MANAGEMENT_ROLES] } } } as never,
      include: {
        role: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
      },
    } as never)) as unknown as Array<{
      id: string; email: string;
      role?: { name: string };
      employee?: { firstName: string; lastName: string } | null;
    }>;

    return rows
      .map((u) => ({
        id: u.id,
        // Prefer the human's name; fall back to the login when a user isn't
        // linked to an employee record (the seeded admin, for one).
        name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email,
        role: u.role?.name ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

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
      employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : null,
      employeeNumber: r.employee?.employeeNumber ?? null,
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
