import { Inject, Injectable } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { accruedToDate, type AccrualMethod } from './leave-math';

interface EmpRow { id: string; hireDate: Date }
interface TypeRow { id: string; accrualMethod: string; annualDays: number | null }
interface BalRow { id: string; employeeId: string; leaveTypeId: string; accruedDays: unknown }

const num = (v: unknown): number => Number(v ?? 0);

@Injectable()
export class LeaveAccrualService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  /**
   * Idempotently accrue leave for a period. For every ACTIVE employee hired by
   * the end of `year`-`month` and every auto-accruing leave type, set the year's
   * balance `accruedDays` to `max(current, accruedToDate(...))` — non-destructive
   * (never claws back or clobbers a manual top-up) and safe to run repeatedly.
   * Drive it from an external cron, an in-process scheduler, or by hand.
   */
  async runAccrual(year: number, month: number): Promise<{
    year: number; month: number; employees: number; leaveTypes: number;
    created: number; updated: number; unchanged: number;
  }> {
    const periodEnd = new Date(Date.UTC(year, month, 0)); // last day of the period month

    const types = (await this.prisma.leaveType.findMany({
      where: { accrualMethod: { not: 'NONE' } } as never,
      select: { id: true, accrualMethod: true, annualDays: true },
    } as never)) as unknown as TypeRow[];
    const accruing = types.filter((t) => (t.annualDays ?? 0) > 0);

    const employees = (await this.prisma.employee.findMany({
      where: { employmentStatus: 'ACTIVE', hireDate: { lte: periodEnd } } as never,
      select: { id: true, hireDate: true },
    } as never)) as unknown as EmpRow[];

    let created = 0, updated = 0, unchanged = 0;
    if (accruing.length === 0 || employees.length === 0) {
      return { year, month, employees: employees.length, leaveTypes: accruing.length, created, updated, unchanged };
    }

    const empIds = employees.map((e) => e.id);
    const typeIds = accruing.map((t) => t.id);
    const existing = (await this.prisma.leaveBalance.findMany({
      where: { year, employeeId: { in: empIds }, leaveTypeId: { in: typeIds } } as never,
      select: { id: true, employeeId: true, leaveTypeId: true, accruedDays: true },
    } as never)) as unknown as BalRow[];
    const byKey = new Map(existing.map((b) => [`${b.employeeId}:${b.leaveTypeId}`, b]));

    for (const emp of employees) {
      for (const type of accruing) {
        const target = accruedToDate(
          type.accrualMethod as AccrualMethod, emp.hireDate, type.annualDays ?? 0, year, month,
        );
        const found = byKey.get(`${emp.id}:${type.id}`);

        if (!found) {
          if (target <= 0) { unchanged += 1; continue; } // nothing to grant yet — don't create empty rows
          await this.prisma.leaveBalance.create({
            data: { employeeId: emp.id, leaveTypeId: type.id, year, accruedDays: target } as never,
          } as never);
          created += 1;
          continue;
        }

        const next = Math.max(num(found.accruedDays), target);
        if (next === num(found.accruedDays)) { unchanged += 1; continue; }
        await this.prisma.leaveBalance.update({
          where: { id: found.id }, data: { accruedDays: next } as never,
        } as never);
        updated += 1;
      }
    }

    return { year, month, employees: employees.length, leaveTypes: accruing.length, created, updated, unchanged };
  }
}
