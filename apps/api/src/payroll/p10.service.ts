import { Inject, Injectable } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { StatutoryRatesService } from './statutory-rates.service';
import { assembleRateSet } from './rate-set';
import { computePayroll } from './payroll-engine';
import { deriveStructureAmounts, pickEffectiveStructure, type ComponentInput } from '../salary/salary-math';
import { buildP10SheetBCsv, type P10EmployeeInput } from './p10-sheet-b';

interface SlipRow { paye: unknown; nssfEmployee: unknown; employeeId: string }
interface EmpRow { id: string; firstName: string; lastName: string; kraPin: string | null }
interface CompRow { componentType: string; name: string; amount: unknown; isTaxable: boolean }
interface StructRow { employeeId: string; basicSalary: unknown; effectiveDate: Date; endDate: Date | null; components: CompRow[] }

/** Classify a taxable cash allowance into the P10 housing / transport / other buckets by name. */
function splitTaxableAllowances(components: CompRow[]): { housing: number; transport: number; other: number } {
  let housing = 0, transport = 0, other = 0;
  for (const c of components) {
    if (c.componentType !== 'ALLOWANCE' || !c.isTaxable) continue; // only taxable cash pay belongs in Section B
    const amt = Number(c.amount);
    const name = c.name.toLowerCase();
    if (/hous|rent|accommodat/.test(name)) housing += amt;
    else if (/transport|travel|commut|fuel|mileage/.test(name)) transport += amt;
    else other += amt;
  }
  return { housing, transport, other };
}

@Injectable()
export class P10Service {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly crypto: CryptoService,
    private readonly rates: StatutoryRatesService,
  ) {}

  /**
   * Build the P10 Section B import CSV for a period from FINALIZED payslips.
   * Only taxable cash pay goes into the Section B columns (so cash pay aligns
   * with our taxable basis); pension (NSSF) maps to "Actual Contribution" and
   * our engine's PAYE to "Self Assessed PAYE". The iTax spreadsheet then
   * recomputes its own PAYE beside ours for KRA's cross-check.
   */
  async sheetBForPeriod(year: number, month: number): Promise<{
    csv: string; filename: string; employeeCount: number; missingPin: number;
  }> {
    const runs = (await this.prisma.payrollRun.findMany({
      where: { periodYear: year, periodMonth: month, status: 'FINALIZED' } as never,
      select: { id: true },
    } as never)) as unknown as Array<{ id: string }>;
    const runIds = runs.map((r) => r.id);
    const filename = `P10-Section-B-${year}-${String(month).padStart(2, '0')}.csv`;
    if (runIds.length === 0) return { csv: '', filename, employeeCount: 0, missingPin: 0 };

    const slips = (await this.prisma.payslip.findMany({
      where: { payrollRunId: { in: runIds } } as never,
      select: { paye: true, nssfEmployee: true, employeeId: true },
    } as never)) as unknown as SlipRow[];

    const empIds = [...new Set(slips.map((s) => s.employeeId))];
    const emps = (await this.prisma.employee.findMany({
      where: { id: { in: empIds } } as never,
      select: { id: true, firstName: true, lastName: true, kraPin: true },
    } as never)) as unknown as EmpRow[];
    const empById = new Map(emps.map((e) => [e.id, e]));

    const structs = (await this.prisma.salaryStructure.findMany({
      where: { employeeId: { in: empIds } } as never,
      include: { components: true },
    } as never)) as unknown as StructRow[];
    const structsByEmp = new Map<string, StructRow[]>();
    for (const s of structs) {
      const list = structsByEmp.get(s.employeeId) ?? [];
      list.push(s);
      structsByEmp.set(s.employeeId, list);
    }

    const asOf = new Date(Date.UTC(year, month, 0)); // last day of the period month
    const rateSet = assembleRateSet((await this.rates.effective(asOf.toISOString().slice(0, 10))).rates);

    const inputs: P10EmployeeInput[] = [];
    for (const slip of slips) {
      const emp = empById.get(slip.employeeId);
      const struct = pickEffectiveStructure(structsByEmp.get(slip.employeeId) ?? [], asOf);
      if (!emp || !struct) continue;

      const { housing, transport, other } = splitTaxableAllowances(struct.components);
      const comps: ComponentInput[] = struct.components.map((c) => ({
        componentType: c.componentType as ComponentInput['componentType'],
        amount: Number(c.amount), isTaxable: c.isTaxable,
      }));
      const d = deriveStructureAmounts(Number(struct.basicSalary), comps);
      const b = computePayroll(
        { grossPay: d.gross, taxableGross: d.taxableGross, pensionablePay: d.pensionable }, rateSet,
      );

      const pin = emp.kraPin && this.crypto.isEncrypted(emp.kraPin)
        ? await this.crypto.decrypt(emp.kraPin)
        : emp.kraPin;

      inputs.push({
        kraPin: pin ?? '',
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        basicSalary: Number(struct.basicSalary),
        housingAllowance: housing,
        transportAllowance: transport,
        otherAllowance: other,
        actualContribution: Number(slip.nssfEmployee), // pension (NSSF) — feeds the Section B relief columns
        monthlyPersonalRelief: b.personalRelief,
        selfAssessedPaye: Number(slip.paye),
      });
    }

    return {
      csv: buildP10SheetBCsv(inputs),
      filename,
      employeeCount: inputs.length,
      missingPin: inputs.filter((i) => !i.kraPin).length,
    };
  }
}
