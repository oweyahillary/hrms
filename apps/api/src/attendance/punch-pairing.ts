/**
 * Pure grouping of raw device punches into one clock-in/clock-out pair per
 * employee/day. No DB access on purpose — T3's live device link reuses this
 * verbatim, and it needs to work identically whether the punches came from
 * a CSV export or a real-time push.
 */
export interface Punch {
  employeeNumber: string;
  timestamp: Date;
}

export interface PairedDay {
  employeeNumber: string;
  /** YYYY-MM-DD — the day this pair is attributed to, per `dateFor`. */
  date: string;
  clockIn: Date;
  /** null when only one punch was seen for the day (e.g. forgot to clock out). */
  clockOut: Date | null;
}

/**
 * `dateFor` resolves which calendar day a punch belongs to. Passed in
 * rather than computed here because that resolution needs a shift
 * assignment lookup (DB access) when the employee's shift that day crosses
 * midnight — a punch just after midnight still belongs to the PREVIOUS
 * day's (night) shift. Callers without shift context can pass a trivial
 * dateFor that just takes the punch's own UTC calendar date.
 *
 * First punch of the (employee, day) group becomes clockIn, last becomes
 * clockOut (null if there's only one), sorted by time first so out-of-order
 * device exports don't produce a backwards pair.
 */
export function pairPunches(
  punches: Punch[],
  dateFor: (employeeNumber: string, timestamp: Date) => string,
): PairedDay[] {
  const groups = new Map<string, Punch[]>();
  for (const p of punches) {
    const date = dateFor(p.employeeNumber, p.timestamp);
    const key = `${p.employeeNumber}::${date}`;
    const arr = groups.get(key);
    if (arr) arr.push(p); else groups.set(key, [p]);
  }

  const result: PairedDay[] = [];
  for (const [key, arr] of groups) {
    const sep = key.lastIndexOf('::');
    const employeeNumber = key.slice(0, sep);
    const date = key.slice(sep + 2);
    const sorted = [...arr].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    result.push({
      employeeNumber,
      date,
      clockIn: sorted[0].timestamp,
      clockOut: sorted.length > 1 ? sorted[sorted.length - 1].timestamp : null,
    });
  }
  return result;
}
