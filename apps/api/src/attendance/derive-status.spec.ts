import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStatus, lateMinutes, type ShiftWindow } from './derive-status.ts';

const GENERAL: ShiftWindow = { startTime: '08:00' };
const NIGHT: ShiftWindow = { startTime: '22:00' };

describe('deriveStatus', () => {
  test('no clockIn is ABSENT regardless of shift or grace', () => {
    assert.equal(deriveStatus(null, null, GENERAL, 15), 'ABSENT');
  });

  test('clockIn exactly on the scheduled start is PRESENT', () => {
    const clockIn = new Date('2026-08-04T08:00:00.000Z');
    assert.equal(deriveStatus(clockIn, null, GENERAL, 15), 'PRESENT');
  });

  test('clockIn before the scheduled start is PRESENT (arriving early is never late)', () => {
    const clockIn = new Date('2026-08-04T07:30:00.000Z');
    assert.equal(deriveStatus(clockIn, null, GENERAL, 15), 'PRESENT');
  });

  test('clockIn exactly at the grace boundary (start + grace) is still PRESENT', () => {
    const clockIn = new Date('2026-08-04T08:15:00.000Z'); // 08:00 + 15min grace
    assert.equal(deriveStatus(clockIn, null, GENERAL, 15), 'PRESENT');
  });

  test('clockIn one minute past the grace boundary is LATE', () => {
    const clockIn = new Date('2026-08-04T08:16:00.000Z');
    assert.equal(deriveStatus(clockIn, null, GENERAL, 15), 'LATE');
  });

  test('zero grace minutes: any clock-in after the start is LATE', () => {
    const clockIn = new Date('2026-08-04T08:00:01.000Z');
    assert.equal(deriveStatus(clockIn, null, GENERAL, 0), 'LATE');
  });

  test('a night shift clockOut on the next calendar day does not affect the PRESENT/LATE outcome', () => {
    const clockIn = new Date('2026-08-04T22:05:00.000Z'); // on time for a 22:00 start
    const clockOutNextDay = new Date('2026-08-05T06:10:00.000Z');
    assert.equal(deriveStatus(clockIn, clockOutNextDay, NIGHT, 15), 'PRESENT');
    assert.equal(deriveStatus(clockIn, null, NIGHT, 15), 'PRESENT');
  });

  test('a night shift clock-in well past its grace window is LATE, independent of clockOut', () => {
    const clockIn = new Date('2026-08-04T22:45:00.000Z');
    assert.equal(deriveStatus(clockIn, null, NIGHT, 15), 'LATE');
  });
});

describe('lateMinutes', () => {
  test('on time or early is 0', () => {
    assert.equal(lateMinutes(new Date('2026-08-04T08:00:00.000Z'), GENERAL), 0);
    assert.equal(lateMinutes(new Date('2026-08-04T07:45:00.000Z'), GENERAL), 0);
  });

  test('reports raw minutes late even within the grace window (status can still be PRESENT)', () => {
    assert.equal(lateMinutes(new Date('2026-08-04T08:10:00.000Z'), GENERAL), 10);
  });

  test('no clockIn is 0, not a crash', () => {
    assert.equal(lateMinutes(null, GENERAL), 0);
  });
});
