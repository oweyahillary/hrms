/**
 * Pure: fold an employee's active loans/advances and pending one-off
 * adjustments into the additions/deductions a payroll run applies on top of
 * their salary structure — respecting the Employment Act one-third rule so a
 * voluntary deduction can never push take-home below one-third of basic pay.
 * No I/O — the caller persists the resulting Loan/Adjustment applications.
 * Mirrors salary-math.ts / payroll-engine.ts.
 *
 * Deduction priority (Employment Act §19 order — highest priority first, i.e.
 * LAST to be throttled):
 *   1. Statutory (PAYE/NSSF/SHIF/AHL) ............ never throttled (computed upstream)
 *   2. Salary-structure voluntary deductions ..... PROTECTED here: counted against
 *        the floor but out of this feature's scope to reduce (they're the
 *        employee's own standing instructions). Passed in via `deductionBudget`.
 *   3. One-off adjustment DEDUCTIONs ............. applied whole, else deferred
 *        (a one-off has no installment schedule to split a remainder onto).
 *   4. Loan / advance installments ............... the shock absorber: applied in
 *        part, the shortfall carried forward in the loan balance (lossless).
 *
 * The budget itself (net after statutory, minus protected deductions, minus the
 * one-third floor) is computed by `oneThirdDeductionBudget` — because it needs
 * the statutory figures, which need gross, which needs the BONUS additions from
 * here. So the flow is: computeBonusAdditions -> gross -> statutory -> budget ->
 * computePayrollExtras(budget).
 */
import { nextInstallment } from '../loans/loan-math';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

export interface LoanForExtras { id: string; balance: number; installmentAmount: number; }
export interface AdjustmentForExtras { id: string; type: 'BONUS' | 'DEDUCTION'; amount: number; isTaxable: boolean; }

export interface LoanApplication {
  loanId: string;
  /** What this run owed on the loan (min of balance and installment). */
  scheduledAmount: number;
  /** What actually applied after the one-third throttle (<= scheduledAmount). */
  amount: number;
  balanceAfter: number;
  completesLoan: boolean;
  /** scheduledAmount - amount: carried forward in the balance to a later run. */
  deferredAmount: number;
  /** True when the floor reduced this installment below what was scheduled. */
  throttled: boolean;
}

export interface AdjustmentApplication {
  id: string;
  type: 'BONUS' | 'DEDUCTION';
  /** BONUS: full amount. DEDUCTION: full when applied, 0 when deferred. */
  amount: number;
  isTaxable: boolean;
  /** DEDUCTION deferred by the floor => false (stays PENDING, not consumed). */
  applied: boolean;
  deferred: boolean;
}

export interface BonusAdditions { bonusGross: number; bonusTaxableGross: number; }

export interface PayrollExtras {
  bonusGross: number;
  bonusTaxableGross: number;
  /** Throttleable deductions actually applied (loan installments + adjustment deductions). */
  extraDeductions: number;
  /** What those deductions would have been with no floor — for transparency. */
  scheduledDeductions: number;
  /** scheduledDeductions - extraDeductions: reduced/deferred to protect the floor. */
  deferredDeductions: number;
  /** True when any loan or adjustment deduction was reduced or deferred by the floor. */
  throttled: boolean;
  loanApplications: LoanApplication[];
  adjustmentApplications: AdjustmentApplication[];
}

/** Sum BONUS adjustments into gross additions (needed before statutory + the floor budget). */
export function computeBonusAdditions(adjustments: readonly AdjustmentForExtras[]): BonusAdditions {
  let bonusGross = 0;
  let bonusTaxableGross = 0;
  for (const a of adjustments) {
    if (a.type !== 'BONUS') continue;
    bonusGross += a.amount;
    if (a.isTaxable) bonusTaxableGross += a.amount;
  }
  return { bonusGross: round2(bonusGross), bonusTaxableGross: round2(bonusTaxableGross) };
}

