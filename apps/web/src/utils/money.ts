import type { CSSProperties } from 'react';

/**
 * The one shared KES formatter — every money figure in the app renders
 * through this. Previously duplicated per-page with real drift: some
 * variants omitted the "KES" prefix (callers wrote it inline), one rounded
 * to whole shillings while everyone else kept 2 decimal places.
 */
export function kes(amount: number): string {
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Style for a money figure in a table cell: non-jittering digit widths. */
export const tabularNums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
