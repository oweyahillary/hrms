import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { PayslipPdfService } from '../payroll/payslip-pdf.service';
import { LeaveRequestsService } from '../leave/leave-requests.service';
import { LeaveBalancesService } from '../leave/leave-balances.service';
import { ShiftRosterService } from '../shifts/shift-roster.service';
import { AttendanceService } from '../attendance/attendance.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';

interface EmployeeRow {
  id: string; employeeNumber: string; firstName: string; lastName: string;
  nationalId: string; kraPin: string | null; bankAccountNumber: string | null;
  bankName: string | null; bankCode: string | null; bankBranchCode: string | null;
  phone: string | null; email: string | null; dateOfBirth: Date | null; gender: string | null;
  departmentId: string | null; jobTitleId: string | null;
  employmentType: string; employmentStatus: string; hireDate: Date; exitDate: Date | null;
  nextOfKin: unknown;
}
interface RunRow { id: string; periodMonth: number; periodYear: number; runType: string }
interface PayslipRow {
  id: string; payrollRunId: string; employeeId: string;
  grossPay: unknown; paye: unknown; nssfEmployee: unknown; shif: unknown; ahlEmployee: unknown;
  otherDeductions: unknown; netPay: unknown; oneThirdRulePass: boolean; pdfStatus: string;
}

/**
 * "My own data" endpoints for any authenticated employee — deliberately NOT
 * gated by HR_MANAGEMENT_ROLES. Every method resolves the caller's Employee
 * row from their OWN userId (never a client-supplied employeeId), so a
 * privileged caller hitting these routes sees only their own data too — the
 * self-scoping comes from how the id is resolved, not from a role check.
 */
