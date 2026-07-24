import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { getRequestContext } from '../common/context/request-context';
import { AttendanceService } from '../attendance/attendance.service';
import type { Punch } from '../attendance/punch-pairing';
import { pairPunches } from '../attendance/punch-pairing';
import { parseAttlog } from './attlog-parser';
import { DeviceRateLimiter } from './device-rate-limiter';
import type { CreateDeviceDto } from './dto/create-device.dto';
import type { UpdateDeviceDto } from './dto/update-device.dto';
import type { ResolveUnmatchedDto } from './dto/resolve-unmatched.dto';

interface DeviceRow {
  id: string; organizationId: string; serialNumber: string; name: string;
  active: boolean; lastSeenAt: Date | null; registeredAt: Date;
}
interface PunchRow {
  id: string; organizationId: string; deviceId: string; devicePin: string;
  employeeId: string | null; punchedAt: Date; receivedAt: Date; raw: string | null;
}

/** ADMS handshake allowance: config polls are frequent but low-cost. ATTLOG pushes are the expensive path but still infrequent per-device. One shared budget per SN keeps this simple. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_HITS = 120;

@Injectable()
export class AttendanceDevicesService {
  private readonly limiter = new DeviceRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_HITS);

  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly attendance: AttendanceService,
  ) {}

  // ---- Admin CRUD (authenticated, tenant-scoped) ----

  /**
   * serialNumber is unique GLOBALLY, not per org (see the schema comment on
   * AttendanceDevice) — a plain tenant-scoped findFirst pre-check would only
   * ever see the caller's OWN org's rows and miss a clash registered by a
   * different org, letting create() hit the DB's unique constraint directly
   * (an unmapped 500, not a clean 409). Catching P2002 here is the only
   * check that's actually correct regardless of which org holds the SN.
   */
  async create(dto: CreateDeviceDto) {
    try {
      const row = (await this.prisma.attendanceDevice.create({
        data: { serialNumber: dto.serialNumber, name: dto.name } as never,
      })) as unknown as DeviceRow;
      return this.present(row);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException(`A device with serial number "${dto.serialNumber}" is already registered.`);
      }
      throw err;
    }
  }

  async list() {
    const rows = (await this.prisma.attendanceDevice.findMany({
      orderBy: { registeredAt: 'asc' },
    })) as unknown as DeviceRow[];
    return rows.map((r) => this.present(r));
  }

  async update(id: string, dto: UpdateDeviceDto) {
    await this.mustOwn(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.active !== undefined) data.active = dto.active;
    const updated = (await this.prisma.attendanceDevice.update({ where: { id }, data: data as never })) as unknown as DeviceRow;
    return this.present(updated);
  }

  /** Blocked while any punch references this device — a device is an audit source, its punches must never dangle or be silently cascaded away. Deactivate (PATCH active:false) to stop it from ingesting without losing history. */
  async remove(id: string) {
    await this.mustOwn(id);
    const punchCount = await this.prisma.attendancePunch.count({ where: { deviceId: id } as never });
    if (punchCount > 0) {
      throw new ConflictException(
        `${punchCount} punch(es) reference this device — deactivate it (PATCH active:false) instead of deleting.`,
      );
    }
    await this.prisma.attendanceDevice.delete({ where: { id } });
    return { success: true };
  }

  /** Punches with no employeeId match, grouped by devicePin — an unrecognized PIN, not a parse failure, so it's a resolvable admin action rather than a dropped row. */
  async listUnmatched() {
    const rows = (await this.prisma.attendancePunch.findMany({
      where: { employeeId: null } as never,
      orderBy: { punchedAt: 'asc' },
      include: { device: true } as never,
    })) as unknown as Array<PunchRow & { device: DeviceRow }>;

    const byPin = new Map<string, { devicePin: string; deviceId: string; deviceName: string; count: number; firstPunchedAt: Date; lastPunchedAt: Date }>();
    for (const r of rows) {
      const key = `${r.deviceId}::${r.devicePin}`;
      const existing = byPin.get(key);
      if (existing) {
        existing.count += 1;
        if (r.punchedAt < existing.firstPunchedAt) existing.firstPunchedAt = r.punchedAt;
        if (r.punchedAt > existing.lastPunchedAt) existing.lastPunchedAt = r.punchedAt;
      } else {
        byPin.set(key, {
          devicePin: r.devicePin, deviceId: r.deviceId, deviceName: r.device.name,
          count: 1, firstPunchedAt: r.punchedAt, lastPunchedAt: r.punchedAt,
        });
      }
    }
    return [...byPin.values()];
  }

  /** Backfills employeeId onto every unmatched punch for this devicePin (across all devices — the same person's PIN is assumed stable org-wide), then re-materializes affected days into AttendanceRecords. */
  async resolveUnmatched(dto: ResolveUnmatchedDto) {
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const updateResult = await this.prisma.attendancePunch.updateMany({
      where: { devicePin: dto.devicePin, employeeId: null } as never,
      data: { employeeId: dto.employeeId } as never,
    });
    if (updateResult.count === 0) return { resolved: 0 };

    const punches = (await this.prisma.attendancePunch.findMany({
      where: { devicePin: dto.devicePin, employeeId: dto.employeeId } as never,
    })) as unknown as PunchRow[];
    await this.materialize(dto.employeeId, employee.employeeNumber, punches);
    return { resolved: updateResult.count };
  }

  // ---- Device-facing ingestion (unauthenticated, gated by active SN) ----

  /** Looks up an active device by SN with no org context required — this IS the auth boundary for /iclock/*. Returns null for unknown or inactive SN; the controller turns that into the protocol's rejection response. Also enforces the per-SN rate limit here so every device-facing entry point shares one gate. */
  async resolveActiveDevice(serialNumber: string): Promise<DeviceRow | null> {
    if (!this.limiter.allow(serialNumber)) return null;
    const device = (await this.prisma.attendanceDevice.findFirst({
      where: { serialNumber, active: true } as never,
    })) as unknown as DeviceRow | null;
    if (!device) return null;

    await this.prisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });

    // Mutate the SAME context object the request-context middleware already
    // established (mirrors JwtAuthGuard.handleRequest's exact pattern) so
    // the tenant-scoping extension auto-scopes everything from here on —
    // no need for baseClientOf() in this runtime path.
    getRequestContext().organizationId = device.organizationId;
    return device;
  }

  /** Parses + stores an ATTLOG push, then materializes into AttendanceRecords via the T2 pairing/derivation path, reused verbatim. Duplicate pushes (deviceId+devicePin+punchedAt already stored) are a no-op via skipDuplicates — the device retries on any non-200, so idempotency here is load-bearing, not defensive. */
  async ingestAttlog(device: DeviceRow, body: string): Promise<number> {
    const lines = parseAttlog(body);
    if (lines.length === 0) return 0;

    await this.prisma.attendancePunch.createMany({
      data: lines.map((l) => ({
        deviceId: device.id, devicePin: l.pin, punchedAt: l.punchedAt, raw: l.raw,
      })) as never,
      skipDuplicates: true,
    });

    const pins = [...new Set(lines.map((l) => l.pin))];
    const employees = (await this.prisma.employee.findMany({
      where: { employeeNumber: { in: pins } }, select: { id: true, employeeNumber: true },
    })) as unknown as Array<{ id: string; employeeNumber: string }>;
    const employeeIdByPin = new Map(employees.map((e) => [e.employeeNumber, e.id]));

    // Backfill employeeId on newly-stored rows still pending a match — a P2002
    // no-op above just means "already stored", the pin may still be unmatched.
    for (const pin of pins) {
      const employeeId = employeeIdByPin.get(pin);
      if (!employeeId) continue;
      await this.prisma.attendancePunch.updateMany({
        where: { deviceId: device.id, devicePin: pin, employeeId: null } as never,
        data: { employeeId } as never,
      });
    }

    for (const [employeeNumber, employeeId] of employeeIdByPin) {
      const punches = (await this.prisma.attendancePunch.findMany({
        where: { deviceId: device.id, devicePin: employeeNumber, employeeId } as never,
      })) as unknown as PunchRow[];
      await this.materialize(employeeId, employeeNumber, punches);
    }

    return lines.length;
  }

  /** Shared by resolveUnmatched (backfill) and ingestAttlog (live push) — pairs this employee's punches into days (night-shift-aware, via T2's buildNightShiftAwareDateFor) and writes/updates AttendanceRecords via T2's materializeFromPunches. */
  private async materialize(employeeId: string, employeeNumber: string, punchRows: PunchRow[]): Promise<void> {
    if (punchRows.length === 0) return;
    const punches: Punch[] = punchRows.map((p) => ({ employeeNumber, timestamp: p.punchedAt }));
    const dateFor = await this.attendance.buildNightShiftAwareDateFor(punches);
    const paired = pairPunches(punches, dateFor);
    for (const day of paired) {
      await this.attendance.materializeFromPunches(employeeId, day.date, day.clockIn, day.clockOut);
    }
  }

  private async mustOwn(id: string): Promise<DeviceRow> {
    const row = (await this.prisma.attendanceDevice.findFirst({ where: { id } as never })) as unknown as DeviceRow | null;
    if (!row) throw new NotFoundException('Device not found');
    return row;
  }

  private present(r: DeviceRow) {
    return {
      id: r.id, serialNumber: r.serialNumber, name: r.name, active: r.active,
      lastSeenAt: r.lastSeenAt, registeredAt: r.registeredAt,
    };
  }
}
