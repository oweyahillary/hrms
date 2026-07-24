import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveOvertime, multiplierFor, computeHourlyRate, computeOvertimeAmount,
  pickEffectiveOvertimePolicy, shiftScheduledMinutes,
  type ShiftWindow, type OvertimePolicyLike,
} from './overtime-derivation.ts';

const GENERAL: ShiftWindow = { startTime: '08:00', endTime: '17:00', crossesMidnight: false, breakMinutes: 60 }; // 8h scheduled
const NIGHT: ShiftWindow = { startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakMinutes: 0 }; // 8h scheduled

const POLICY: OvertimePolicyLike = {
  normalDayMultiplier: 1.5, restDayMultiplier: 2, holidayMultiplier: 2,
  minimumMinutesToCount: 30, maxHoursPerDay: null,
};

function at(iso: string): Date { return new Date(iso); }

describe('shiftScheduledMinutes', () => {
  test('a same-day shift is endTime - startTime', () => {
    assert.equal(shiftScheduledMinutes(GENERAL), 9 * 60); // 08:00-17:00 raw span (break subtracted separately by the caller)
  });

  test('a night shift crossing midnight wraps the end time past 24:00', () => {
    assert.equal(shiftScheduledMinutes(NIGHT), 8 * 60); // 22:00 -> 06:00 next day
  });
});

describe('deriveOvertime', () => {
  test('clockOut missing yields no overtime', () => {
    const result = deriveOvertime({ clockIn: at('2026-08-04T08:00:00.000Z'), clockOut: null, shift: GENERAL, isHoliday: false, policy: POLICY });
    assert.equal(result, null);
  });

  test('clockIn missing yields no overtime', () => {
    const result = deriveOvertime({ clockIn: null, clockOut: at('2026-08-04T20:00:00.000Z'), shift: GENERAL, isHoliday: false, policy: POLICY });
    assert.equal(result, null);
  });

  test('exactly at the minimumMinutesToCount boundary counts (not discarded)', () => {
    // GENERAL: 08:00-17:00 minus 60min break = 480min scheduled. clockOut 30min past that -> exactly the 30min policy minimum.
    const result = deriveOvertime({
      clockIn: at('2026-08-04T08:00:00.000Z'), clockOut: at('2026-08-04T17:30:00.000Z'),
      shift: GENERAL, isHoliday: false, policy: POLICY,
    });
    assert.ok(result, 'expected an overtime entry at exactly the boundary');
    assert.equal(result!.hours, 0.5);
    assert.equal(result!.category, 'NORMAL_DAY');
  });

  test('one minute below the minimumMinutesToCount boundary is discarded entirely', () => {
    const result = deriveOvertime({
      clockIn: at('2026-08-04T08:00:00.000Z'), clockOut: at('2026-08-04T17:29:00.000Z'),
      shift: GENERAL, isHoliday: false, policy: POLICY,
    });
    assert.equal(result, null);
  });

  test('a normal day with no overtime worked yields nothing', () => {
    const result = deriveOvertime({
      clockIn: at('2026-08-04T08:00:00.000Z'), clockOut: at('2026-08-04T17:00:00.000Z'),
      shift: GENERAL, isHoliday: false, policy: POLICY,
    });
    assert.equal(result, null);
  });

  test('cap exceeded: hours are capped, the excess is reported, not silently dropped', () => {
    const capped: OvertimePolicyLike = { ...POLICY, maxHoursPerDay: 2 };
    // Scheduled ends 17:00; worked until 21:00 -> 4h overtime, capped at 2h.
    const result = deriveOvertime({
      clockIn: at('2026-08-04T08:00:00.000Z'), clockOut: at('2026-08-04T21:00:00.000Z'),
      shift: GENERAL, isHoliday: false, policy: capped,
    });
    assert.ok(result);
    assert.equal(result!.hours, 2);
    assert.equal(result!.excessHours, 2);
  });

  test('no cap configured (null) never reports an excess, however many hours worked', () => {
    const result = deriveOvertime({
      clockIn: at('2026-08-04T08:00:00.000Z'), clockOut: at('2026-08-04T23:00:00.000Z'),
      shift: GENERAL, isHoliday: false, policy: POLICY,
    });
    assert.ok(result);
    assert.equal(result!.hours, 6);
    assert.equal(result!.excessHours, 0);
  });

  test('a night shift spanning midnight: overtime is worked time beyond the wrapped 8h schedule', () => {
    // Clocks in on time (22:00), clocks out 07:30 next day -> 9.5h worked, 8h scheduled, 1.5h overtime.
    const result = deriveOvertime({
      clockIn: at('2026-08-04T22:00:00.000Z'), clockOut: at('2026-08-05T07:30:00.000Z'),
      shift: NIGHT, isHoliday: false, policy: POLICY,
    });
    assert.ok(result);
    assert.equal(result!.hours, 1.5);
    assert.equal(result!.category, 'NORMAL_DAY');
  });

  test('rest day: no ShiftAssignment at all means EVERY worked hour is overtime, not just hours beyond some fallback shift', () => {
    // "employee with attendance but no shift" — the shift is null, not a General fallback.
    const result = deriveOvertime({
      clockIn: at('2026-08-04T09:00:00.000Z'), clockOut: at('2026-08-04T13:00:00.000Z'),
      shift: null, isHoliday: false, policy: POLICY,
    });
    assert.ok(result);
    assert.equal(result!.hours, 4);
    assert.equal(result!.category, 'REST_DAY');
  });

  test('public holiday: ALL hours worked count as overtime even with a shift assigned that day', () => {
    const result = deriveOvertime({
      clockIn: at('2026-08-04T08:00:00.000Z'), clockOut: at('2026-08-04T12:00:00.000Z'),
      shift: GENERAL, isHoliday: true, policy: POLICY,
    });
    assert.ok(result);
    assert.equal(result!.hours, 4);
    assert.equal(result!.category, 'HOLIDAY');
  });

  test('holiday takes priority over rest-day when both would apply (no shift AND a holiday)', () => {
    const result = deriveOvertime({
      clockIn: at('2026-08-04T08:00:00.000Z'), clockOut: at('2026-08-04T12:00:00.000Z'),
      shift: null, isHoliday: true, policy: POLICY,
    });
    assert.ok(result);
    assert.equal(result!.category, 'HOLIDAY');
  });
});

