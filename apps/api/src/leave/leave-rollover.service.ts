import { Inject, Injectable } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { availableDaysAsOf, carryOverForNextYear } from './leave-math';

interface TypeRow {
  id: string; name: string;
  carryOverMax: number | null; carryOverExpiryMonths: number | null;
}
interface BalRow {
  id: string; employeeId: string; leaveTypeId: string;
  accruedDays: unknown; usedDays: unknown; carriedOverDays: unknown;
}

const num = (v: unknown): number => Number(v ?? 0);

export interface RolloverResult {
  fromYear: number;
  toYear: number;
  leaveTypes: number;
  balancesRead: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedNoCarry: number;
  daysCarried: number;
}

@Injectable()
export class LeaveRolloverService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  /**
   * Roll unused leave from `fromYear` into `fromYear + 1`.
   *
   * For each of the year's balances: work out what's left at 31 December
   * (honouring any carry-over that already lapsed during the year), cap it by
   * the type's `carryOverMax`, and write that as next year's `carriedOverDays`.
   *
   * IDEMPOTENT: carriedOverDays is SET, never incremented, so running twice —
   * or re-running after accrual has already created next year's rows — lands on
   * the same number rather than doubling anyone's leave.
   *
   * NON-DESTRUCTIVE: only `carriedOverDays` on the target year is touched.
   * `accruedDays` and `usedDays` are left exactly as accrual and requests set
   * them.
   *
   * Employees who have EXITED are skipped: they don't need next year's balance,
   * and their untaken leave is settled on termination rather than carried.
   */
  async runRollover(fromYear: number): Promise<RolloverResult> {
    const toYear = fromYear + 1;
    // Value at the last moment of the leave year. Carried days whose expiry
    // fell earlier in fromYear are already excluded by availableDaysAsOf.
    const yearEnd = new Date(Date.UTC(fromYear, 11, 31));

    const types = (await this.prisma.leaveType.findMany({
      select: { id: true, name: true, carryOverMax: true, carryOverExpiryMonths: true },
    } as never)) as unknown as TypeRow[];

    // carryOverMax === 0 means nothing carries; null means unlimited.
    const carrying = types.filter((t) => t.carryOverMax !== 0);
    const byType = new Map(carrying.map((t) => [t.id, t]));

    const result: RolloverResult = {
      fromYear, toYear, leaveTypes: carrying.length,
      balancesRead: 0, created: 0, updated: 0, unchanged: 0,
      skippedNoCarry: 0, daysCarried: 0,
    };
    if (carrying.length === 0) return result;

    const balances = (await this.prisma.leaveBalance.findMany({
      where: {
        year: fromYear,
        leaveTypeId: { in: carrying.map((t) => t.id) },
        employee: { employmentStatus: { not: 'EXITED' } },
      } as never,
      select: {
        id: true, employeeId: true, leaveTypeId: true,
        accruedDays: true, usedDays: true, carriedOverDays: true,
      },
    } as never)) as unknown as BalRow[];
    result.balancesRead = balances.length;
    if (balances.length === 0) return result;

    const existing = (await this.prisma.leaveBalance.findMany({
      where: {
        year: toYear,
        employeeId: { in: balances.map((b) => b.employeeId) },
        leaveTypeId: { in: carrying.map((t) => t.id) },
      } as never,
      select: { id: true, employeeId: true, leaveTypeId: true, carriedOverDays: true },
    } as never)) as unknown as BalRow[];
    const byKey = new Map(existing.map((b) => [`${b.employeeId}:${b.leaveTypeId}`, b]));

    for (const bal of balances) {
      const type = byType.get(bal.leaveTypeId);
      if (!type) continue;

      const remaining = availableDaysAsOf(
        num(bal.accruedDays), num(bal.carriedOverDays), num(bal.usedDays),
        fromYear, type.carryOverExpiryMonths, yearEnd,
      );
      const carried = carryOverForNextYear(remaining, type.carryOverMax);

      const found = byKey.get(`${bal.employeeId}:${bal.leaveTypeId}`);

      if (carried <= 0) {
        // Nothing to carry. Don't create an empty row — but if a previous run
        // wrote a figure that's now wrong, correct it down.
        if (found && num(found.carriedOverDays) !== 0) {
          await this.prisma.leaveBalance.update({
            where: { id: found.id }, data: { carriedOverDays: 0 } as never,
          } as never);
          result.updated += 1;
        } else {
          result.skippedNoCarry += 1;
        }
        continue;
      }

      result.daysCarried += carried;

      if (!found) {
        await this.prisma.leaveBalance.create({
          data: {
            employeeId: bal.employeeId, leaveTypeId: bal.leaveTypeId, year: toYear,
            accruedDays: 0, carriedOverDays: carried,
          } as never,
        } as never);
        result.created += 1;
        continue;
      }

      if (num(found.carriedOverDays) === carried) {
        result.unchanged += 1;
        continue;
      }
      await this.prisma.leaveBalance.update({
        where: { id: found.id }, data: { carriedOverDays: carried } as never,
      } as never);
      result.updated += 1;
    }

    result.daysCarried = Math.round((result.daysCarried + Number.EPSILON) * 100) / 100;
    return result;
  }
}
