/**
 * Shift-aware PRESENT/LATE/ABSENT derivation. This is what "derived" means
 * throughout the attendance module — an EXPLICIT status from HR or an
 * import always wins over it (see attendance.service.ts's upsert/import
 * paths), and this function never produces ON_LEAVE (that only ever comes
 * from an explicit set, matching a leave request). All math in UTC, same
 * convention as the leave module's date handling.
 */
export interface ShiftWindow {
  /** "HH:MM", 24-hour — the shift's scheduled start, always evaluated against
   * clockIn's OWN calendar date. A clock-in inherently happens on the day a
   * shift STARTS regardless of crossesMidnight (see the ShiftAssignment
   * model: the record is dated by the shift's start day, never its end
   * day), so no separate "which day" resolution is needed here — that
   * happens one layer up, in how the caller resolves which ShiftDefinition
   * applies to a given date. */
  startTime: string;
}

export type DerivedStatus = 'PRESENT' | 'LATE' | 'ABSENT';

/**
 * clockOut is accepted but not currently examined — Kenyan practice (and
 * this codebase's existing ABSENT/PRESENT inference) defines lateness by
 * arrival, not departure. It's part of the signature so callers can pass a
 * whole record without picking fields apart, and so a departure-based rule
 * (e.g. flagging early leaves) has a natural home later without another
 * signature change.
 */
export function deriveStatus(
  clockIn: Date | null,
  _clockOut: Date | null,
  shift: ShiftWindow,
  graceMinutes: number,
): DerivedStatus {
  if (!clockIn) return 'ABSENT';

  const scheduledStart = scheduledStartFor(clockIn, shift);
  const deadline = new Date(scheduledStart.getTime() + graceMinutes * 60_000);
  return clockIn.getTime() <= deadline.getTime() ? 'PRESENT' : 'LATE';
}

/**
 * Whole minutes late (0 if on time or early) — the raw figure independent
 * of the grace window, so "present, 10 minutes late" is still visible even
 * though 10 < graceMinutes kept the status PRESENT.
 */
export function lateMinutes(clockIn: Date | null, shift: ShiftWindow): number {
  if (!clockIn) return 0;
  const scheduledStart = scheduledStartFor(clockIn, shift);
  return Math.max(0, Math.round((clockIn.getTime() - scheduledStart.getTime()) / 60_000));
}

function scheduledStartFor(clockIn: Date, shift: ShiftWindow): Date {
  const [h, m] = shift.startTime.split(':').map(Number);
  return new Date(Date.UTC(clockIn.getUTCFullYear(), clockIn.getUTCMonth(), clockIn.getUTCDate(), h, m));
}
