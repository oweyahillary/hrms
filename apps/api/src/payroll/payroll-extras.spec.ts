import {
  computeBonusAdditions, computePayrollExtras, oneThirdDeductionBudget,
  type AdjustmentForExtras, type LoanForExtras,
} from './payroll-extras';

const loan = (id: string, balance: number, installmentAmount: number): LoanForExtras =>
  ({ id, balance, installmentAmount });
const ded = (id: string, amount: number): AdjustmentForExtras =>
  ({ id, type: 'DEDUCTION', amount, isTaxable: false });
const bonus = (id: string, amount: number, isTaxable = true): AdjustmentForExtras =>
  ({ id, type: 'BONUS', amount, isTaxable });

describe('oneThirdDeductionBudget', () => {
  it('is net-after-statutory minus protected deductions minus one-third of basic', () => {
    // basic 30000 -> floor 10000; net after statutory 27000; no protected ded.
    expect(oneThirdDeductionBudget(27000, 0, 30000)).toBeCloseTo(17000, 2);
  });
  it('subtracts protected (salary-structure voluntary) deductions from the budget', () => {
    expect(oneThirdDeductionBudget(27000, 5000, 30000)).toBeCloseTo(12000, 2);
  });
  it('goes negative when statutory + protected already breach the floor', () => {
    expect(oneThirdDeductionBudget(12000, 5000, 30000)).toBeLessThan(0);
  });
});

describe('computeBonusAdditions', () => {
  it('sums bonuses into gross, only taxable ones into taxable gross', () => {
    const r = computeBonusAdditions([bonus('b1', 5000, true), bonus('b2', 3000, false)]);
    expect(r.bonusGross).toBe(8000);
    expect(r.bonusTaxableGross).toBe(5000);
  });
});

describe('computePayrollExtras — no budget (back-compat: apply full)', () => {
  it('applies the full loan installment when unthrottled', () => {
    const r = computePayrollExtras([loan('L', 12000, 4000)], []);
    expect(r.extraDeductions).toBe(4000);
    expect(r.throttled).toBe(false);
    expect(r.loanApplications[0]).toMatchObject({ amount: 4000, balanceAfter: 8000, deferredAmount: 0, throttled: false });
  });
  it('final installment is capped at the remaining balance', () => {
    const r = computePayrollExtras([loan('L', 2500, 4000)], []);
    expect(r.loanApplications[0].amount).toBe(2500);
    expect(r.loanApplications[0].completesLoan).toBe(true);
  });
});

describe('computePayrollExtras — one-third throttle on loans', () => {
  it('reduces a loan installment to the floor budget and carries the shortfall forward', () => {
    // budget 3000, installment 5000 -> apply 3000, defer 2000, balance keeps the rest
    const r = computePayrollExtras([loan('L', 20000, 5000)], [], 3000);
    const a = r.loanApplications[0];
    expect(a.amount).toBe(3000);
    expect(a.deferredAmount).toBe(2000);
    expect(a.balanceAfter).toBe(17000); // 20000 - 3000, remainder still owed
    expect(a.throttled).toBe(true);
    expect(r.deferredDeductions).toBe(2000);
    expect(r.throttled).toBe(true);
  });
  it('a zero/negative budget withholds the whole installment (balance untouched)', () => {
    const r = computePayrollExtras([loan('L', 20000, 5000)], [], 0);
    const a = r.loanApplications[0];
    expect(a.amount).toBe(0);
    expect(a.deferredAmount).toBe(5000);
    expect(a.balanceAfter).toBe(20000);
    expect(a.completesLoan).toBe(false);
    expect(r.extraDeductions).toBe(0);
  });
  it('never applies more than the budget across several loans (oldest first wins)', () => {
    const r = computePayrollExtras([loan('old', 9000, 3000), loan('new', 9000, 3000)], [], 4000);
    expect(r.extraDeductions).toBeLessThanOrEqual(4000);
    expect(r.loanApplications[0].amount).toBe(3000); // oldest fully served
    expect(r.loanApplications[1].amount).toBe(1000); // newer absorbs the shortfall
  });
});

describe('computePayrollExtras — adjustment deductions are whole-or-defer, ahead of loans', () => {
  it('applies a one-off deduction that fits, before the loan', () => {
    // budget 10000: deduction 4000 applies, loan 5000 applies (total 9000 <= 10000)
    const r = computePayrollExtras([loan('L', 20000, 5000)], [ded('d', 4000)], 10000);
    expect(r.adjustmentApplications.find((x) => x.id === 'd')).toMatchObject({ applied: true, amount: 4000 });
    expect(r.loanApplications[0].amount).toBe(5000);
    expect(r.throttled).toBe(false);
  });
  it('defers a one-off deduction that does not fit (kept whole), and loans take the rest', () => {
    // budget 3000: deduction 4000 cannot fit -> deferred; loan then uses the 3000
    const r = computePayrollExtras([loan('L', 20000, 5000)], [ded('d', 4000)], 3000);
    const adj = r.adjustmentApplications.find((x) => x.id === 'd')!;
    expect(adj.applied).toBe(false);
    expect(adj.deferred).toBe(true);
    expect(adj.amount).toBe(0);
    expect(r.loanApplications[0].amount).toBe(3000);
    expect(r.loanApplications[0].deferredAmount).toBe(2000); // loan short by 2000
    // total deferred = the whole 4000 deduction + the loan's throttled 2000
    expect(r.deferredDeductions).toBe(6000);
  });
  it('bonuses always apply and never count against the deduction budget', () => {
    const r = computePayrollExtras([], [bonus('b', 5000), ded('d', 2000)], 1000);
    expect(r.bonusGross).toBe(5000);
    expect(r.adjustmentApplications.find((x) => x.id === 'b')!.applied).toBe(true);
    // deduction 2000 does not fit in 1000 -> deferred
    expect(r.adjustmentApplications.find((x) => x.id === 'd')!.deferred).toBe(true);
  });
});

describe('computePayrollExtras — the guarantee', () => {
  it('applied throttleable deductions never exceed the budget (cents-exact)', () => {
    const r = computePayrollExtras(
      [loan('a', 100000, 3333.33), loan('b', 100000, 1250.5)],
      [ded('d1', 900.25), ded('d2', 100)],
      5000,
    );
    expect(r.extraDeductions).toBeLessThanOrEqual(5000 + 1e-9);
  });
});
