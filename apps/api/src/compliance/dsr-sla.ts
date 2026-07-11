/**
 * Pure data-subject-request SLA math. Kenya DPA General Regulations 2021 give a
 * ~30-day response window; dueDate is a calendar deadline and a request is
 * overdue once that day has fully passed without resolution.
 */
export const DSR_SLA_DAYS = 30;

/** Calendar due date = submitted date + slaDays (date-only, UTC). */
export function computeDueDate(submittedAt: Date, slaDays: number = DSR_SLA_DAYS): Date {
  const d = new Date(Date.UTC(submittedAt.getUTCFullYear(), submittedAt.getUTCMonth(), submittedAt.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + slaDays);
  return d;
}

/** Overdue once the due day is fully in the past and the request is unresolved. */
export function isOverdue(dueDate: Date, resolvedAt: Date | null, now: Date): boolean {
  if (resolvedAt) return false;
  const endOfDue = new Date(dueDate);
  endOfDue.setUTCHours(23, 59, 59, 999);
  return now.getTime() > endOfDue.getTime();
}

/** Whole calendar days from now until due (negative if past). */
export function daysUntilDue(dueDate: Date, now: Date): number {
  const a = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}
