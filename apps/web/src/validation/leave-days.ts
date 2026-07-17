/**
 * Client mirror of countWorkingDays / toISODate from
 * apps/api/src/leave/leave-math.ts.
 *
 * Purpose is a live "X working days" preview while dates are being picked — a
 * leave request costs days, and finding that out only after submitting is a
 * poor deal. THE SERVER RECOMPUTES THIS and its number is the one that's
 * stored; if the two ever disagree, the server is right. Change one, change
 * the other.
 */

/** A calendar day as 'YYYY-MM-DD' in UTC (dates are stored as @db.Date). */
export function toISODate(d: Date): string {
  return `${d.getUTCFullYear().toString().padStart(4, '0')}-${(d.getUTCMonth() + 1)
    .toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
}

/**
 * Working days between start and end INCLUSIVE, excluding weekends (Sat/Sun)
 * and any date in `holidays` (a set of 'YYYY-MM-DD'). Returns 0 if end < start.
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

/** Parse a native date input value ('YYYY-MM-DD') as UTC midnight. */
export const parseDateInput = (v: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