describe('multiplierFor', () => {
  test('picks the right multiplier per category', () => {
    assert.equal(multiplierFor('NORMAL_DAY', POLICY), 1.5);
    assert.equal(multiplierFor('REST_DAY', POLICY), 2);
    assert.equal(multiplierFor('HOLIDAY', POLICY), 2);
  });
});

describe('computeHourlyRate', () => {
  test('MONTHLY_X12_DIV_52_WEEKLY_HOURS: (basic * 12 / 52) / normalWeeklyHours', () => {
    const rate = computeHourlyRate(90000, { hourlyRateBasis: 'MONTHLY_X12_DIV_52_WEEKLY_HOURS', normalWeeklyHours: 45 });
    assert.ok(Math.abs(rate - (90000 * 12) / 52 / 45) < 1e-9);
  });

  test('MONTHLY_DIV_26_DIV_8: basic / 26 / 8', () => {
    const rate = computeHourlyRate(83200, { hourlyRateBasis: 'MONTHLY_DIV_26_DIV_8', normalWeeklyHours: 45 });
    assert.ok(Math.abs(rate - 83200 / 26 / 8) < 1e-9);
  });
});

describe('computeOvertimeAmount', () => {
  test('hours * hourlyRate * multiplier, rounded to 2dp', () => {
    assert.equal(computeOvertimeAmount(2, 100, 1.5), 300);
    assert.equal(computeOvertimeAmount(1.5, 133.333, 2), 400); // 1.5*133.333*2 = 399.999 -> rounds to 400
  });
});

describe('pickEffectiveOvertimePolicy', () => {
  const rows = [
    { id: 'a', effectiveFrom: '2026-01-01' },
    { id: 'b', effectiveFrom: '2026-06-01' },
    { id: 'c', effectiveFrom: '2027-01-01' }, // future-dated, not yet in force
  ];

  test('picks the most recent policy at or before the asOf date', () => {
    assert.equal(pickEffectiveOvertimePolicy(rows, new Date('2026-07-15'))!.id, 'b');
  });

  test('a future-dated policy is never picked before its effectiveFrom', () => {
    assert.equal(pickEffectiveOvertimePolicy(rows, new Date('2026-12-31'))!.id, 'b');
  });

  test('exactly on the effective date counts as in force', () => {
    assert.equal(pickEffectiveOvertimePolicy(rows, new Date('2026-06-01'))!.id, 'b');
  });

  test('no policy at all before the earliest effectiveFrom returns null', () => {
    assert.equal(pickEffectiveOvertimePolicy(rows, new Date('2025-01-01')), null);
  });
});
