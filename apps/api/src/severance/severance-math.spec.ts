import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeveranceComputation,
  completedYearsOfService,
  computeNoticePeriod,
  computeSeverance,
  dailyRate,
  daysPerMonthForBasis,
  DAYS_PER_MONTH,
  SEVERANCE_DAYS_PER_YEAR,
  WORKING_DAYS_PER_MONTH,
  classifySeveranceTaxTreatment,
} from './severance-math.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

test('dailyRate divides monthly basic by DAYS_PER_MONTH', () => {
  assert.equal(dailyRate(60000), 2000); // 60000 / 30
  assert.equal(DAYS_PER_MONTH, 30);
  assert.equal(SEVERANCE_DAYS_PER_YEAR, 15);
});

test('completedYearsOfService counts only COMPLETED years (partial year does NOT count)', () => {
  // exactly on the 5th anniversary -> 5
  assert.equal(completedYearsOfService(d('2019-01-15'), d('2024-01-15')), 5);
  // one day short of the 5th anniversary -> 4, NOT 5 (the crux of "completed year")
  assert.equal(completedYearsOfService(d('2019-01-15'), d('2024-01-14')), 4);
  // well past the 5th but before the 6th -> 5
  assert.equal(completedYearsOfService(d('2019-01-15'), d('2024-11-30')), 5);
  // under a single year -> 0
  assert.equal(completedYearsOfService(d('2023-06-01'), d('2024-01-01')), 0);
  // same day -> 0
  assert.equal(completedYearsOfService(d('2024-01-01'), d('2024-01-01')), 0);
  // exit before hire (defensive) -> 0, never negative
  assert.equal(completedYearsOfService(d('2024-01-01'), d('2020-01-01')), 0);
});

test('completedYearsOfService handles a leap-day hire correctly', () => {
  // Feb-29 hire: the 4th anniversary lands on 2024-02-29 (a leap year)
  assert.equal(completedYearsOfService(d('2020-02-29'), d('2024-02-28')), 3);
  assert.equal(completedYearsOfService(d('2020-02-29'), d('2024-02-29')), 4);
});

test('severance applies ONLY to redundancy; every other reason is 0 with a note', () => {
  const args = { basicSalary: 60000, hireDate: d('2019-01-01'), exitDate: d('2024-06-30') } as const;

  const red = computeSeverance({ ...args, reason: 'REDUNDANCY' });
  assert.equal(red.applies, true);
  assert.equal(red.completedYears, 5);
  // 2000/day × 15 × 5 = 150000
  assert.equal(red.gross, 150000);

  for (const reason of ['RESIGNATION', 'TERMINATION', 'RETIREMENT'] as const) {
    const r = computeSeverance({ ...args, reason });
    assert.equal(r.applies, false, `${reason} should not attract severance`);
    assert.equal(r.gross, 0, `${reason} severance must be 0`);
    // the zero case is REPORTED, not omitted: it still carries a reason + the years it would have used
    assert.equal(r.completedYears, 5);
    assert.match(r.note, /redundancy only/i);
  }
});

test('redundancy under one completed year accrues nothing but still reports', () => {
  const r = computeSeverance({ reason: 'REDUNDANCY', basicSalary: 60000, hireDate: d('2023-08-01'), exitDate: d('2024-06-30') });
  assert.equal(r.applies, true);
  assert.equal(r.completedYears, 0);
  assert.equal(r.gross, 0);
  assert.match(r.note, /under one completed year/i);
});

test('notice period: statutory minimum by pay frequency (§35)', () => {
  const base = { basicSalary: 30000 };
  assert.equal(computeNoticePeriod({ ...base, payFrequency: 'DAILY' }).appliedDays, 0);
  assert.equal(computeNoticePeriod({ ...base, payFrequency: 'WEEKLY' }).appliedDays, 7);
  assert.equal(computeNoticePeriod({ ...base, payFrequency: 'BI_WEEKLY' }).appliedDays, 14);
  assert.equal(computeNoticePeriod({ ...base, payFrequency: 'MONTHLY' }).appliedDays, 28);
});

test('notice period: a longer contractual notice overrides statutory, never the reverse', () => {
  // contractual 60 > statutory 28 -> use 60, basis contractual
  const longer = computeNoticePeriod({ payFrequency: 'MONTHLY', basicSalary: 30000, contractualNoticeDays: 60 });
  assert.equal(longer.appliedDays, 60);
  assert.equal(longer.basis, 'contractual');
  // contractual 14 < statutory 28 -> statutory floor holds at 28
  const shorter = computeNoticePeriod({ payFrequency: 'MONTHLY', basicSalary: 30000, contractualNoticeDays: 14 });
  assert.equal(shorter.appliedDays, 28);
  assert.equal(shorter.basis, 'statutory');
});

test('notice pay in lieu = applied days × a day\'s pay', () => {
  // 30000/30 = 1000/day; 28 days -> 28000
  const n = computeNoticePeriod({ payFrequency: 'MONTHLY', basicSalary: 30000 });
  assert.equal(n.dailyRate, 1000);
  assert.equal(n.payInLieu, 28000);
});