@Injectable()
export class SelfServiceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly crypto: CryptoService,
    private readonly payslipPdf: PayslipPdfService,
    private readonly leaveRequests: LeaveRequestsService,
    private readonly leaveBalances: LeaveBalancesService,
    private readonly shiftRoster: ShiftRosterService,
    private readonly attendance: AttendanceService,
  ) {}

  async getProfile(userId: string) {
    const employeeId = await this.resolveEmployeeId(userId);
    // findFirst (not findUnique) so the tenant extension scopes by org — see
    // docs/spine.md. Harmless belt-and-suspenders here since employeeId was
    // already resolved from the caller's own (org-scoped) User row.
    const row = (await this.prisma.employee.findFirst({
      where: { id: employeeId },
    })) as unknown as EmployeeRow | null;
    if (!row) throw new NotFoundException('Employee not found');

    // Full decrypt, no masking — this is the one place that's correct, because
    // the subject IS the caller. presentPii()/maskLast4() (employee-pii.ts) are
    // for OTHER people's records; they don't apply to your own.
    const nationalId = await this.crypto.decrypt(row.nationalId);
    const kraPin = row.kraPin ? await this.crypto.decrypt(row.kraPin) : null;
    const bankAccountNumber = row.bankAccountNumber ? await this.crypto.decrypt(row.bankAccountNumber) : null;

    return {
      id: row.id,
      employeeNumber: row.employeeNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      nationalId,
      kraPin,
      bankAccountNumber,
      bankName: row.bankName,
      bankCode: row.bankCode,
      bankBranchCode: row.bankBranchCode,
      phone: row.phone,
      email: row.email,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      departmentId: row.departmentId,
      jobTitleId: row.jobTitleId,
      employmentType: row.employmentType,
      employmentStatus: row.employmentStatus,
      hireDate: row.hireDate,
      exitDate: row.exitDate,
      nextOfKin: row.nextOfKin,
    };
  }

  async listPayslips(userId: string) {
    const employeeId = await this.resolveEmployeeId(userId);

    // Payslip carries no organizationId of its own (reached only via
    // PayrollRun — see docs/spine.md's "deliberately not scoped" list), so the
    // org boundary has to be enforced by resolving FINALIZED run ids first
    // (this findMany IS tenant-scoped — PayrollRun is in TENANT_SCOPED_MODELS)
    // and filtering payslips to those ids. DRAFT/PROCESSING runs are excluded
    // on purpose: an employee shouldn't see payroll that isn't final yet.
    const runs = (await this.prisma.payrollRun.findMany({
      where: { status: 'FINALIZED' } as never,
      select: { id: true, periodMonth: true, periodYear: true, runType: true },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    })) as unknown as RunRow[];
    const runById = new Map(runs.map((r) => [r.id, r]));

    const payslips = (await this.prisma.payslip.findMany({
      where: { employeeId, payrollRunId: { in: runs.map((r) => r.id) } } as never,
    })) as unknown as PayslipRow[];

    return payslips
      .map((p) => {
        const run = runById.get(p.payrollRunId);
        return {
          id: p.id,
          periodMonth: run?.periodMonth ?? null,
          periodYear: run?.periodYear ?? null,
          runType: run?.runType ?? null,
          grossPay: Number(p.grossPay),
          paye: Number(p.paye),
          nssfEmployee: Number(p.nssfEmployee),
          shif: Number(p.shif),
          ahlEmployee: Number(p.ahlEmployee),
          otherDeductions: Number(p.otherDeductions),
          netPay: Number(p.netPay),
          oneThirdRulePass: p.oneThirdRulePass,
          pdfStatus: p.pdfStatus,
        };
      })
      .sort((a, b) => (b.periodYear! - a.periodYear!) || (b.periodMonth! - a.periodMonth!));
  }

  async getPayslipPdf(userId: string, payslipId: string): Promise<{ buffer: Buffer; filename: string }> {
    const employeeId = await this.resolveEmployeeId(userId);

    // Ownership check IS the tenant check here: employeeId was resolved from
    // the caller's own org-scoped User row, so a payslip row that matches it
    // can only belong to an employee in the caller's own org. A mismatch on
    // either id or employeeId is indistinguishable to the caller — both come
    // back as the same 403, never a 404 that would confirm someone else's
    // payslip id exists.
    const payslip = (await this.prisma.payslip.findFirst({
      where: { id: payslipId, employeeId } as never,
      select: { id: true, payrollRunId: true },
    })) as unknown as { id: string; payrollRunId: string } | null;
    if (!payslip) throw new ForbiddenException('This payslip does not belong to you');

    return this.payslipPdf.getPayslipPdf(payslip.payrollRunId, payslip.id);
  }

  async getLeave(userId: string, actor: AuthUser) {
    const employeeId = await this.resolveEmployeeId(userId);

    // Passing OUR OWN resolved employeeId explicitly — not the actor's role —
    // is what keeps this self-scoped even when the actor is HR. LeaveRequestsService
    // .list() only lets a privileged actor's query.employeeId widen the result;
    // a non-privileged actor's query.employeeId is ignored in favour of their own
    // anyway. Either way, passing our own id here can never return anyone else's.
    const [requests, balances] = await Promise.all([
      this.leaveRequests.list(actor, { employeeId }),
      this.leaveBalances.listForEmployee(employeeId),
    ]);
    return { requests, balances };
  }

  async getShifts(userId: string, from: string, to: string) {
    const employeeId = await this.resolveEmployeeId(userId);
    return this.shiftRoster.getEmployeeRoster(employeeId, from, to);
  }

  async getAttendance(userId: string, from?: string, to?: string) {
    const employeeId = await this.resolveEmployeeId(userId);
    return this.attendance.list({ employeeId, from, to });
  }

  /** Resolve the caller's own Employee id from their User row. Never trust a client-supplied id. */
  private async resolveEmployeeId(userId: string): Promise<string> {
    const user = (await this.prisma.user.findFirst({
      where: { id: userId },
      select: { employeeId: true },
    })) as unknown as { employeeId: string | null } | null;
    if (!user?.employeeId) {
      throw new NotFoundException('No employee record is linked to your account.');
    }
    return user.employeeId;
  }
}
