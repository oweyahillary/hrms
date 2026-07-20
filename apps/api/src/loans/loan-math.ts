/**
 * Pure loan/advance repayment math. No I/O — deterministic, testable in
 * isolation (mirrors salary-math.ts / payroll-engine.ts).
 *
 *   totalPayable     = principal + flat one-time interest (interestRate% of principal)
 *   installmentAmount = totalPayable / numberOfInstallments, computed once at creation
 *   each run deducts   min(installmentAmount, balance) — so the final
 *                       installment absorbs any rounding remainder and the
 *                       balance never goes negative
 */
export interface LoanTerms {
  principal: number;
  interestRate: number;
  numberOfInstallments: number;
}
export interface LoanInstallmentPlan {
  totalPayable: number;
  installmentAmount: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeInstallmentPlan(terms: LoanTerms): LoanInstallmentPlan {
  const interest = round2(terms.principal * (terms.interestRate / 100));
  const totalPayable = round2(terms.principal + interest);
  const installmentAmount = round2(totalPayable / terms.numberOfInstallments);
  return { totalPayable, installmentAmount };
}

/**
 * The installment *scheduled* this run — the contractual amount, capped only at
 * the remaining balance (so the final installment absorbs rounding and the
 * balance never goes negative).
 *
 * This is deliberately NOT where the one-third-rule throttle lives: the amount a
 * run may actually deduct also depends on the employee's other deductions and
 * their protected take-home floor, which this function can't see. The caller
 * (computePayrollExtras in payroll-extras.ts) takes this scheduled figure and
 * caps it against the floor budget, carrying any shortfall forward in the
 * balance. Keeping this pure "what's owed" and the throttle "what we may take"
 * separate keeps both testable in isolation.
 */
export function nextInstallment(balance: number, installmentAmount: number): number {
  return round2(Math.min(Math.max(0, balance), installmentAmount));
}
