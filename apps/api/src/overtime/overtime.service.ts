import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import {
  deriveOvertime, pickEffectiveOvertimePolicy, type ShiftWindow, type OvertimePolicyLike,
} from './overtime-derivation';
import { OvertimePolicyService, type OvertimePolicyRow } from './overtime-policy.service';
import { effectiveScope, scopeFor } from '../auth/permissions';
import { DepartmentScopeService } from '../auth/department-scope.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import type { CreateOvertimeEntryDto } from './dto/create-overtime-entry.dto';
import type { DeriveOvertimeDto } from './dto/derive-overtime.dto';
import type { QueryOvertimeDto } from './dto/query-overtime.dto';
import type { RejectOvertimeDto } from './dto/reject-overtime.dto';
import type { BulkApproveOvertimeDto } from './dto/bulk-approve-overtime.dto';

const VIEW_KEYS = ['overtime.view', 'overtime.approve', 'overtime.manage'];

interface EntryRow {
  id: string; employeeId: string; date: Date; hours: unknown; category: string;
  source: string; status: string; note: string | null;
  approvedByUserId: string | null; approvedAt: Date | null; payrollRunId: string | null; amount: unknown;
  createdAt: Date; updatedAt: Date;
}
interface AttendanceRow { employeeId: string; date: Date; clockIn: Date | null; clockOut: Date | null }
interface ShiftAssignmentRow { employeeId: string; date: Date; shiftDefinitionId: string }
interface ShiftDefRow { id: string; startTime: string; endTime: string; crossesMidnight: boolean; breakMinutes: number }
interface HolidayRow { date: Date }

const num = (v: unknown): number => Number(v ?? 0);

