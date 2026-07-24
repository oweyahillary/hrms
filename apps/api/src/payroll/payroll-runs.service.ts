import {
  BadRequestException, ConflictException, Inject, Injectable,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { PRISMA, baseClientOf, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { toJsonSnapshot } from '../prisma/tenant-scope';
import { getRequestContext } from '../common/context/request-context';
import { StatutoryRatesService } from './statutory-rates.service';
import { PayslipPdfService } from './payslip-pdf.service';
import { assembleRateSet } from './rate-set';
import { assemblePayslip, grossBasedOneThird } from './payslip-assembly';
import { computePayroll, round2 } from './payroll-engine';
import {
  computeBonusAdditions, computePayrollExtras, oneThirdDeductionBudget,
  type LoanApplication, type AdjustmentApplication,
} from './payroll-extras';
import { deriveStructureAmounts, pickEffectiveStructure, type ComponentInput } from '../salary/salary-math';
import {
  computeHourlyRate, computeOvertimeAmount, multiplierFor, pickEffectiveOvertimePolicy,
  type OvertimeCategory, type OvertimeHourlyRateBasis,
} from '../overtime/overtime-derivation';
import type { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import type { CreateCorrectionDto } from './dto/create-correction.dto';

interface ComponentRow { componentType: string; amount: unknown; isTaxable: boolean; }
interface StructureRow { employeeId: string; basicSalary: unknown; effectiveDate: Date; endDate: Date | null; components: ComponentRow[]; }
interface EmployeeRow { id: string; employeeNumber: string }
interface RunRow {
  id: string; periodMonth: number; periodYear: number; status: string; runType: string; correctsRunId: string | null; runDate: Date;
  payslips?: PayslipRow[]; loanRepayments?: LoanRepaymentRow[]; payrollAdjustments?: AdjustmentRow[];
  overtimeEntries?: OvertimeEntryRow[];
}
interface PayslipRow {
  id: string; employeeId: string; grossPay: unknown; paye: unknown; nssfEmployee: unknown; nssfEmployer: unknown;
  shif: unknown; ahlEmployee: unknown; ahlEmployer: unknown; otherDeductions: unknown; netPay: unknown; oneThirdRulePass: boolean;
  pdfStatus?: string;
}
interface LoanRow { id: string; employeeId: string; balance: unknown; installmentAmount: unknown; status: string; }
interface AdjustmentRow {
  id: string; employeeId: string; type: string; amount: unknown; isTaxable: boolean; reason?: string;
  status?: string; payrollRunId?: string | null; payslipId?: string | null;
}
interface LoanRepaymentRow { id: string; loanId: string; payslipId: string; amount: unknown; deferredAmount?: unknown; balanceAfter: unknown; }
interface OvertimeEntryRow {
  id: string; employeeId: string; date: Date; hours: unknown; category: string;
  status: string; payrollRunId: string | null; amount: unknown;
}
interface OvertimePolicyRow {
  effectiveFrom: Date; normalDayMultiplier: unknown; restDayMultiplier: unknown; holidayMultiplier: unknown;
  hourlyRateBasis: string; normalWeeklyHours: number;
}
interface OvertimeApplication { id: string; amount: number; hours: number; category: string }
type Skip = { employeeId: string; employeeNumber: string; reason: string };

@Injectable()
export class PayrollRunsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly rates: StatutoryRatesService,
    private readonly pdf: PayslipPdfService,
  ) {}

  async create(dto: CreatePayrollRunDto, faultInject?: string) {
    const existing = await this.prisma.payrollRun.findFirst({
      where: { periodMonth: dto.periodMonth, periodYear: dto.periodYear, runType: 'REGULAR' } as never,
    });
    if (existing) {
      throw new ConflictException(
        `A regular payroll run already exists for ${dto.periodYear}-${String(dto.periodMonth).padStart(2, '0')}. Use a correction run to amend it.`,
      );
    }
    const where = dto.employeeIds?.length
      ? { id: { in: dto.employeeIds } }
      : { employmentStatus: { in: ['ACTIVE', 'ON_LEAVE'] } };
    return this.buildRun({
      periodMonth: dto.periodMonth, periodYear: dto.periodYear, runType: 'REGULAR',
      correctsRunId: null, employeeWhere: where, roundNet: dto.roundNetToShilling ?? false, faultInject,
    });
  }

  async createCorrection(correctsRunId: string, dto: CreateCorrectionDto) {
    const orig = (await this.prisma.payrollRun.findFirst({ where: { id: correctsRunId } as never })) as unknown as RunRow | null;
    if (!orig) throw new NotFoundException('Payroll run to correct not found');
    if (orig.status !== 'FINALIZED') throw new ConflictException('Only a finalized run can be corrected.');
    return this.buildRun({
      periodMonth: orig.periodMonth, periodYear: orig.periodYear, runType: 'ADJUSTMENT',
      correctsRunId, employeeWhere: { id: { in: dto.employeeIds } }, roundNet: dto.roundNetToShilling ?? false,
    });
  }

  private async buildRun(opts: {
    periodMonth: number; periodYear: number; runType: 'REGULAR' | 'ADJUSTMENT';
    correctsRunId: string | null; employeeWhere: Record<string, unknown>; roundNet: boolean;
    faultInject?: string;
  }) {
    const ctx = getRequestContext();
    const createdById = ctx.userId;
    const orgId = ctx.organizationId;
    if (!createdById || !orgId) throw new InternalServerErrorException('Missing authenticated user/org in context');

    const asOf = new Date(Date.UTC(opts.periodYear, opts.periodMonth, 0)); // last day of the period month
    const rateSet = assembleRateSet((await this.rates.effective(asOf.toISOString().slice(0, 10))).rates);

    const employees = (await this.prisma.employee.findMany({
      where: opts.employeeWhere as never, select: { id: true, employeeNumber: true },
    } as never)) as unknown as EmployeeRow[];
    if (!employees.length) throw new BadRequestException('No matching employees to run payroll for.');

    const ids = employees.map((e) => e.id);
    const structures = (await this.prisma.salaryStructure.findMany({
      where: { employeeId: { in: ids } } as never, include: { components: true },
    })) as unknown as StructureRow[];
    const byEmp = new Map<string, StructureRow[]>();
    for (const s of structures) {
      const arr = byEmp.get(s.employeeId);
      if (arr) arr.push(s); else byEmp.set(s.employeeId, [s]);
    }

    // Loans/advances, one-off adjustments and overtime only apply to REGULAR
    // runs — a correction targets a specific already-finalized figure and
    // must not re-trigger a loan installment or re-consume a bonus/deduction/
    // overtime entry.
    const loansByEmp = new Map<string, LoanRow[]>();
    const adjustmentsByEmp = new Map<string, AdjustmentRow[]>();
    const overtimeByEmp = new Map<string, OvertimeEntryRow[]>();
    let overtimePolicies: OvertimePolicyRow[] = [];
    if (opts.runType === 'REGULAR') {
      const loans = (await this.prisma.loan.findMany({
        where: { employeeId: { in: ids }, status: 'ACTIVE' } as never,
        orderBy: { disbursedDate: 'asc' },
      })) as unknown as LoanRow[];
      for (const l of loans) {
        const arr = loansByEmp.get(l.employeeId);
        if (arr) arr.push(l); else loansByEmp.set(l.employeeId, [l]);
      }
      const adjustments = (await this.prisma.payrollAdjustment.findMany({
        where: {
          employeeId: { in: ids }, status: 'PENDING',
          targetPeriodMonth: opts.periodMonth, targetPeriodYear: opts.periodYear,
        } as never,
      })) as unknown as AdjustmentRow[];
      for (const a of adjustments) {
        const arr = adjustmentsByEmp.get(a.employeeId);
        if (arr) arr.push(a); else adjustmentsByEmp.set(a.employeeId, [a]);
      }

      // APPROVED, not-yet-consumed (payrollRunId null) entries whose date
      // falls within this period — see docs/overtime.md / OvertimeEntry's
      // schema comment for why consumption is stamped here (draft-build
      // time), not at finalize.
      const periodStart = new Date(Date.UTC(opts.periodYear, opts.periodMonth - 1, 1));
      const overtimeEntries = (await this.prisma.overtimeEntry.findMany({
        where: {
          employeeId: { in: ids }, status: 'APPROVED', payrollRunId: null,
          date: { gte: periodStart, lte: asOf },
        } as never,
      })) as unknown as OvertimeEntryRow[];
      for (const o of overtimeEntries) {
        const arr = overtimeByEmp.get(o.employeeId);
        if (arr) arr.push(o); else overtimeByEmp.set(o.employeeId, [o]);
      }
      if (overtimeEntries.length) {
        overtimePolicies = (await this.prisma.overtimePolicy.findMany({})) as unknown as OvertimePolicyRow[];
      }
    }

    const computed: Array<{
      employeeId: string; slip: ReturnType<typeof assemblePayslip>;
      loanApplications: LoanApplication[]; adjustmentApplications: AdjustmentApplication[];
      overtimeApplications: OvertimeApplication[];
    }> = [];
    const skipped: Skip[] = [];
    for (const emp of employees) {
      const struct = pickEffectiveStructure(byEmp.get(emp.id) ?? [], asOf);
      if (!struct) {
        skipped.push({ employeeId: emp.id, employeeNumber: emp.employeeNumber, reason: 'no effective salary structure for the period' });
        continue;
      }
      const comps: ComponentInput[] = struct.components.map((c) => ({
        componentType: c.componentType as ComponentInput['componentType'], amount: Number(c.amount), isTaxable: c.isTaxable,
      }));
      const basicSalary = Number(struct.basicSalary);
      const d = deriveStructureAmounts(basicSalary, comps);

      const loanInputs = (loansByEmp.get(emp.id) ?? []).map((l) => ({
        id: l.id, balance: Number(l.balance), installmentAmount: Number(l.installmentAmount),
      }));
      const adjustmentInputs = (adjustmentsByEmp.get(emp.id) ?? []).map((a) => ({
        id: a.id, type: a.type as 'BONUS' | 'DEDUCTION', amount: Number(a.amount), isTaxable: a.isTaxable,
      }));

      // Overtime raises gross exactly like a bonus does — cash earnings, so
      // it counts toward PAYE gross, SHIF/AHL base (both derived from gross)
      // and NSSF pensionable pay. Mirrors the bonus treatment below; this
      // codebase draws no statutory distinction between "bonus" and
      // "overtime" cash earnings, and nothing here suggested one should
      // exist, so overtime is folded in the same way. Rate/multiplier are
      // resolved per-entry against the policy effective on that entry's OWN
      // date, not the run's asOf — a policy change mid-period must not
      // retroactively reprice entries dated before it took effect.
      const overtimeApplications: OvertimeApplication[] = (overtimeByEmp.get(emp.id) ?? []).map((o) => {
        const policyRow = pickEffectiveOvertimePolicy(overtimePolicies, o.date);
        const hourlyRate = computeHourlyRate(basicSalary, {
          hourlyRateBasis: (policyRow?.hourlyRateBasis ?? 'MONTHLY_X12_DIV_52_WEEKLY_HOURS') as OvertimeHourlyRateBasis,
          normalWeeklyHours: policyRow?.normalWeeklyHours ?? 45,
        });
        const multiplier = multiplierFor(o.category as OvertimeCategory, {
          normalDayMultiplier: Number(policyRow?.normalDayMultiplier ?? 1.5),
          restDayMultiplier: Number(policyRow?.restDayMultiplier ?? 2),
          holidayMultiplier: Number(policyRow?.holidayMultiplier ?? 2),
          minimumMinutesToCount: 0, maxHoursPerDay: null, // not used by multiplierFor
        });
        const hours = Number(o.hours);
        return { id: o.id, hours, category: o.category, amount: computeOvertimeAmount(hours, hourlyRate, multiplier) };
      });
      const overtimeGross = round2(overtimeApplications.reduce((s, a) => s + a.amount, 0));

      // Bonuses raise gross, so they must be known before statutory (and thus the
      // one-third floor budget) can be computed. Deductions are throttled after.
      const bonus = computeBonusAdditions(adjustmentInputs);
      const gross = round2(d.gross + bonus.bonusGross + overtimeGross);
      const taxableGross = round2(d.taxableGross + bonus.bonusTaxableGross + overtimeGross);
      const pensionable = round2(d.pensionable + bonus.bonusGross + overtimeGross);

      // Net after statutory only (PAYE/NSSF/SHIF/AHL) — the ceiling for voluntary
      // deductions. The salary-structure voluntary deductions (d.otherDeductions)
      // are protected/prior and counted against the floor; loans + one-off
      // deduction adjustments are throttled to fit whatever room is left above
      // one-third of basic. A non-positive budget => nothing throttleable applies.
      const netAfterStatutory = computePayroll(
        { grossPay: gross, taxableGross, pensionablePay: pensionable }, rateSet,
      ).netPay;
      const budget = oneThirdDeductionBudget(netAfterStatutory, d.otherDeductions, basicSalary);

      const extras = computePayrollExtras(loanInputs, adjustmentInputs, budget);

      const slip = assemblePayslip(
        {
          basicSalary,
          gross,
          taxableGross,
          pensionable,
          otherDeductions: round2(d.otherDeductions + extras.extraDeductions),
        },
        rateSet, opts.roundNet,
      );
      computed.push({
        employeeId: emp.id, slip,
        loanApplications: extras.loanApplications, adjustmentApplications: extras.adjustmentApplications,
        overtimeApplications,
      });
    }
    if (!computed.length) {
      throw new BadRequestException({ message: 'No payslips could be computed — targeted employees lack an effective salary structure.', skipped });
    }

    // Atomic write: run + all payslips + audit rows commit together or not at all.
    // We use the UNEXTENDED base client because the tenant/audit extension does not
    // compose with interactive transactions; inside the tx we inject organizationId
    // and write audit explicitly, so a mid-write failure rolls the whole run back
    // (no partial runs, no orphaned audit).
    const base = baseClientOf(this.prisma);
    const ip = ctx.ipAddress ?? null;

    const run = (await base.$transaction(async (tx) => {
      const createdRun = (await tx.payrollRun.create({
        data: {
          organizationId: orgId,
          periodMonth: opts.periodMonth, periodYear: opts.periodYear, status: 'DRAFT',
          runType: opts.runType, correctsRunId: opts.correctsRunId, createdById, runDate: new Date(),
        } as never,
      })) as unknown as RunRow;

      await tx.auditLog.create({
        data: {
          organizationId: orgId, userId: createdById, action: 'create',
          entityType: 'PayrollRun', entityId: createdRun.id,
          beforeState: null, afterState: toJsonSnapshot(createdRun) as never, ipAddress: ip,
        } as never,
      });

      let idx = 0;
      for (const { employeeId, slip, loanApplications, adjustmentApplications, overtimeApplications } of computed) {
        const ps = (await tx.payslip.create({
          data: {
            payrollRunId: createdRun.id, employeeId,
            grossPay: slip.grossPay, paye: slip.paye,
            nssfEmployee: slip.nssfEmployee, nssfEmployer: slip.nssfEmployer,
            shif: slip.shif, ahlEmployee: slip.ahlEmployee, ahlEmployer: slip.ahlEmployer,
            otherDeductions: slip.otherDeductions, netPay: slip.netPay,
            oneThirdRulePass: slip.oneThirdRulePass, pdfPath: null,
          } as never,
        })) as unknown as { id: string };

        await tx.auditLog.create({
          data: {
            organizationId: orgId, userId: createdById, action: 'create',
            entityType: 'Payslip', entityId: ps.id,
            beforeState: null, afterState: toJsonSnapshot(ps) as never, ipAddress: ip,
          } as never,
        });

        // Apply this run's share of each active loan: record the repayment and
        // move the loan's balance — done here (draft-build), not at finalize, so
        // the figures on `ps` above always match what actually gets persisted.
        // remove() below reverses this if the draft is discarded instead of finalized.
        for (const app of loanApplications) {
          const repayment = (await tx.loanRepayment.create({
            data: {
              loanId: app.loanId, payrollRunId: createdRun.id, payslipId: ps.id,
              amount: app.amount, deferredAmount: app.deferredAmount, balanceAfter: app.balanceAfter,
            } as never,
          })) as unknown as { id: string };
          await tx.auditLog.create({
            data: {
              organizationId: orgId, userId: createdById, action: 'create',
              entityType: 'LoanRepayment', entityId: repayment.id,
              beforeState: null, afterState: toJsonSnapshot({ ...repayment, ...app }) as never, ipAddress: ip,
            } as never,
          });
          // Only move the loan when something was actually deducted. A fully
          // withheld installment (amount 0, floor-throttled) leaves the balance
          // untouched so it carries forward to the next run.
          if (app.amount > 0) {
            await tx.loan.update({
              where: { id: app.loanId },
              data: { balance: app.balanceAfter, status: app.completesLoan ? 'COMPLETED' : 'ACTIVE' } as never,
            });
          }
        }

        // One-off adjustments:
        //  - applied (bonuses, and deductions that fit under the floor) -> APPLIED,
        //    linked to this payslip and consumed.
        //  - deferred (a deduction the one-third floor withheld) -> stays PENDING but
        //    linked to this run so the deferral is recorded and surfaced; it is not
        //    consumed, and a later run for the period can still pick it up.
        for (const app of adjustmentApplications) {
          await tx.payrollAdjustment.update({
            where: { id: app.id },
            data: app.deferred
              ? { status: 'PENDING', payrollRunId: createdRun.id, payslipId: null } as never
              : { status: 'APPLIED', payrollRunId: createdRun.id, payslipId: ps.id } as never,
          });
        }

        // Overtime entries consumed by this payslip: stamp payrollRunId so
        // they're never picked up by derive() or another run again. No
        // status change (they stay APPROVED — payrollRunId alone is what
        // "consumed" means here) and no separate audit entry, matching the
        // adjustments precedent just above (only the NEW LoanRepayment row
        // gets one; an UPDATE to an existing row doesn't).
        for (const app of overtimeApplications) {
          await tx.overtimeEntry.update({ where: { id: app.id }, data: { payrollRunId: createdRun.id, amount: app.amount } as never });
        }

        // Test-only fault injection to prove transactional rollback. Never active
        // in production; requires NODE_ENV!=production and an explicit env flag.
        if (
          process.env.NODE_ENV !== 'production' &&
          (opts.faultInject === 'after-first-payslip' || process.env.PAYROLL_FAULT_INJECT === 'after-first-payslip') &&
          idx === 0
        ) {
          throw new Error('Injected fault after first payslip — transactional rollback test');
        }
        idx += 1;
      }
      return createdRun;
    })) as unknown as RunRow;

    return this.findOne(run.id, skipped);
  }

  async list() {
    const runs = (await this.prisma.payrollRun.findMany({
      include: { _count: { select: { payslips: true } } } as never,
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { runDate: 'desc' }],
    })) as unknown as Array<RunRow & { _count: { payslips: number } }>;
    return runs.map((r) => ({
      id: r.id, periodMonth: r.periodMonth, periodYear: r.periodYear, status: r.status,
      runType: r.runType, correctsRunId: r.correctsRunId, runDate: r.runDate, payslipCount: r._count.payslips,
    }));
  }

  async findOne(id: string, skipped?: Skip[]) {
    const run = (await this.prisma.payrollRun.findFirst({
      where: { id } as never,
      include: { payslips: true, loanRepayments: true, payrollAdjustments: true, overtimeEntries: true },
    })) as unknown as RunRow | null;
    if (!run) throw new NotFoundException('Payroll run not found');

    const repaymentsByPayslip = new Map<string, LoanRepaymentRow[]>();
    for (const r of run.loanRepayments ?? []) {
      const arr = repaymentsByPayslip.get(r.payslipId);
      if (arr) arr.push(r); else repaymentsByPayslip.set(r.payslipId, [r]);
    }
    const adjustmentsByPayslip = new Map<string, AdjustmentRow[]>();
    const deferredAdjustments: Array<{ id: string; employeeId: string; amount: number; reason: string | null }> = [];
    for (const a of run.payrollAdjustments ?? []) {
      if (!a.payslipId) {
        // Linked to the run but unconsumed (payslipId null) = a deduction the
        // one-third floor withheld this run. Surface it, don't drop it silently.
        if (a.status === 'PENDING' && a.type === 'DEDUCTION') {
          deferredAdjustments.push({ id: a.id, employeeId: a.employeeId, amount: Number(a.amount), reason: a.reason ?? null });
        }
        continue;
      }
      const arr = adjustmentsByPayslip.get(a.payslipId);
      if (arr) arr.push(a); else adjustmentsByPayslip.set(a.payslipId, [a]);
    }
    // OvertimeEntry has no payslipId FK (only employeeId + payrollRunId — see
    // the schema comment), so consumed entries for this run are matched to a
    // payslip by employeeId; a run has at most one payslip per employee.
    const overtimeByEmployee = new Map<string, OvertimeEntryRow[]>();
    for (const o of run.overtimeEntries ?? []) {
      const arr = overtimeByEmployee.get(o.employeeId);
      if (arr) arr.push(o); else overtimeByEmployee.set(o.employeeId, [o]);
    }

    const payslips = (run.payslips ?? []).map((p) =>
      this.present(p, repaymentsByPayslip.get(p.id), adjustmentsByPayslip.get(p.id), overtimeByEmployee.get(p.employeeId)),
    );
    const totals = payslips.reduce(
      (t, p) => ({
        gross: t.gross + p.grossPay, paye: t.paye + p.paye,
        nssf: t.nssf + p.nssfEmployee, shif: t.shif + p.shif, ahl: t.ahl + p.ahlEmployee,
        net: t.net + p.netPay,
      }),
      { gross: 0, paye: 0, nssf: 0, shif: 0, ahl: 0, net: 0 },
    );
    return {
      id: run.id, periodMonth: run.periodMonth, periodYear: run.periodYear, status: run.status,
      runType: run.runType, correctsRunId: run.correctsRunId, runDate: run.runDate,
      payslipCount: payslips.length,
      oneThirdFailureEmployeeIds: payslips.filter((p) => !p.oneThirdRulePass).map((p) => p.employeeId),
      pdfStatus: {
        ready: payslips.filter((p) => p.pdfStatus === 'READY').length,
        total: payslips.length,
      },
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)])),
      payslips,
      // One-off deductions withheld this run to protect the one-third floor, kept
      // PENDING for the officer to re-target or carry forward.
      deferredDeductions: deferredAdjustments,
      ...(skipped ? { skipped } : {}),
    };
  }

  async finalize(id: string, override: boolean, skipPdf = false) {
    const run = (await this.prisma.payrollRun.findFirst({
      where: { id } as never, include: { payslips: true },
    })) as unknown as RunRow | null;
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'DRAFT') throw new ConflictException('Only draft runs can be finalized.');
    const failing = (run.payslips ?? []).filter((p) => !p.oneThirdRulePass).map((p) => p.employeeId);
    if (failing.length && !override) {
      throw new ConflictException({
        message: `${failing.length} payslip(s) breach the one-third rule (take-home below one-third of basic pay). Re-send with ?override=true to finalize anyway.`,
        failingEmployeeIds: failing,
      });
    }
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'FINALIZED' } as never });
    // Render payslip PDFs eagerly, best-effort. The run is already finalized and
    // committed; a render failure must never fail finalize. Retryable via the
    // POST :id/payslips/pdf endpoint (idempotent). The skip flag is a test-only
    // hook (ignored in production) used to leave a NULL-pdfPath finalized payslip
    // for the immutability proof.
    const honorSkip = skipPdf && process.env.NODE_ENV !== 'production';
    if (!honorSkip) {
      await this.pdf.generateMissingForRun(id).catch(() => undefined);
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    const run = (await this.prisma.payrollRun.findFirst({ where: { id } as never })) as unknown as RunRow | null;
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'DRAFT') {
      throw new ConflictException('Only draft runs can be discarded. Finalized runs are immutable — create a correction run instead.');
    }

    // Discarding a draft must undo the loan/adjustment/overtime side effects
    // buildRun() applied — otherwise a loan installment, bonus or overtime
    // entry that never actually got paid out would be silently and
    // permanently consumed.
    await this.prisma.overtimeEntry.updateMany({
      where: { payrollRunId: id } as never,
      // status stays APPROVED — discarding the run doesn't un-approve the
      // overtime, it just becomes available to a later run again. amount is
      // cleared: it was a snapshot of THIS run's rate/policy resolution, not
      // a fact about the entry itself.
      data: { payrollRunId: null, amount: null } as never,
    });

    const repayments = (await this.prisma.loanRepayment.findMany({
      where: { payrollRunId: id } as never,
    })) as unknown as LoanRepaymentRow[];
    for (const r of repayments) {
      const loan = (await this.prisma.loan.findFirst({ where: { id: r.loanId } as never })) as unknown as LoanRow | null;
      if (!loan) continue;
      const restoredBalance = round2(Number(loan.balance) + Number(r.amount));
      await this.prisma.loan.update({
        where: { id: loan.id },
        data: { balance: restoredBalance, status: loan.status === 'COMPLETED' ? 'ACTIVE' : loan.status } as never,
      });
    }
    await this.prisma.loanRepayment.deleteMany({ where: { payrollRunId: id } as never });

    await this.prisma.payrollAdjustment.updateMany({
      where: { payrollRunId: id } as never,
      data: { status: 'PENDING', payrollRunId: null, payslipId: null } as never,
    });

    await this.prisma.payslip.deleteMany({ where: { payrollRunId: id } as never });
    await this.prisma.payrollRun.delete({ where: { id } });
    return { success: true };
  }

  private present(p: PayslipRow, repayments?: LoanRepaymentRow[], adjustments?: AdjustmentRow[], overtime?: OvertimeEntryRow[]) {
    const grossPay = Number(p.grossPay), netPay = Number(p.netPay);
    return {
      id: p.id, employeeId: p.employeeId, grossPay, paye: Number(p.paye),
      nssfEmployee: Number(p.nssfEmployee), nssfEmployer: Number(p.nssfEmployer),
      shif: Number(p.shif), ahlEmployee: Number(p.ahlEmployee), ahlEmployer: Number(p.ahlEmployer),
      otherDeductions: Number(p.otherDeductions), netPay,
      oneThirdRulePass: p.oneThirdRulePass,
      grossBasedOneThirdPass: grossBasedOneThird(netPay, grossPay),
      pdfStatus: p.pdfStatus ?? 'PENDING',
      loanRepayments: (repayments ?? []).map((r) => {
        const amount = Number(r.amount);
        const deferredAmount = Number(r.deferredAmount ?? 0);
        // scheduledAmount = what the installment schedule wanted this run; the UI
        // shows "X applied of Y — Z carried forward" when deferredAmount > 0.
        return { loanId: r.loanId, amount, deferredAmount, scheduledAmount: round2(amount + deferredAmount) };
      }),
      adjustments: (adjustments ?? []).map((a) => ({ id: a.id, type: a.type, amount: Number(a.amount), reason: a.reason ?? null })),
      // amount is always set here — every row present is one this run itself
      // consumed (see findOne's overtimeByEmployee), so it was frozen at
      // buildRun() time.
      overtime: (overtime ?? []).map((o) => ({
        id: o.id, date: o.date, hours: Number(o.hours), category: o.category, amount: Number(o.amount ?? 0),
      })),
    };
  }
}
