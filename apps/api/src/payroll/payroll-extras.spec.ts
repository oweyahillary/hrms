import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBonusAdditions, computePayrollExtras, oneThirdDeductionBudget,
  type AdjustmentForExtras, type LoanForExtras,
} from './payroll-extras.ts';

const loan = (id: string, balance: number, installmentAmount: number): LoanForExtras =>
  ({ id, balance, installmentAmount });
const ded = (id: string, amount: number): AdjustmentForExtras =>
  ({ id, type: 'DEDUCTION', amount, isTaxable: false });
const bonus = (id: string, amount: number, isTaxable = true): AdjustmentForExtras =>
  ({ id, type: 'BONUS', amount, isTaxable });
const closeTo = (actual: number, expected: number, digits = 2): void =>
  assert.ok(Math.abs(actual - expected) < Math.pow(10, -digits) / 2, `${actual} not close to ${expected}`);

describe('oneThirdDeductionBudget', () => {
  test('is net-after-statutory minus protected deductions minus one-third of basic', () => {
    // basic 30000 -> floor 10000; net after statutory 27000; no protected ded.
    closeTo(oneThirdDeductionBudget(27000, 0, 30000), 17000);
  });
  test('subtracts protected (salary-structure voluntary) deductions from the budget', () => {
    closeTo(oneThirdDeductionBudget(27000, 5000, 30000), 12000);
  });
  test('goes negative when statutory + protected already breach the floor', () => {
    assert.ok(oneThirdDeductionBudget(12000, 5000, 30000) < 0);
  });
});

describe('computeBonusAdditions', () => {
  test('sums bonuses into gross, only taxable ones into taxable gross', () => {
    const r = computeBonusAdditions([bonus('b1', 5000, true), bonus('b2', 3000, false)]);
    assert.equal(r.bonusGross, 8000);
    assert.equal(r.bonusTaxableGross, 5000);
  });
});

describe('computePayrollExtras — no budget (back-compat: apply full)', () => {
  test('applies the full loan installment when unthrottled', () => {
    const r = computePayrollExtras([loan('L', 12000, 4000)], []);
    assert.equal(r.extraDeductions, 4000);
    assert.equal(r.throttled, false);
    const a = r.loanApplications[0];
    assert.equal(a.amount, 4000);
    assert.equal(a.balanceAfter, 8000);
    assert.equal(a.deferredAmount, 0);
    assert.equal(a.throttled, false);
  });
  test('final installment is capped at the remaining balance', () => {
    const r = computePayrollExtras([loan('L', 2500, 4000)], []);
    assert.equal(r.loanApplications[0].amount, 2500);
    assert.equal(r.loanApplications[0].completesLoan, true);
  });
});

describe('computePayrollExtras — one-third throttle on loans', () => {
  test('reduces a loan installment to the floor budget and carries the shortfall forward', () => {
    const r = computePayrollExtras([loan('L', 20000, 5000)], [], 3000);
    const a = r.loanApplications[0];
    assert.equal(a.amount, 3000);
    assert.equal(a.deferredAmount, 2000);
    assert.equal(a.balanceAfter, 17000);
    assert.equal(a.throttled, true);
    assert.equal(r.deferredDeductions, 2000);
    assert.equal(r.throttled, true);
  });
  test('a zero/negative budget withholds the whole installment (balance untouched)', () => {
    const r = computePayrollExtras([loan('L', 20000, 5000)], [], 0);
    const a = r.loanApplications[0];
    assert.equal(a.amount, 0);
    assert.equal(a.deferredAmount, 5000);
    assert.equal(a.balanceAfter, 20000);
    assert.equal(a.completesLoan, false);
    assert.equal(r.extraDeductions, 0);
  });
  test('never applies more than the budget across several loans (oldest first wins)', () => {
    const r = computePayrollExtras([loan('old', 9000, 3000), loan('new', 9000, 3000)], [], 4000);
    assert.ok(r.extraDeductions <= 4000);
    assert.equal(r.loanApplications[0].amount, 3000);
    assert.equal(r.loanApplications[1].amount, 1000);
  });
});

describe('computePayrollExtras — adjustment deductions are whole-or-defer, ahead of loans', () => {
  test('applies a one-off deduction that fits, before the loan', () => {
    const r = computePayrollExtras([loan('L', 20000, 5000)], [ded('d', 4000)], 10000);
    const adj = r.adjustmentApplications.find((x) => x.id === 'd')!;
    assert.equal(adj.applied, true);
    assert.equal(adj.amount, 4000);
    assert.equal(r.loanApplications[0].amount, 5000);
    assert.equal(r.throttled, false);
  });
  test('defers a one-off deduction that does not fit (kept whole), and loans take the rest', () => {
    const r = computePayrollExtras([loan('L', 20000, 5000)], [ded('d', 4000)], 3000);
    const adj = r.adjustmentApplications.find((x) => x.id === 'd')!;
    assert.equal(adj.applied, false);
    assert.equal(adj.deferred, true);
    assert.equal(adj.amount, 0);
    assert.equal(r.loanApplications[0].amount, 3000);
    assert.equal(r.loanApplications[0].deferredAmount, 2000);
    assert.equal(r.deferredDeductions, 6000);
  });
  test('bonuses always apply and never count against the deduction budget', () => {
    const r = computePayrollExtras([], [bonus('b', 5000), ded('d', 2000)], 1000);
    assert.equal(r.bonusGross, 5000);
    assert.equal(r.adjustmentApplications.find((x) => x.id === 'b')!.applied, true);
    assert.equal(r.adjustmentApplications.find((x) => x.id === 'd')!.deferred, true);
  });
});

describe('computePayrollExtras — the guarantee', () => {
  test('applied throttleable deductions never exceed the budget (cents-exact)', () => {
    const r = computePayrollExtras(
      [loan('a', 100000, 3333.33), loan('b', 100000, 1250.5)],
      [ded('d1', 900.25), ded('d2', 100)],
      5000,
    );
    assert.ok(r.extraDeductions <= 5000 + 1e-9);
  });
});
