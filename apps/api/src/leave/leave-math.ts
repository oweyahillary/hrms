/**
 * Pure leave calculations — no I/O, so they're unit-testable in isolation and
 * hold the rules requests depend on.
 */

/** A calendar day as 'YYYY-MM-DD' in UTC (dates are stored as @db.Date). */
export function toISODate(d: Date): string {
  return `${d.getUTCFullYear().toString().padStart(4, '0')}-${(d.getUTCMonth() + 1)
    .toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
}

/**
 * Working days between start and end INCLUSIVE, excluding weekends (Sat/Sun) and
 * any date in `holidays` (a set of 'YYYY-MM-DD'). Returns 0 if end < start.
 */
export function countWorkingDays(start: Date, end: Date, holidays: ReadonlySet<string>): number {
  const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  if (e < s) return 0;

  let count = 0;
  for (let t = s; t <= e; t += 86_400_000) {
    const d = new Date(t);
    const dow = d.getUTCDay(); // 0 Sun … 6 Sat
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(toISODate(d))) continue;
    count += 1;
  }
  return count;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Remaining leave a balance can still spend. */
export function availableDays(accrued: number, carriedOver: number, used: number): number {
  return round2(accrued + carriedOver - used);
}

/** How a leave type's annual entitlement becomes available over the year. */
export type AccrualMethod = 'UPFRONT' | 'MONTHLY' | 'DAILY' | 'NONE';

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * Whole accruable months for an employee within a calendar `year`, from their
 * hire month (if hired during the year) or January (if hired earlier), through
 * `throughMonth` inclusive. Accrual begins in the hire month (whole-month, not
 * day-prorated). Returns 0 if the employee was not yet hired by then.
 *
 *   throughMonth is 1..12.
 */
export function accrualMonthsInYear(hireDate: Date, year: number, throughMonth: number): number {
  const hy = hireDate.getUTCFullYear();
  const hm = hireDate.getUTCMonth() + 1; // 1..12
  if (hy > year) return 0; // hired in a later year
  if (hy === year && hm > throughMonth) return 0; // hired later this year than the target month
  const startMonth = hy < year ? 1 : hm;
  return throughMonth - startMonth + 1;
}

/**
 * Days accrued from the start of `year` through the end of `throughMonth`
 * (1..12) for an employee, given the annual entitlement and the type's accrual
 * method. Result is rounded to 2dp and capped at the annual entitlement (a full
 * year yields exactly the entitlement, never more). Mid-year joiners are
 * pro-rated; anyone not yet hired by the target month accrues 0.
 *
 *   - UPFRONT: the whole (pro-rated for joiners) entitlement is granted as soon
 *     as employment starts in the year, independent of throughMonth.
 *   - MONTHLY: entitlement / 12 per whole month of service.
 *   - DAILY:   entitlement / daysInYear per calendar day of service.
 *   - NONE:    never auto-accrues (granted manually, e.g. sick/maternity).
 */
export function accruedToDate(
  method: AccrualMethod,
  hireDate: Date,
  annualDays: number,
  year: number,
  throughMonth: number,
): number {
  if (method === 'NONE' || !(annualDays > 0)) return 0;

  const hy = hireDate.getUTCFullYear();
  const hm = hireDate.getUTCMonth() + 1;
  if (hy > year) return 0;
  if (hy === year && hm > throughMonth) return 0;

  if (method === 'UPFRONT') {
    // Full entitlement up front; pro-rate a mid-year joiner by remaining whole months.
    const startMonth = hy < year ? 1 : hm;
    const monthsGranted = 12 - startMonth + 1;
    return round2(Math.min(annualDays, (annualDays * monthsGranted) / 12));
  }

  if (method === 'MONTHLY') {
    const months = accrualMonthsInYear(hireDate, year, throughMonth);
    return round2(Math.min(annualDays, (annualDays / 12) * months));
  }

  // DAILY — accrue per calendar day from Jan 1 (or hire date) through end of throughMonth.
  const startDay = hy < year
    ? Date.UTC(year, 0, 1)
    : Date.UTC(hy, hireDate.getUTCMonth(), hireDate.getUTCDate());
  const endDay = Date.UTC(year, throughMonth, 0); // last day of throughMonth
  const elapsedDays = Math.floor((endDay - startDay) / 86_400_000) + 1; // inclusive
  const accrued = (annualDays / daysInYear(year)) * Math.max(0, elapsedDays);
  return round2(Math.min(annualDays, accrued));
}
