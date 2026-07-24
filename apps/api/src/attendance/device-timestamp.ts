/**
 * Parses a biometric-device timestamp as UTC, explicitly. A bare
 * "YYYY-MM-DD HH:MM:SS" (the common shape from both ZKTeco CSV exports and
 * live ADMS ATTLOG pushes) has no timezone of its own — left to
 * `new Date(...)`, a non-ISO string like this is parsed in the LOCAL
 * TIMEZONE OF WHATEVER MACHINE RUNS THE CODE, not UTC. That's a real bug
 * caught in this repo's own verification (a sandbox running UTC+3 imported
 * every punch three hours off). Matching this codebase's UTC-everywhere
 * convention here, not the host machine's clock, is the only parse that
 * behaves the same in dev, CI and production regardless of server timezone.
 * Shared by the CSV/ZK import path (attendance-import-presets.ts) and the
 * live device-push path (attendance-devices/attlog-parser.ts) — one fix,
 * not two copies that could drift.
 */
export function parseDeviceTimestamp(raw: string): Date {
  const spaceForm = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(raw);
  if (spaceForm) return new Date(`${spaceForm[1]}T${spaceForm[2]}.000Z`);
  return new Date(raw); // already has an explicit offset/Z, or is some other format — let it parse (or fail) as-is
}
