// A separate, wider palette from the app's semantic brand/amber/red/sand
// status colors on purpose — shift codes are categorical, not a status, and
// the org can define more than four of them. Mantine ships shade ramps for
// every one of these even though only brand/sand/amber are re-themed.
const PALETTE = ['brand', 'blue', 'violet', 'teal', 'orange', 'grape', 'cyan', 'pink', 'indigo', 'lime'];

/** Deterministic so the same shift code always renders the same color without the server storing one. */
export function shiftColor(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
