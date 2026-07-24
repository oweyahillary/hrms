/**
 * Pure overtime logic — no I/O, no Prisma, no NestJS. Same discipline as
 * attendance/derive-status.ts and attendance/punch-pairing.ts: given already-
 * resolved inputs (a completed clock-in/out pair, the day's shift window if
 * any, whether it's a public holiday, and the org's effective policy), derive
 * hours/category, then turn those into a payable amount.
 *
 * Category resolution order (first match wins — see deriveOvertime):
 *   1. HOLIDAY — the date is a public holiday for this org. ALL hours worked
 *      count as overtime, regardless of whether a shift was scheduled.
 *   2. REST_DAY — no ShiftAssignment exists for this employee/date at all
 *      (deliberately NOT the "fall back to General shift" convention
 *      attendance status derivation uses — an unassigned day here means the
 *      employee wasn't expected to work, so every hour worked is overtime).
 *   3. NORMAL_DAY — a shift was assigned; only hours beyond the shift's
 *      scheduled duration (minus its break) count.
 *
 * Night-shift midnight-crossing: NOT re-derived here. By the time an
 * AttendanceRecord + its same-date ShiftAssignment reach this function, T1/T2
 * have already attributed the record to the shift's START date (see
 * AttendanceService.buildNightShiftAwareDateFor) — deriveOvertime just needs
 * the shift's own startTime/endTime/crossesMidnight to compute its scheduled
 * duration correctly across midnight, which shiftScheduledMinutes does.
 */

export interface ShiftWindow {
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  crossesMidnight: boolean;
  breakMinutes: number;
}

export type OvertimeCategory = 'NORMAL_DAY' | 'REST_DAY' | 'HOLIDAY';
export type OvertimeHourlyRateBasis = 'MONTHLY_X12_DIV_52_WEEKLY_HOURS' | 'MONTHLY_DIV_26_DIV_8';

export interface OvertimePolicyLike {
  normalDayMultiplier: number;
  restDayMultiplier: number;
  holidayMultiplier: number;
  minimumMinutesToCount: number;
  /** null = uncapped. */
  maxHoursPerDay: number | null;
}

export interface DeriveOvertimeInput {
  clockIn: Date | null;
  clockOut: Date | null;
  /** null = no ShiftAssignment for this employee on this date. */
  shift: ShiftWindow | null;
  isHoliday: boolean;
  policy: OvertimePolicyLike;
}

export interface DerivedOvertime {
  /** Capped at policy.maxHoursPerDay — what gets recorded/paid. */
  hours: number;
  /** hours beyond the cap that were NOT counted — reported, never silently dropped. 0 when uncapped or under the cap. */
  excessHours: number;
  category: OvertimeCategory;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Minutes a shift is scheduled to run, INCLUDING its break (subtract that separately) — handles crossesMidnight by wrapping the end time past 24:00. */
export function shiftScheduledMinutes(shift: ShiftWindow): number {
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (shift.crossesMidnight || endMin <= startMin) endMin += 24 * 60;
  return endMin - startMin;
}

/**
 * null means "no overtime to record" — either the session is incomplete
 * (missing clockIn/clockOut), non-positive, or the worked-beyond-schedule
 * time is below policy.minimumMinutesToCount (discarded, not rounded up).
 *
 * DELIBERATE DEVIATION from a literal "scheduled duration minus breakMinutes"
 * reading: comparing a GROSS worked span (clockOut - clockIn — all a single
 * punch-pair AttendanceRecord can give us, since break punches aren't
 * tracked) against a NET scheduled duration (shift span minus its break)
 * credits every employee who works precisely their assigned shift — arriving
 * and leaving exactly on time, taking their normal lunch — with phantom
 * overtime equal to the shift's own breakMinutes, every single day. At scale
 * (100+ staff) that's a material, silently-wrong payroll cost, not a rounding
 * quirk. Comparing GROSS to GROSS (this shift's own raw endTime-startTime
 * span, breakMinutes not subtracted from either side) is what a single
 * clock-in/clock-out pair can support without that artifact: a worker who
 * clocks in and out exactly on their shift's boundary shows zero overtime,
 * which is the correct, expected behaviour. Flagged explicitly in the
 * summary for confirmation — this is a real behavioural choice, not a
 * cosmetic one.
 */
export function deriveOvertime(input: DeriveOvertimeInput): DerivedOvertime | null {
  const { clockIn, clockOut, shift, isHoliday, policy } = input;
  if (!clockIn || !clockOut) return null;

  const workedMinutes = (clockOut.getTime() - clockIn.getTime()) / 60_000;
  if (workedMinutes <= 0) return null;

  let category: OvertimeCategory;
  let overtimeMinutes: number;
  if (isHoliday) {
    category = 'HOLIDAY';
    overtimeMinutes = workedMinutes;
  } else if (!shift) {
    category = 'REST_DAY';
    overtimeMinutes = workedMinutes;
  } else {
    category = 'NORMAL_DAY';
    const scheduledMinutes = shiftScheduledMinutes(shift);
    overtimeMinutes = Math.max(0, workedMinutes - scheduledMinutes);
  }

  if (overtimeMinutes < policy.minimumMinutesToCount) return null;

  let hours = round2(overtimeMinutes / 60);
  let excessHours = 0;
  if (policy.maxHoursPerDay !== null && hours > policy.maxHoursPerDay) {
    excessHours = round2(hours - policy.maxHoursPerDay);
    hours = policy.maxHoursPerDay;
  }
  return { hours, excessHours, category };
}

export function multiplierFor(category: OvertimeCategory, policy: OvertimePolicyLike): number {
  if (category === 'HOLIDAY') return policy.holidayMultiplier;
  if (category === 'REST_DAY') return policy.restDayMultiplier;
  return policy.normalDayMultiplier;
}

/**
 * Turns a monthly basic salary into an hourly rate. Kenyan practice varies —
 * NOT a settled statutory formula (unlike PAYE/NSSF/SHIF/AHL) — see
 * docs/overtime.md and the summary's open question. Deliberately UNROUNDED:
 * this feeds computeOvertimeAmount's multiplication, and this codebase's own
 * convention (payroll-engine.ts) only rounds at the point a figure becomes a
 * persisted/displayed amount, not every intermediate — rounding an hourly
 * rate to 2dp first would compound error across many OvertimeEntry rows.
 */
export function computeHourlyRate(
  basicSalary: number,
  policy: { hourlyRateBasis: OvertimeHourlyRateBasis; normalWeeklyHours: number },
): number {
  if (policy.hourlyRateBasis === 'MONTHLY_DIV_26_DIV_8') return basicSalary / 26 / 8;
  return (basicSalary * 12) / 52 / policy.normalWeeklyHours;
}

export function computeOvertimeAmount(hours: number, hourlyRate: number, multiplier: number): number {
  return round2(hours * hourlyRate * multiplier);
}

/** Most recent policy with effectiveFrom <= asOf — same "latest applicable version" shape as rate-parameters.ts's pickEffective, adapted to this model's field name. */
export function pickEffectiveOvertimePolicy<T extends { effectiveFrom: Date | string }>(
  rows: readonly T[], asOf: Date,
): T | null {
  const cutoff = asOf.getTime();
  let best: T | null = null;
  let bestTime = -Infinity;
  for (const r of rows) {
    const t = new Date(r.effectiveFrom).getTime();
    if (t <= cutoff && t > bestTime) { best = r; bestTime = t; }
  }
  return best;
}
