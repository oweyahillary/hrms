/**
 * Pure parsing of an ADMS ATTLOG push body: tab-separated lines, one punch
 * per line — PIN, DateTime ("YYYY-MM-DD HH:MM:SS"), then device-specific
 * status/verify-mode/work-code columns this phase doesn't use. Tolerant by
 * design (per the brief: "never 500 at the device") — a malformed line is
 * silently skipped, never thrown; a completely garbage body just yields an
 * empty array rather than an error.
 */
import { parseDeviceTimestamp } from '../attendance/device-timestamp';

export interface ParsedPunchLine {
  pin: string;
  punchedAt: Date;
  raw: string;
}

export function parseAttlog(body: string): ParsedPunchLine[] {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const parsed: ParsedPunchLine[] = [];
  for (const line of lines) {
    const cols = line.split('\t');
    const pin = (cols[0] ?? '').trim();
    const timeStr = (cols[1] ?? '').trim();
    if (!pin || !timeStr) continue;
    const punchedAt = parseDeviceTimestamp(timeStr);
    if (Number.isNaN(punchedAt.getTime())) continue;
    parsed.push({ pin, punchedAt, raw: line.slice(0, 500) });
  }
  return parsed;
}
