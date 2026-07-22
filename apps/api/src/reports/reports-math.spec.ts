import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLoanBook, buildSeveranceRegister, severanceRegisterRow, buildAdjustmentsRegister,
  type LoanBookInput, type SeveranceCalcInput, type AdjustmentRegisterInput,
} from './reports-math.ts';

const loan = (o: Partial<LoanBookInput>): LoanBookInput => ({
  id: 'l', employeeId: 'e', type: 'LOAN', status: 'ACTIVE',
  principal: 12000, balance: 12000, installmentAmount: 4000,
  disbursedDate: '2020-01-01', reason: 'x', ...o,
});

describe('buildLoanBook', () => {
  test('derives installments remaining and next due for an active loan', () => {
    const b = buildLoanBook([loan({ balance: 10000, installmentAmount: 4000 })]);
    const r = b.rows[0];
    assert.equal(r.installmentsRemaining, 3); // ceil(10000/4000)
    assert.equal(r.nextDueAmount, 4000);
  });
  test('final partial installment: next due is capped at the balance', () => {
    const b = buildLoanBook([loan({ balance: 2500, installmentAmount: 4000 })]);
    assert.equal(b.rows[0].installmentsRemaining, 1);
    assert.equal(b.rows[0].nextDueAmount, 2500);
  });
  test('completed / cancelled loans have nothing due', () => {
    const b = buildLoanBook([
      loan({ id: 'c', status: 'COMPLETED', balance: 0 }),
      loan({ id: 'x', status: 'CANCELLED', balance: 5000 }), // write-off: balance remains but nothing due
    ]);
    for (const r of b.rows) {
      assert.equal(r.installmentsRemaining, 0);
      assert.equal(r.nextDueAmount, 0);
    }
  });
  test('totalOutstanding counts ACTIVE balances only (the exposure figure)', () => {
    const b = buildLoanBook([
      loan({ id: 'a', status: 'ACTIVE', balance: 8000 }),
      loan({ id: 'b', status: 'ACTIVE', balance: 3000 }),
      loan({ id: 'c', status: 'CANCELLED', balance: 5000 }),
      loan({ id: 'd', status: 'COMPLETED', balance: 0 }),
    ]);
    assert.equal(b.totals.totalOutstanding, 11000); // 8000 + 3000 only
    assert.equal(b.totals.count, 4);
    assert.deepEqual(b.totals.byStatus, { ACTIVE: 2, CANCELLED: 1, COMPLETED: 1 });
  });
});

const calc = (breakdown: unknown, o: Partial<SeveranceCalcInput> = {}): SeveranceCalcInput => ({
  id: 's', employeeId: 'e', exitDate: '2024-06-30', reason: 'REDUNDANCY',
  severanceAmount: 150000, noticePeriodDays: 28, calculationBreakdown: breakdown, ...o,
});

describe('severance register', () => {
  test('extracts completed years, notice pay, PAYE status, and applied bucket from the breakdown', () => {
    const r = severanceRegisterRow(calc({
      severance: { completedYears: 5 },
      notice: { payInLieu: 56000 },
      paye: { status: 'PROVISIONAL_UNVERIFIED', bucket: 'FIXED_TERM' },
    }));
    assert.equal(r.completedYears, 5);
    assert.equal(r.noticePayInLieu, 56000);
    assert.equal(r.payeStatus, 'PROVISIONAL_UNVERIFIED');
    assert.equal(r.provisional, true);
    assert.equal(r.bucket, 'FIXED_TERM');
  });
  test('provisional is FALSE when PAYE is not the unverified provisional status', () => {
    const r = severanceRegisterRow(calc({ paye: { status: 'UNAVAILABLE' } }));
    assert.equal(r.provisional, false);
    assert.equal(r.payeStatus, 'UNAVAILABLE');
  });
  test('degrades gracefully when breakdown fields (incl. bucket) are missing', () => {
    const r = severanceRegisterRow(calc(null));
    assert.equal(r.completedYears, null);
    assert.equal(r.noticePayInLieu, null);
    assert.equal(r.payeStatus, 'UNKNOWN');
    assert.equal(r.provisional, false);
    assert.equal(r.bucket, null);
  });
  test('register totals surface the provisional COUNT so it is not lost in a sum', () => {
    const reg = buildSeveranceRegister([
      calc({ paye: { status: 'PROVISIONAL_UNVERIFIED' }, notice: { payInLieu: 10000 } }, { id: 'a', severanceAmount: 100000 }),
      calc({ paye: { status: 'PROVISIONAL_UNVERIFIED' }, notice: { payInLieu: 20000 } }, { id: 'b', severanceAmount: 50000 }),
      calc({ paye: { status: 'UNAVAILABLE' } }, { id: 'c', severanceAmount: 0, reason: 'RESIGNATION' }),
    ]);
    assert.equal(reg.totals.count, 3);
    assert.equal(reg.totals.totalSeverance, 150000);
    assert.equal(reg.totals.totalNoticePayInLieu, 30000);
    assert.equal(reg.totals.provisionalCount, 2); // the two PROVISIONAL_UNVERIFIED rows
  });
});

const adj = (o: Partial<AdjustmentRegisterInput>): AdjustmentRegisterInput => ({
  id: 'a', employeeId: 'e', type: 'DEDUCTION', amount: 1000, isTaxable: false,
  reason: 'x', targetPeriodMonth: 6, targetPeriodYear: 2026, status: 'PENDING', ...o,
});

describe('buildAdjustmentsRegister', () => {
  test('totals sum bonuses and deductions separately', () => {
    const r = buildAdjustmentsRegister([
      adj({ id: 'a', type: 'BONUS', amount: 5000 }),
      adj({ id: 'b', type: 'BONUS', amount: 2500 }),
      adj({ id: 'c', type: 'DEDUCTION', amount: 3000 }),
    ]);
    assert.equal(r.totals.count, 3);
    assert.equal(r.totals.totalBonuses, 7500);
    assert.equal(r.totals.totalDeductions, 3000);
  });
  test('CANCELLED rows are excluded from the totals but still counted by status', () => {
    const r = buildAdjustmentsRegister([
      adj({ id: 'a', type: 'BONUS', amount: 5000, status: 'APPLIED' }),
      adj({ id: 'b', type: 'BONUS', amount: 9999, status: 'CANCELLED' }),
      adj({ id: 'c', type: 'DEDUCTION', amount: 3000, status: 'PENDING' }),
      adj({ id: 'd', type: 'DEDUCTION', amount: 1000, status: 'CANCELLED' }),
    ]);
    assert.equal(r.totals.totalBonuses, 5000); // 9999 cancelled excluded
    assert.equal(r.totals.totalDeductions, 3000); // 1000 cancelled excluded
    assert.deepEqual(r.totals.byStatus, { APPLIED: 1, CANCELLED: 2, PENDING: 1 });
  });
  test('rows pass through unchanged (register is a data source, not a transform)', () => {
    const r = buildAdjustmentsRegister([adj({ id: 'x', reason: 'SACCO', targetPeriodMonth: 3 })]);
    assert.equal(r.rows[0].id, 'x');
    assert.equal(r.rows[0].reason, 'SACCO');
    assert.equal(r.rows[0].targetPeriodMonth, 3);
  });
});
