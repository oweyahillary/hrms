/**
 * Calendar dates (@db.Date columns: hireDate, exitDate, leave start/end, etc.)
 * come back at UTC midnight. Formatting in UTC keeps the date from shifting a
 * day for anyone west of Greenwich — do not swap this for local-time
 * formatting without checking every caller is still a calendar date, not a
 * real timestamp (those format separately, in local time, on their own page).
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
