/**
 * Pure breach-notification clock. Kenya DPA s.43: notify the ODPC without undue
 * delay and no later than 72 hours after becoming aware. High-risk breaches must
 * also be communicated to affected data subjects without undue delay.
 */
export const ODPC_DEADLINE_HOURS = 72;

/** ODPC notification deadline = detectedAt + 72h. */
export function odpcDeadline(detectedAt: Date): Date {
  return new Date(detectedAt.getTime() + ODPC_DEADLINE_HOURS * 3_600_000);
}

export type OdpcStatus = 'NOTIFIED_ON_TIME' | 'NOTIFIED_LATE' | 'WITHIN_WINDOW' | 'OVERDUE';

/** Where this breach stands against the 72h ODPC clock. */
export function odpcNotificationStatus(detectedAt: Date, odpcNotifiedAt: Date | null, now: Date): OdpcStatus {
  const deadline = odpcDeadline(detectedAt);
  if (odpcNotifiedAt) {
    return odpcNotifiedAt.getTime() <= deadline.getTime() ? 'NOTIFIED_ON_TIME' : 'NOTIFIED_LATE';
  }
  return now.getTime() <= deadline.getTime() ? 'WITHIN_WINDOW' : 'OVERDUE';
}

/** Whole hours left until the ODPC deadline (negative once past). */
export function hoursUntilOdpcDeadline(detectedAt: Date, now: Date): number {
  return Math.round((odpcDeadline(detectedAt).getTime() - now.getTime()) / 3_600_000);
}
