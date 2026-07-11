/**
 * Pure salary-structure math: derive the pay bases from a basic salary + its
 * components, and pick the structure in force on a date. No I/O — testable.
 *
 *   gross         = basic + all allowances            (SHIF/AHL base, start of net)
 *   taxableGross  = basic + taxable allowances        (PAYE base before statutory)
 *   pensionable   = gross (default; refined later via an isPensionable flag)
 *   otherDeductions = sum of voluntary deductions
 */
export type ComponentType = 'ALLOWANCE' | 'DEDUCTION_VOLUNTARY';
export interface ComponentInput { componentType: ComponentType; amount: number; isTaxable: boolean; }
export interface StructureAmounts {
  gross: number; taxableGross: number; pensionable: number;
  allowancesTotal: number; otherDeductions: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function deriveStructureAmounts(basicSalary: number, components: readonly ComponentInput[]): StructureAmounts {
  let allowancesTotal = 0, taxableAllowances = 0, otherDeductions = 0;
  for (const c of components) {
    if (c.componentType === 'ALLOWANCE') {
      allowancesTotal += c.amount;
      if (c.isTaxable) taxableAllowances += c.amount;
    } else if (c.componentType === 'DEDUCTION_VOLUNTARY') {
      otherDeductions += c.amount;
    }
  }
  const gross = round2(basicSalary + allowancesTotal);
  return {
    gross,
    taxableGross: round2(basicSalary + taxableAllowances),
    pensionable: gross,
    allowancesTotal: round2(allowancesTotal),
    otherDeductions: round2(otherDeductions),
  };
}

export interface DatedStructure { effectiveDate: Date | string; endDate?: Date | string | null; }

/** Structure in force on asOf = effectiveDate <= asOf <= (endDate or open), latest start wins. */
export function pickEffectiveStructure<T extends DatedStructure>(rows: readonly T[], asOf: Date): T | null {
  const t = asOf.getTime();
  let best: T | null = null, bestStart = -Infinity;
  for (const r of rows) {
    const start = new Date(r.effectiveDate).getTime();
    const end = r.endDate ? new Date(r.endDate).getTime() : Infinity;
    if (start <= t && t <= end && start > bestStart) { best = r; bestStart = start; }
  }
  return best;
}