test('buildSeveranceComputation captures enough to reconstruct the payout by hand', () => {
  const c = buildSeveranceComputation({
    reason: 'REDUNDANCY', basicSalary: 60000,
    hireDate: d('2019-01-01'), exitDate: d('2024-06-30'),
    payFrequency: 'MONTHLY', contractualNoticeDays: 90,
  });
  const b = c.breakdown as {
    dailyRate: number; basicSalary: number;
    severance: { completedYears: number; daysPerYear: number; gross: number };
    notice: { appliedDays: number; payInLieu: number; basis: string };
  };
  // hand-reconstruction: dailyRate × daysPerYear × completedYears === stored gross
  assert.equal(b.dailyRate * b.severance.daysPerYear * b.severance.completedYears, b.severance.gross);
  assert.equal(b.severance.gross, 150000);
  // notice honoured the longer contractual period
  assert.equal(b.notice.appliedDays, 90);
  assert.equal(b.notice.basis, 'contractual');
  assert.equal(b.notice.payInLieu, 2000 * 90); // 180000
  // inputs are all present for the audit trail
  assert.equal(b.basicSalary, 60000);
});

test('daysPerMonthForBasis maps the two documented conventions', () => {
  assert.equal(daysPerMonthForBasis('CALENDAR_30'), 30);
  assert.equal(daysPerMonthForBasis('WORKING_26'), 26);
  assert.equal(WORKING_DAYS_PER_MONTH, 26);
});

test('the day-rate divisor is a real parameter: passing 26 changes the result', () => {
  // default (30): 60000/30 = 2000/day
  assert.equal(dailyRate(60000), 2000);
  // working-days basis (26): 60000/26 = 2307.69/day — provably different
  assert.equal(dailyRate(60000, WORKING_DAYS_PER_MONTH), 2307.69);

  const args = { reason: 'REDUNDANCY' as const, basicSalary: 60000, hireDate: d('2019-01-01'), exitDate: d('2024-06-30') };
  const calendar = computeSeverance(args); // 2000 × 15 × 5
  const working = computeSeverance({ ...args, daysPerMonth: WORKING_DAYS_PER_MONTH }); // 2307.69 × 15 × 5

  assert.equal(calendar.gross, 150000);
  assert.equal(working.gross, 173076.75);
  assert.notEqual(working.gross, calendar.gross); // the parameter demonstrably bites
  assert.equal(working.daysPerMonth, 26);
  assert.equal(calendar.daysPerMonth, 30);
});

test('buildSeveranceComputation snapshots the basis it was given (not always 30)', () => {
  const c = buildSeveranceComputation({
    reason: 'REDUNDANCY', basicSalary: 60000,
    hireDate: d('2019-01-01'), exitDate: d('2024-06-30'),
    payFrequency: 'MONTHLY', daysPerMonth: WORKING_DAYS_PER_MONTH,
  });
  const b = c.breakdown as { daysPerMonth: number; dailyRate: number; severance: { gross: number } };
  assert.equal(b.daysPerMonth, 26); // the snapshot reflects the org setting, not the default
  assert.equal(b.dailyRate, 2307.69);
  assert.equal(b.severance.gross, 173076.75);
  // notice pay-in-lieu also uses the same basis
  assert.equal((c.notice as { dailyRate: number }).dailyRate, 2307.69);
});

// -- classifySeveranceTaxTreatment (KRA three-bucket PAYE spreading) ----------

test('FIXED_TERM spreads the lump sum over the unexpired term months', () => {
  const s = classifySeveranceTaxTreatment({
    severanceAmount: 120000, contractTermType: 'FIXED_TERM', unexpiredTermMonths: 6, annualGross: 720000,
  });
  assert.equal(s.bucket, 'FIXED_TERM');
  assert.equal(s.periods, 6);
  assert.equal(s.amountPerPeriod, 20000); // 120000 / 6
});

test('UNSPECIFIED_WITH_CLAUSE spreads forward at the pre-termination monthly rate', () => {
  // monthly gross = 600000/12 = 50000; ceil(175000/50000) = 4 periods
  const s = classifySeveranceTaxTreatment({
    severanceAmount: 175000, contractTermType: 'UNSPECIFIED_WITH_CLAUSE', annualGross: 600000,
  });
  assert.equal(s.bucket, 'UNSPECIFIED_WITH_CLAUSE');
  assert.equal(s.periods, 4);
  assert.equal(s.amountPerPeriod, 43750); // 175000 / 4
});

test('NO_PROVISION spreads evenly over 36 months (3 years)', () => {
  const s = classifySeveranceTaxTreatment({
    severanceAmount: 360000, contractTermType: 'NO_PROVISION', annualGross: 600000,
  });
  assert.equal(s.bucket, 'NO_PROVISION');
  assert.equal(s.periods, 36);
  assert.equal(s.amountPerPeriod, 10000); // 360000 / 36
});

test('FIXED_TERM without unexpiredTermMonths rejects (does not silently default)', () => {
  assert.throws(
    () => classifySeveranceTaxTreatment({
      severanceAmount: 120000, contractTermType: 'FIXED_TERM', annualGross: 720000,
    }),
    /unexpiredTermMonths is required/,
  );
  // zero / negative are equally invalid
  assert.throws(() => classifySeveranceTaxTreatment({
    severanceAmount: 120000, contractTermType: 'FIXED_TERM', unexpiredTermMonths: 0, annualGross: 720000,
  }), /unexpiredTermMonths is required/);
});