/**
 * The largest total of throttleable (loan + one-off deduction) deductions that
 * still leaves net pay >= one-third of basic, given the net after statutory and
 * the protected (salary-structure voluntary) deductions taken ahead of these.
 * May be <= 0 — meaning statutory + protected deductions already sit at or below
 * the floor, so no throttleable deduction may be applied this run at all.
 */
export function oneThirdDeductionBudget(
  netAfterStatutory: number,
  protectedDeductions: number,
  basicSalary: number,
): number {
  return round2(netAfterStatutory - protectedDeductions - basicSalary / 3);
}

/**
 * @param loans            active loans, in service priority (oldest disbursed first)
 * @param adjustments      pending one-off adjustments (BONUS + DEDUCTION) for the period
 * @param deductionBudget  cap from oneThirdDeductionBudget(); omit / Infinity = no throttle
 */
export function computePayrollExtras(
  loans: readonly LoanForExtras[],
  adjustments: readonly AdjustmentForExtras[],
  deductionBudget: number = Infinity,
): PayrollExtras {
  const bonus = computeBonusAdditions(adjustments);

  const unlimited = !Number.isFinite(deductionBudget);
  // Budget accounting is done in integer cents so it can never drift a fraction
  // of a shilling above the floor.
  let remaining = unlimited ? Infinity : Math.max(0, toCents(deductionBudget));

  let appliedCents = 0;
  let scheduledCents = 0;

  const adjustmentApplications: AdjustmentApplication[] = [];

  // Bonuses always apply (they add to pay, never breach a floor).
  for (const a of adjustments) {
    if (a.type !== 'BONUS') continue;
    adjustmentApplications.push({
      id: a.id, type: 'BONUS', amount: round2(a.amount), isTaxable: a.isTaxable,
      applied: true, deferred: false,
    });
  }

  // One-off deductions: higher priority than loans, but whole-or-defer (no split).
  for (const a of adjustments) {
    if (a.type !== 'DEDUCTION') continue;
    const cents = toCents(a.amount);
    scheduledCents += cents;
    if (!unlimited && cents > remaining) {
      adjustmentApplications.push({
        id: a.id, type: 'DEDUCTION', amount: 0, isTaxable: a.isTaxable,
        applied: false, deferred: true,
      });
    } else {
      if (!unlimited) remaining -= cents;
      appliedCents += cents;
      adjustmentApplications.push({
        id: a.id, type: 'DEDUCTION', amount: round2(a.amount), isTaxable: a.isTaxable,
        applied: true, deferred: false,
      });
    }
  }

  // Loans: the shock absorber — applied in part, remainder carried in the balance.
  const loanApplications: LoanApplication[] = [];
  for (const loan of loans) {
    const schedCents = toCents(nextInstallment(loan.balance, loan.installmentAmount));
    if (schedCents <= 0) continue; // nothing due (paid off)
    scheduledCents += schedCents;
    const amtCents = unlimited ? schedCents : Math.max(0, Math.min(schedCents, remaining));
    if (!unlimited) remaining -= amtCents;
    appliedCents += amtCents;

    const amount = fromCents(amtCents);
    const balanceAfter = round2(loan.balance - amount);
    loanApplications.push({
      loanId: loan.id,
      scheduledAmount: fromCents(schedCents),
      amount,
      balanceAfter,
      completesLoan: balanceAfter <= 0,
      deferredAmount: fromCents(schedCents - amtCents),
      throttled: amtCents < schedCents,
    });
  }

  return {
    bonusGross: bonus.bonusGross,
    bonusTaxableGross: bonus.bonusTaxableGross,
    extraDeductions: fromCents(appliedCents),
    scheduledDeductions: fromCents(scheduledCents),
    deferredDeductions: fromCents(scheduledCents - appliedCents),
    throttled: appliedCents < scheduledCents,
    loanApplications,
    adjustmentApplications,
  };
}
