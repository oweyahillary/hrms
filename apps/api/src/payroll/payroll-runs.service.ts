import {
  BadRequestException, ConflictException, Inject, Injectable,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { PRISMA, baseClientOf, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { toJsonSnapshot } from '../prisma/tenant-scope';
import { getRequestContext } from '../common/context/request-context';
import { StatutoryRatesService } from './statutory-rates.service';
import { assembleRateSet } from './rate-set';
import { assemblePayslip, grossBasedOneThird } from './payslip-assembly';
import { deriveStructureAmounts, pickEffectiveStructure, type ComponentInput } from '../salary/salary-math';
import type { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import type { CreateCorrectionDto } from './dto/create-correction.dto';

interface ComponentRow { componentType: string; amount: unknown; isTaxable: boolean; }
interface StructureRow { employeeId: string; basicSalary: unknown; effectiveDate: Date; endDate: Date | null; components: ComponentRow[]; }
interface EmployeeRow { id: string; employeeNumber: string }
interface RunRow { id: string; periodMonth: number; periodYear: number; status: string; runType: string; correctsRunId: string | null; runDate: Date; payslips?: PayslipRow[] }
interface PayslipRow {
  id: string; employeeId: string; grossPay: unknown; paye: unknown; nssfEmployee: unknown; nssfEmployer: unknown;
  shif: unknown; ahlEmployee: unknown; ahlEmployer: unknown; otherDeductions: unknown; netPay: unknown; oneThirdRulePass: boolean;
}
type Skip = { employeeId: string; employeeNumber: string; reason: string };

@Injectable()
export class PayrollRunsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly rates: StatutoryRatesService,
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
      periodMonth: orig.periodMonth, periodYear: orig.periodYear, runType: 'CORRECTION',
      correctsRunId, employeeWhere: { id: { in: dto.employeeIds } }, roundNet: dto.roundNetToShilling ?? false,
    });
  }

  private async buildRun(opts: {
    periodMonth: number; periodYear: number; runType: 'REGULAR' | 'CORRECTION';
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

    const computed: Array<{ employeeId: string; slip: ReturnType<typeof assemblePayslip> }> = [];
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
      const d = deriveStructureAmounts(Number(struct.basicSalary), comps);
      const slip = assemblePayslip(
        { basicSalary: Number(struct.basicSalary), gross: d.gross, taxableGross: d.taxableGross, pensionable: d.pensionable, otherDeductions: d.otherDeductions },
        rateSet, opts.roundNet,
      );
      computed.push({ employeeId: emp.id, slip });
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
      for (const { employeeId, slip } of computed) {
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
      where: { id } as never, include: { payslips: true },
    })) as unknown as RunRow | null;
    if (!run) throw new NotFoundException('Payroll run not found');
    const payslips = (run.payslips ?? []).map((p) => this.present(p));
    const totals = payslips.reduce(
      (t, p) => ({
        gross: t.gross + p.grossPay, paye: t.paye + p.paye,
        nssf: t.nssf + p.nssfEmployee, shif: t.shif + p.shif, ahl: t.ahl + p.ahlEmployee,
        net: t.net + p.netPay,
      }),
      { gross: 0, paye: 0, nssf: 0, shif: 0, ahl: 0, net: 0 },
    );
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    return {
      id: run.id, periodMonth: run.periodMonth, periodYear: run.periodYear, status: run.status,
      runType: run.runType, correctsRunId: run.correctsRunId, runDate: run.runDate,
      payslipCount: payslips.length,
      oneThirdFailureEmployeeIds: payslips.filter((p) => !p.oneThirdRulePass).map((p) => p.employeeId),
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)])),
      payslips,
      ...(skipped ? { skipped } : {}),
    };
  }

  async finalize(id: string, override: boolean) {
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
    return this.findOne(id);
  }

  async remove(id: string) {
    const run = (await this.prisma.payrollRun.findFirst({ where: { id } as never })) as unknown as RunRow | null;
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'DRAFT') {
      throw new ConflictException('Only draft runs can be discarded. Finalized runs are immutable — create a correction run instead.');
    }
    await this.prisma.payslip.deleteMany({ where: { payrollRunId: id } as never });
    await this.prisma.payrollRun.delete({ where: { id } });
    return { success: true };
  }

  private present(p: PayslipRow) {
    const grossPay = Number(p.grossPay), netPay = Number(p.netPay);
    return {
      id: p.id, employeeId: p.employeeId, grossPay, paye: Number(p.paye),
      nssfEmployee: Number(p.nssfEmployee), nssfEmployer: Number(p.nssfEmployer),
      shif: Number(p.shif), ahlEmployee: Number(p.ahlEmployee), ahlEmployer: Number(p.ahlEmployer),
      otherDeductions: Number(p.otherDeductions), netPay,
      oneThirdRulePass: p.oneThirdRulePass,
      grossBasedOneThirdPass: grossBasedOneThird(netPay, grossPay),
    };
  }
}
