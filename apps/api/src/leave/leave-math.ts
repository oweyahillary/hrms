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

/** Remaining leave a balance can still spend, ignoring carry-over expiry. */
export function availableDays(accrued: number, carriedOver: number, used: number): number {
  return round2(accrued + carriedOver - used);
}

/* ------------------------------------------------------------------ *
 * Carry-over and expiry
 *
 * ORDER OF CONSUMPTION: days taken are drawn from carried-over days FIRST,
 * then from the current year's accrual. This is the only order that makes
 * expiry meaningful — draw from accrual first and the carried days would always
 * still be sitting there when they lapse, so nobody could ever use them. It is
 * also the employee-friendly reading of use-it-or-lose-it.
 * ------------------------------------------------------------------ */

/** Carried-over days not yet spent. */
export function carriedRemaining(carriedOver: number, used: number): number {
  return round2(Math.max(0, carriedOver - used));
}

/** Days drawn from THIS year's accrual (i.e. spend beyond the carried pool). */
export function accrualUsed(carriedOver: number, used: number): number {
  return round2(Math.max(0, used - carriedOver));
}

/**
 * The instant carried-over days lapse, for days carried INTO `year`.
 *
 * `expiryMonths` counts whole months from 1 January of that year, and the
 * returned instant is exclusive: with 3, the days are usable through 31 March
 * and gone on 1 April. null (never expires) returns null.
 */
export function carryOverExpiryAt(year: number, expiryMonths: number | null): Date | null {
  if (expiryMonths == null) return null;
  // Month overflow is intentional and correct: month 12 rolls to 1 Jan next year.
  return new Date(Date.UTC(year, expiryMonths, 1));
}

/**
 * The LAST DAY carried-over days can be used, as 'YYYY-MM-DD' — the day before
 * the exclusive lapse instant. This is the date to show a human: "usable
 * through 31 March", never the internal 1 April boundary.
 */
export function carryOverLastUsableDate(year: number, expiryMonths: number | null): string | null {
  const at = carryOverExpiryAt(year, expiryMonths);
  if (at == null) return null;
  return toISODate(new Date(at.getTime() - 86_400_000));
}

/** Whether carried days for `year` have lapsed by `asOf`. */
export function carryOverExpired(year: number, expiryMonths: number | null, asOf: Date): boolean {
  const at = carryOverExpiryAt(year, expiryMonths);
  return at != null && asOf.getTime() >= at.getTime();
}

/**
 * Days available to spend at `asOf`, excluding carried days that have lapsed.
 *
 * Before expiry this equals availableDays(). After expiry the unspent carried
 * days drop out, but days already SPENT from that pool stay spent — they don't
 * come back and re-charge the current year's accrual.
 */
export function availableDaysAsOf(
  accrued: number, carriedOver: number, used: number,
  year: number, expiryMonths: number | null, asOf: Date,
): number {
  if (!carryOverExpired(year, expiryMonths, asOf)) {
    return availableDays(accrued, carriedOver, used);
  }
  return round2(accrued - accrualUsed(carriedOver, used));
}

/** Carried days lost to expiry at `asOf` — 0 before the lapse date. */
export function expiredCarryOverDays(
  carriedOver: number, used: number,
  year: number, expiryMonths: number | null, asOf: Date,
): number {
  if (!carryOverExpired(year, expiryMonths, asOf)) return 0;
  return carriedRemaining(carriedOver, used);
}

/**
 * Days that roll from one year into the next, given what's left at year end.
 *
 *   carryOverMax null -> unlimited
 *   carryOverMax 0    -> nothing carries
 *
 * Never negative: an over-drawn balance carries 0, not a debt.
 */
export function carryOverForNextYear(remaining: number, carryOverMax: number | null): number {
  const r = Math.max(0, remaining);
  if (carryOverMax == null) return round2(r);
  return round2(Math.min(r, Math.max(0, carryOverMax)));
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
