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
