import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVANCE_CAP_MONTHS,
  advanceExceedsCap,
  computeInstallmentPlan,
  maxAdvancePrincipal,
  nextInstallment,
} from './loan-math.ts';

describe('computeInstallmentPlan', () => {
  test('no interest: installment is principal / installments', () => {
    const p = computeInstallmentPlan({ principal: 12000, interestRate: 0, numberOfInstallments: 3 });
    assert.equal(p.totalPayable, 12000);
    assert.equal(p.installmentAmount, 4000);
  });
  test('flat interest folds into total payable, then splits', () => {
    // 1000 + 10% = 1100; /3 -> 366.67 (rounding remainder absorbed by the last run)
    const p = computeInstallmentPlan({ principal: 1000, interestRate: 10, numberOfInstallments: 3 });
    assert.equal(p.totalPayable, 1100);
    assert.equal(p.installmentAmount, 366.67);
  });
});

describe('nextInstallment', () => {
  test('is capped at the remaining balance (final installment)', () => {
    assert.equal(nextInstallment(2500, 4000), 2500);
    assert.equal(nextInstallment(9000, 4000), 4000);
    assert.equal(nextInstallment(0, 4000), 0);
  });
});

describe('advance cap (Employment Act §19 — two months\u2019 basic salary)', () => {
  const salary = 60000;
  const cap = maxAdvancePrincipal(salary); // 120000

  test('the cap is two months of basic salary', () => {
    assert.equal(ADVANCE_CAP_MONTHS, 2);
    assert.equal(cap, 120000);
  });

  test('a principal at EXACTLY 2x salary is allowed (not over the cap)', () => {
    assert.equal(advanceExceedsCap(2 * salary, salary), false); // 120000 -> ok
  });

  test('a principal ONE SHILLING over 2x salary is rejected', () => {
    assert.equal(advanceExceedsCap(2 * salary + 1, salary), true); // 120001 -> over
  });

  test('comfortably under passes; far over is rejected', () => {
    assert.equal(advanceExceedsCap(5000, salary), false);
    assert.equal(advanceExceedsCap(500000, salary), true);
  });
});
