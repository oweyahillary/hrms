import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pairPunches, type Punch } from './punch-pairing.ts';

const calendarDate = (_employeeNumber: string, ts: Date): string => ts.toISOString().slice(0, 10);

function punch(employeeNumber: string, iso: string): Punch {
  return { employeeNumber, timestamp: new Date(iso) };
}

describe('pairPunches', () => {
  test('two punches: first is clockIn, last is clockOut', () => {
    const [pair] = pairPunches(
      [punch('EMP-001', '2026-08-04T08:02:00.000Z'), punch('EMP-001', '2026-08-04T17:05:00.000Z')],
      calendarDate,
    );
    assert.equal(pair.clockIn.toISOString(), '2026-08-04T08:02:00.000Z');
    assert.equal(pair.clockOut?.toISOString(), '2026-08-04T17:05:00.000Z');
    assert.equal(pair.date, '2026-08-04');
  });

  test('single punch only: clockOut is null, not a crash', () => {
    const [pair] = pairPunches([punch('EMP-001', '2026-08-04T08:02:00.000Z')], calendarDate);
    assert.equal(pair.clockOut, null);
    assert.equal(pair.clockIn.toISOString(), '2026-08-04T08:02:00.000Z');
  });

  test('punches out of order in the input are still paired correctly by time', () => {
    const [pair] = pairPunches(
      [
        punch('EMP-001', '2026-08-04T17:05:00.000Z'),
        punch('EMP-001', '2026-08-04T12:30:00.000Z'),
        punch('EMP-001', '2026-08-04T08:02:00.000Z'),
      ],
      calendarDate,
    );
    assert.equal(pair.clockIn.toISOString(), '2026-08-04T08:02:00.000Z');
    assert.equal(pair.clockOut?.toISOString(), '2026-08-04T17:05:00.000Z');
  });

  test('middle punches are ignored — only first and last matter', () => {
    const [pair] = pairPunches(
      [
        punch('EMP-001', '2026-08-04T08:00:00.000Z'),
        punch('EMP-001', '2026-08-04T12:00:00.000Z'), // lunch out
        punch('EMP-001', '2026-08-04T13:00:00.000Z'), // lunch in
        punch('EMP-001', '2026-08-04T17:00:00.000Z'),
      ],
      calendarDate,
    );
    assert.equal(pair.clockIn.toISOString(), '2026-08-04T08:00:00.000Z');
    assert.equal(pair.clockOut?.toISOString(), '2026-08-04T17:00:00.000Z');
  });

  test('night shift: a clockOut punch after midnight groups with the PREVIOUS day via dateFor', () => {
    // dateFor here simulates "this employee has a crossesMidnight shift starting 2026-08-04",
    // so both the 22:xx punch and the 06:xx-next-day punch resolve to '2026-08-04'.
    const nightDateFor = (_employeeNumber: string, ts: Date): string => {
      const hour = ts.getUTCHours();
      const day = new Date(ts);
      if (hour < 12) day.setUTCDate(day.getUTCDate() - 1); // early-morning punch belongs to the PRIOR day's night shift
      return day.toISOString().slice(0, 10);
    };
    const pairs = pairPunches(
      [punch('EMP-001', '2026-08-04T22:05:00.000Z'), punch('EMP-001', '2026-08-05T06:10:00.000Z')],
      nightDateFor,
    );
    assert.equal(pairs.length, 1, 'both punches should group into a single pair, not two');
    assert.equal(pairs[0].date, '2026-08-04');
    assert.equal(pairs[0].clockIn.toISOString(), '2026-08-04T22:05:00.000Z');
    assert.equal(pairs[0].clockOut?.toISOString(), '2026-08-05T06:10:00.000Z');
  });

  test('different employees on the same day produce separate pairs', () => {
    const pairs = pairPunches(
      [punch('EMP-001', '2026-08-04T08:00:00.000Z'), punch('EMP-002', '2026-08-04T09:00:00.000Z')],
      calendarDate,
    );
    assert.equal(pairs.length, 2);
    assert.ok(pairs.some((p) => p.employeeNumber === 'EMP-001'));
    assert.ok(pairs.some((p) => p.employeeNumber === 'EMP-002'));
  });

  test('the same employee on different days produces separate pairs', () => {
    const pairs = pairPunches(
      [punch('EMP-001', '2026-08-04T08:00:00.000Z'), punch('EMP-001', '2026-08-05T08:00:00.000Z')],
      calendarDate,
    );
    assert.equal(pairs.length, 2);
  });

  test('an employee number containing "::" (the internal key separator) does not corrupt grouping', () => {
    const pairs = pairPunches([punch('A::B', '2026-08-04T08:00:00.000Z')], calendarDate);
    assert.equal(pairs[0].employeeNumber, 'A::B');
    assert.equal(pairs[0].date, '2026-08-04');
  });
});