@Injectable()
export class OvertimeService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly policies: OvertimePolicyService,
    private readonly deptScope: DepartmentScopeService,
  ) {}

  /**
   * Generates/updates PENDING DERIVED entries for [from, to] from existing
   * attendance + shift data. IDEMPOTENT: an existing DERIVED row for
   * (employeeId, date) is updated in place while PENDING; APPROVED/REJECTED
   * or already payroll-run-consumed rows are never touched. If a re-run no
   * longer derives any overtime for a day that previously had a PENDING
   * DERIVED row (e.g. attendance was corrected), that row is removed — kept
   * accurate rather than left stale.
   */
  async derive(dto: DeriveOvertimeDto) {
    const from = new Date(`${dto.from}T00:00:00.000Z`);
    const to = new Date(`${dto.to}T00:00:00.000Z`);
    if (to < from) throw new BadRequestException('to is before from');

    const records = (await this.prisma.attendanceRecord.findMany({
      where: { date: { gte: from, lte: to }, clockIn: { not: null }, clockOut: { not: null } } as never,
    })) as unknown as AttendanceRow[];

    let derived = 0;
    let updated = 0;
    let removed = 0;
    const excessReported: Array<{ employeeId: string; date: string; hours: number; excessHours: number }> = [];

    if (records.length === 0) return { derived, updated, removed, excessReported };

    const employeeIds = [...new Set(records.map((r) => r.employeeId))];
    const dates = [...new Set(records.map((r) => r.date.getTime()))].map((t) => new Date(t));

    const assignments = (await this.prisma.shiftAssignment.findMany({
      where: { employeeId: { in: employeeIds }, date: { in: dates } } as never,
    })) as unknown as ShiftAssignmentRow[];
    const shiftIds = [...new Set(assignments.map((a) => a.shiftDefinitionId))];
    const shiftDefs = shiftIds.length
      ? (await this.prisma.shiftDefinition.findMany({ where: { id: { in: shiftIds } } as never })) as unknown as ShiftDefRow[]
      : [];
    const shiftById = new Map(shiftDefs.map((s) => [s.id, s]));
    const assignmentByKey = new Map(assignments.map((a) => [`${a.employeeId}|${a.date.getTime()}`, a]));

    const holidays = (await this.prisma.publicHoliday.findMany({
      where: { date: { gte: from, lte: to } } as never,
    })) as unknown as HolidayRow[];
    const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

    const allPolicies = (await this.prisma.overtimePolicy.findMany({})) as unknown as OvertimePolicyRow[];

    for (const rec of records) {
      const key = `${rec.employeeId}|${rec.date.getTime()}`;
      const assignment = assignmentByKey.get(key);
      const shiftDef = assignment ? shiftById.get(assignment.shiftDefinitionId) : undefined;
      const shift: ShiftWindow | null = shiftDef
        ? { startTime: shiftDef.startTime, endTime: shiftDef.endTime, crossesMidnight: shiftDef.crossesMidnight, breakMinutes: shiftDef.breakMinutes }
        : null;
      const isHoliday = holidaySet.has(rec.date.toISOString().slice(0, 10));
      const policyRow = pickEffectiveOvertimePolicy(allPolicies, rec.date);
      const policy: OvertimePolicyLike = policyRow
        ? {
            normalDayMultiplier: Number(policyRow.normalDayMultiplier), restDayMultiplier: Number(policyRow.restDayMultiplier),
            holidayMultiplier: Number(policyRow.holidayMultiplier), minimumMinutesToCount: policyRow.minimumMinutesToCount,
            maxHoursPerDay: policyRow.maxHoursPerDay === null ? null : Number(policyRow.maxHoursPerDay),
          }
        : { normalDayMultiplier: 1.5, restDayMultiplier: 2, holidayMultiplier: 2, minimumMinutesToCount: 30, maxHoursPerDay: null };

      const result = deriveOvertime({ clockIn: rec.clockIn, clockOut: rec.clockOut, shift, isHoliday, policy });

      const existing = (await this.prisma.overtimeEntry.findFirst({
        where: { employeeId: rec.employeeId, date: rec.date, source: 'DERIVED' } as never,
      })) as unknown as EntryRow | null;

      // Never touch an entry that's already been decided or consumed.
      if (existing && (existing.status !== 'PENDING' || existing.payrollRunId)) continue;

      if (!result) {
        if (existing) {
          await this.prisma.overtimeEntry.delete({ where: { id: existing.id } });
          removed += 1;
        }
        continue;
      }

      if (result.excessHours > 0) {
        excessReported.push({ employeeId: rec.employeeId, date: rec.date.toISOString().slice(0, 10), hours: result.hours, excessHours: result.excessHours });
      }

      const requiresApproval = policyRow ? policyRow.requiresApproval : true;
      const status = requiresApproval ? 'PENDING' : 'APPROVED';
      const approvedFields = status === 'APPROVED' ? { approvedAt: new Date() } : { approvedAt: null, approvedByUserId: null };

      if (existing) {
        await this.prisma.overtimeEntry.update({
          where: { id: existing.id },
          data: { hours: result.hours, category: result.category, status, ...approvedFields } as never,
        });
        updated += 1;
      } else {
        await this.prisma.overtimeEntry.create({
          data: {
            employeeId: rec.employeeId, date: rec.date, hours: result.hours, category: result.category,
            source: 'DERIVED', status, ...approvedFields,
          } as never,
        });
        derived += 1;
      }
    }

    return { derived, updated, removed, excessReported };
  }

  async createManual(dto: CreateOvertimeEntryDto) {
    const emp = await this.prisma.employee.findFirst({ where: { id: dto.employeeId } as never });
    if (!emp) throw new BadRequestException('employeeId does not exist');

    const policy = await this.policies.effective(dto.date);
    const status = policy.requiresApproval ? 'PENDING' : 'APPROVED';
    const approvedFields = status === 'APPROVED' ? { approvedAt: new Date() } : {};

    const existing = (await this.prisma.overtimeEntry.findFirst({
      where: { employeeId: dto.employeeId, date: new Date(`${dto.date}T00:00:00.000Z`), source: 'MANUAL' } as never,
    })) as unknown as EntryRow | null;
    if (existing) throw new ConflictException('A manual overtime entry already exists for this employee on this date — edit or remove it instead.');

    const row = (await this.prisma.overtimeEntry.create({
      data: {
        employeeId: dto.employeeId, date: new Date(`${dto.date}T00:00:00.000Z`), hours: dto.hours,
        category: dto.category, source: 'MANUAL', status, note: dto.note ?? null, ...approvedFields,
      } as never,
    })) as unknown as EntryRow;
    return this.present(row);
  }

  /** `actor` is omitted for internal calls (self-service's listForEmployee, already employeeId-scoped). */
  async list(query: QueryOvertimeDto, actor?: AuthUser) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;
    else if (query.departmentId) where.employee = { departmentId: query.departmentId };

    if (actor) {
      const scope = effectiveScope(actor.permissions, VIEW_KEYS);
      if (scope === 'OWN_DEPARTMENT') {
        const ownDeptId = await this.deptScope.ownDepartmentId(actor.userId);
        if (!ownDeptId) return [];
        where.employee = { departmentId: ownDeptId }; // ANDs with employeeId above — an out-of-department id matches nothing
      }
    }

    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) range.lte = new Date(`${query.to}T00:00:00.000Z`);
      where.date = range;
    }
    const rows = (await this.prisma.overtimeEntry.findMany({
      where: where as never, orderBy: [{ date: 'desc' }, { employeeId: 'asc' }],
    })) as unknown as EntryRow[];
    return rows.map((r) => this.present(r));
  }

  async get(id: string, actor: AuthUser) {
    const row = await this.mustOwn(id);
    await this.assertInScope(actor.userId, effectiveScope(actor.permissions, VIEW_KEYS), row.employeeId);
    return this.present(row);
  }

  async update(id: string, dto: Partial<CreateOvertimeEntryDto>) {
    const row = await this.mustOwn(id);
    if (row.status !== 'PENDING') throw new ConflictException('Only a pending entry can be edited — approve/reject decisions are final, and a consumed entry is immutable.');
    const data: Record<string, unknown> = {};
    if (dto.hours !== undefined) data.hours = dto.hours;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.note !== undefined) data.note = dto.note;
    const updated = (await this.prisma.overtimeEntry.update({ where: { id }, data: data as never })) as unknown as EntryRow;
    return this.present(updated);
  }

  async remove(id: string) {
    const row = await this.mustOwn(id);
    if (row.status !== 'PENDING') throw new ConflictException('Only a pending entry can be removed.');
    await this.prisma.overtimeEntry.delete({ where: { id } });
    return { success: true };
  }

  async approve(id: string, actor: AuthUser) {
    const row = await this.mustOwn(id);
    if (row.status !== 'PENDING') throw new ConflictException('Only a pending entry can be approved.');
    await this.assertInScope(actor.userId, scopeFor(actor.permissions, 'overtime.approve'), row.employeeId);
    const updated = (await this.prisma.overtimeEntry.update({
      where: { id }, data: { status: 'APPROVED', approvedByUserId: actor.userId, approvedAt: new Date() } as never,
    })) as unknown as EntryRow;
    return this.present(updated);
  }

  async reject(id: string, dto: RejectOvertimeDto, actor: AuthUser) {
    const row = await this.mustOwn(id);
    if (row.status !== 'PENDING') throw new ConflictException('Only a pending entry can be rejected.');
    await this.assertInScope(actor.userId, scopeFor(actor.permissions, 'overtime.approve'), row.employeeId);
    const updated = (await this.prisma.overtimeEntry.update({
      where: { id }, data: { status: 'REJECTED', note: dto.note, approvedByUserId: actor.userId, approvedAt: new Date() } as never,
    })) as unknown as EntryRow;
    return this.present(updated);
  }

  async bulkApprove(dto: BulkApproveOvertimeDto, actor: AuthUser) {
    const where: Record<string, unknown> = {
      status: 'PENDING',
      date: { gte: new Date(`${dto.from}T00:00:00.000Z`), lte: new Date(`${dto.to}T00:00:00.000Z`) },
    };
    if (dto.departmentId) where.employee = { departmentId: dto.departmentId };

    const scope = scopeFor(actor.permissions, 'overtime.approve');
    if (scope === 'OWN_DEPARTMENT') {
      const ownDeptId = await this.deptScope.ownDepartmentId(actor.userId);
      if (!ownDeptId) return { approved: 0 }; // fail closed
      if (dto.departmentId && dto.departmentId !== ownDeptId) return { approved: 0 };
      where.employee = { departmentId: ownDeptId };
    }

    const pending = (await this.prisma.overtimeEntry.findMany({ where: where as never, select: { id: true } })) as unknown as Array<{ id: string }>;
    for (const p of pending) {
      await this.prisma.overtimeEntry.update({
        where: { id: p.id }, data: { status: 'APPROVED', approvedByUserId: actor.userId, approvedAt: new Date() } as never,
      });
    }
    return { approved: pending.length };
  }

  async listForEmployee(employeeId: string, from?: string, to?: string) {
    return this.list({ employeeId, from, to });
  }

  private async mustOwn(id: string): Promise<EntryRow> {
    const row = (await this.prisma.overtimeEntry.findFirst({ where: { id } as never })) as unknown as EntryRow | null;
    if (!row) throw new NotFoundException('Overtime entry not found');
    return row;
  }

  /**
   * For an OWN_DEPARTMENT `scope`, verify `employeeId` is in `actorUserId`'s
   * own department — fail CLOSED (404, same as "doesn't exist") if the actor
   * has no resolvable department. ALL scope (or null) is a no-op.
   */
  private async assertInScope(actorUserId: string, scope: 'ALL' | 'OWN_DEPARTMENT' | null, employeeId: string): Promise<void> {
    if (scope !== 'OWN_DEPARTMENT') return;
    const [ownDeptId, emp] = await Promise.all([
      this.deptScope.ownDepartmentId(actorUserId),
      this.prisma.employee.findFirst({ where: { id: employeeId } as never, select: { departmentId: true } }) as unknown as Promise<{ departmentId: string | null } | null>,
    ]);
    if (!ownDeptId || !emp || emp.departmentId !== ownDeptId) throw new NotFoundException('Overtime entry not found');
  }


  private present(r: EntryRow) {
    return {
      id: r.id, employeeId: r.employeeId, date: r.date, hours: num(r.hours), category: r.category,
      source: r.source, status: r.status, note: r.note,
      approvedByUserId: r.approvedByUserId, approvedAt: r.approvedAt, payrollRunId: r.payrollRunId,
      /** null until a payroll run actually consumes this entry — see the schema comment on OvertimeEntry.amount. */
      amount: r.amount === null ? null : num(r.amount),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }
}
