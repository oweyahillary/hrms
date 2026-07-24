/**
 * Prove the ZKTeco ADMS/iClock device-push path end-to-end: the device
 * registry IS the security gate (unknown/inactive SN -> 410, nothing
 * stored), ATTLOG ingestion + dedupe, materialization into AttendanceRecord
 * via T2's pure punch-pairing/derive-status (including the night-shift
 * midnight-crossing case), MANUAL-status protection, unmatched-pin listing
 * + resolve, device CRUD (delete-blocked-while-referenced), the per-SN rate
 * limiter, and cross-tenant isolation (including that a serial number is a
 * GLOBAL registry key, not reusable across orgs).
 *
 *   cd apps/api && npx ts-node scripts/verify-device-push.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * /iclock/* is NOT under /api (see main.ts) — its own base is derived below.
 * Mirrors verify-attendance-ui.ts's throwaway-second-org pattern for
 * tenant isolation; full cleanup otherwise.
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const ICLOCK_BASE = BASE.replace(/\/api\/?$/, '');
// Far-future dates unused by any other verify-*.ts fixture.
const DATE_MATCHED = '2099-05-01';
const DATE_NIGHT = '2099-05-02'; // crosses into 2099-05-03
const DATE_MANUAL = '2099-05-04';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface Device { id: string; serialNumber: string; name: string; active: boolean; lastSeenAt: string | null }
interface UnmatchedGroup { devicePin: string; deviceId: string; deviceName: string; count: number; firstPunchedAt: string; lastPunchedAt: string }
interface AttendanceRow {
  id: string; employeeId: string; date: string; clockIn: string | null; clockOut: string | null;
  status: string; source: string;
}

function attlogLine(pin: string, dateTimeSpace: string): string {
  return `${pin}\t${dateTimeSpace}\t0\t1\t0\t0`;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  let nid = 0;
  const nationalId = (): string => `${String(stamp).slice(-7)}${nid++}`;

  async function login(email: string, password: string): Promise<string> {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const token = ((await r.json()) as { accessToken?: string }).accessToken;
    if (!token) { console.log(`  FAIL  login as ${email}`); process.exit(1); }
    return token;
  }

  const adminToken = await login('admin@example.com', 'ChangeMe123!');
  const adminJson = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  async function makeEmployee(tag: string): Promise<{ id: string; employeeNumber: string }> {
    const employeeNumber = `DEVPUSH-${tag}-${stamp}`;
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({
        employeeNumber, firstName: 'DevicePushVerify', lastName: tag,
        nationalId: nationalId(), employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const id = ((await r.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    return { id, employeeNumber };
  }

  const empA = await makeEmployee('A');
  const empC = await makeEmployee('C'); // resolved onto the unmatched pin later

  // ── (a) unknown SN is rejected everywhere, nothing stored ──
  const unknownSn = `UNKNOWN-${stamp}`;
  const hsUnknown = await fetch(`${ICLOCK_BASE}/iclock/cdata?SN=${unknownSn}`);
  check('handshake for an unknown SN returns 410', hsUnknown.status === 410, String(hsUnknown.status));

  const pushUnknown = await fetch(`${ICLOCK_BASE}/iclock/cdata?SN=${unknownSn}&table=ATTLOG`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: attlogLine('9999', `${DATE_MATCHED} 08:00:00`),
  });
  check('ATTLOG push for an unknown SN returns 410', pushUnknown.status === 410, String(pushUnknown.status));

  const reqUnknown = await fetch(`${ICLOCK_BASE}/iclock/getrequest?SN=${unknownSn}`);
  check('getrequest for an unknown SN returns 410', reqUnknown.status === 410, String(reqUnknown.status));

  // ── (b) register a device, handshake succeeds and updates lastSeenAt ──
  const sn1 = `DEV1-${stamp}`;
  const dev1Res = await fetch(`${BASE}/attendance-devices`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ serialNumber: sn1, name: 'Verify Device 1' }),
  });
  const dev1 = (await dev1Res.json()) as Device;
  check('device registration succeeds', dev1Res.status === 201 || !!dev1.id, JSON.stringify(dev1));
  check('a freshly-registered device has no lastSeenAt yet', dev1.lastSeenAt === null, JSON.stringify(dev1));

  const hs1 = await fetch(`${ICLOCK_BASE}/iclock/cdata?SN=${sn1}`);
  const hs1Body = await hs1.text();
  check('handshake for a registered active SN returns 200', hs1.status === 200, String(hs1.status));
  check('handshake body echoes the device SN', hs1Body.includes(sn1), hs1Body);

  const dev1AfterHs = ((await (await fetch(`${BASE}/attendance-devices`, { headers: adminAuth })).json()) as Device[])
    .find((d) => d.serialNumber === sn1);
  check('handshake updates lastSeenAt', !!dev1AfterHs?.lastSeenAt, JSON.stringify(dev1AfterHs));

  const req1 = await fetch(`${ICLOCK_BASE}/iclock/getrequest?SN=${sn1}`);
  const req1Body = await req1.text();
  check('getrequest for a registered device returns 200 "OK" (no pending commands)', req1.status === 200 && req1Body === 'OK', `${req1.status} ${req1Body}`);

  // ── (c) ATTLOG push: one matched pin (empA), one unmatched pin ──
  const unmatchedPin = `UNMATCHED-${stamp}`;
  const push1 = await fetch(`${ICLOCK_BASE}/iclock/cdata?SN=${sn1}&table=ATTLOG`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: [
      attlogLine(empA.employeeNumber, `${DATE_MATCHED} 08:02:00`),
      attlogLine(empA.employeeNumber, `${DATE_MATCHED} 17:05:00`),
      attlogLine(unmatchedPin, `${DATE_MATCHED} 09:00:00`),
      attlogLine(unmatchedPin, `${DATE_MATCHED} 12:00:00`),
    ].join('\n'),
  });
  const push1Body = await push1.text();
  check('ATTLOG push accepts and acknowledges the line count', push1.status === 200 && push1Body === 'OK: 4', `${push1.status} ${push1Body}`);

  const empAAfterPush = (await (await fetch(`${BASE}/attendance?employeeId=${empA.id}&from=${DATE_MATCHED}&to=${DATE_MATCHED}`, { headers: adminAuth })).json()) as AttendanceRow[];
  check('matched pin materializes into exactly one AttendanceRecord', empAAfterPush.length === 1, JSON.stringify(empAAfterPush));
  check('materialized record pairs first punch as clockIn, last as clockOut',
    empAAfterPush[0]?.clockIn?.startsWith(`${DATE_MATCHED}T08:02`) === true
      && empAAfterPush[0]?.clockOut?.startsWith(`${DATE_MATCHED}T17:05`) === true,
    JSON.stringify(empAAfterPush[0]));
  check('materialized record has source BIOMETRIC', empAAfterPush[0]?.source === 'BIOMETRIC', JSON.stringify(empAAfterPush[0]));

  // ── (d) duplicate push is idempotent — no duplicate punches, no duplicate records ──
  const push1Again = await fetch(`${ICLOCK_BASE}/iclock/cdata?SN=${sn1}&table=ATTLOG`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: [
      attlogLine(empA.employeeNumber, `${DATE_MATCHED} 08:02:00`),
      attlogLine(empA.employeeNumber, `${DATE_MATCHED} 17:05:00`),
    ].join('\n'),
  });
  check('re-pushing the identical ATTLOG lines is accepted (device retry-safe)', push1Again.status === 200, String(push1Again.status));
  const empAAfterDup = (await (await fetch(`${BASE}/attendance?employeeId=${empA.id}&from=${DATE_MATCHED}&to=${DATE_MATCHED}`, { headers: adminAuth })).json()) as AttendanceRow[];
  check('duplicate push did not create a second AttendanceRecord', empAAfterDup.length === 1, JSON.stringify(empAAfterDup));
  check('duplicate push did not change the paired times', empAAfterDup[0]?.id === empAAfterPush[0]?.id, JSON.stringify({ before: empAAfterPush[0], after: empAAfterDup[0] }));

  // ── (e) unmatched-punches listing groups by devicePin ──
  const unmatchedList = (await (await fetch(`${BASE}/attendance-devices/unmatched-punches`, { headers: adminAuth })).json()) as UnmatchedGroup[];
  const unmatchedGroup = unmatchedList.find((g) => g.devicePin === unmatchedPin);
  check('unmatched-punches lists the unrecognized pin', !!unmatchedGroup, JSON.stringify(unmatchedList));
  check('unmatched group counts both punches for that pin', unmatchedGroup?.count === 2, JSON.stringify(unmatchedGroup));
  check('unmatched group carries the device name', unmatchedGroup?.deviceName === 'Verify Device 1', JSON.stringify(unmatchedGroup));

  // ── (f) resolving the unmatched pin backfills + materializes ──
  const resolveRes = await fetch(`${BASE}/attendance-devices/unmatched-punches/resolve`, {
    method: 'POST', headers: adminJson, body: JSON.stringify({ devicePin: unmatchedPin, employeeId: empC.id }),
  });
  const resolveBody = (await resolveRes.json()) as { resolved: number };
  check('resolving the unmatched pin reports 2 punches backfilled', resolveBody.resolved === 2, JSON.stringify(resolveBody));

  const empCAfterResolve = (await (await fetch(`${BASE}/attendance?employeeId=${empC.id}&from=${DATE_MATCHED}&to=${DATE_MATCHED}`, { headers: adminAuth })).json()) as AttendanceRow[];
  check('resolved employee now has a materialized AttendanceRecord', empCAfterResolve.length === 1, JSON.stringify(empCAfterResolve));
  check('resolved record pairs the backfilled punches correctly',
    empCAfterResolve[0]?.clockIn?.startsWith(`${DATE_MATCHED}T09:00`) === true
      && empCAfterResolve[0]?.clockOut?.startsWith(`${DATE_MATCHED}T12:00`) === true,
    JSON.stringify(empCAfterResolve[0]));

  const unmatchedAfterResolve = (await (await fetch(`${BASE}/attendance-devices/unmatched-punches`, { headers: adminAuth })).json()) as UnmatchedGroup[];
  check('the pin no longer appears as unmatched once resolved', !unmatchedAfterResolve.some((g) => g.devicePin === unmatchedPin), JSON.stringify(unmatchedAfterResolve));

  // ── (g) night-shift midnight-crossing materialization via live push (mirrors verify-attendance-ui.ts's CSV case) ──
  const allShifts = (await (await fetch(`${BASE}/shift-definitions`, { headers: adminAuth })).json()) as Array<{ id: string; code: string; crossesMidnight: boolean }>;
  const night = allShifts.find((s) => s.code === 'N');
  check('seeded Night (N) shift exists and crosses midnight', !!night?.crossesMidnight, JSON.stringify(night));
  if (night) {
    await fetch(`${BASE}/shifts/roster`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({ employeeId: empA.id, date: DATE_NIGHT, shiftDefinitionId: night.id }),
    });
    await fetch(`${ICLOCK_BASE}/iclock/cdata?SN=${sn1}&table=ATTLOG`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: [
        attlogLine(empA.employeeNumber, `${DATE_NIGHT} 22:10:00`),
        attlogLine(empA.employeeNumber, '2099-05-03 06:15:00'), // next calendar day
      ].join('\n'),
    });
    const aNight = (await (await fetch(`${BASE}/attendance?employeeId=${empA.id}&from=${DATE_NIGHT}&to=${DATE_NIGHT}`, { headers: adminAuth })).json()) as AttendanceRow[];
    check('night-shift punches (22:10 + next-day 06:15) group into ONE record dated the shift\'s START day', aNight.length === 1, JSON.stringify(aNight));
    check('that record\'s clockOut is correctly on the FOLLOWING calendar day', aNight[0]?.clockOut?.startsWith('2099-05-03T06:15') === true, JSON.stringify(aNight[0]));
    check('the night-shift record derives PRESENT (22:10 is within grace of a 22:00 start)', aNight[0]?.status === 'PRESENT', JSON.stringify(aNight[0]));
  }

  // ── (h) an explicit MANUAL status is never overwritten by re-materialization ──
  const manualRes = await fetch(`${BASE}/attendance`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: empA.id, date: DATE_MANUAL, status: 'ON_LEAVE' }),
  });
  const manual = (await manualRes.json()) as AttendanceRow;
  check('explicit HR entry is recorded as MANUAL', manual.source === 'MANUAL' && manual.status === 'ON_LEAVE', JSON.stringify(manual));

  await fetch(`${ICLOCK_BASE}/iclock/cdata?SN=${sn1}&table=ATTLOG`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: attlogLine(empA.employeeNumber, `${DATE_MANUAL} 08:05:00`),
  });
  const afterDevicePush = (await (await fetch(`${BASE}/attendance?employeeId=${empA.id}&from=${DATE_MANUAL}&to=${DATE_MANUAL}`, { headers: adminAuth })).json()) as AttendanceRow[];
  check('a MANUAL-sourced record is untouched by a later device push for the same day',
    afterDevicePush.length === 1 && afterDevicePush[0].status === 'ON_LEAVE' && afterDevicePush[0].source === 'MANUAL' && afterDevicePush[0].clockIn === null,
    JSON.stringify(afterDevicePush));

  // ── (i) an inactive device is rejected exactly like an unknown one ──
  await fetch(`${BASE}/attendance-devices/${dev1.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ active: false }) });
  const hsInactive = await fetch(`${ICLOCK_BASE}/iclock/cdata?SN=${sn1}`);
  check('handshake for a deactivated device returns 410', hsInactive.status === 410, String(hsInactive.status));
  await fetch(`${BASE}/attendance-devices/${dev1.id}`, { method: 'PATCH', headers: adminJson, body: JSON.stringify({ active: true }) }); // reactivate for later assertions

  // ── (j) delete is blocked while punches reference the device; a punch-free device deletes cleanly ──
  const deleteBlocked = await fetch(`${BASE}/attendance-devices/${dev1.id}`, { method: 'DELETE', headers: adminAuth });
  check('deleting a device with punches on record is blocked (409)', deleteBlocked.status === 409, String(deleteBlocked.status));

  const snEmpty = `DEVEMPTY-${stamp}`;
  const devEmptyRes = await fetch(`${BASE}/attendance-devices`, { method: 'POST', headers: adminJson, body: JSON.stringify({ serialNumber: snEmpty, name: 'Empty Device' }) });
  const devEmpty = (await devEmptyRes.json()) as Device;
  const deleteEmpty = await fetch(`${BASE}/attendance-devices/${devEmpty.id}`, { method: 'DELETE', headers: adminAuth });
  check('deleting a device with zero punches succeeds', deleteEmpty.status === 200, String(deleteEmpty.status));
  const devicesAfterDelete = (await (await fetch(`${BASE}/attendance-devices`, { headers: adminAuth })).json()) as Device[];
  check('the deleted device no longer appears in the list', !devicesAfterDelete.some((d) => d.id === devEmpty.id), JSON.stringify(devicesAfterDelete.map((d) => d.serialNumber)));

  // ── (k) duplicate serial number is rejected — the registry is the security boundary, so it must be globally unique ──
  const dupSnRes = await fetch(`${BASE}/attendance-devices`, { method: 'POST', headers: adminJson, body: JSON.stringify({ serialNumber: sn1, name: 'Duplicate attempt' }) });
  check('registering an already-used serial number is rejected (409)', dupSnRes.status === 409, String(dupSnRes.status));

  // ── (l) per-SN rate limiting eventually kicks in ──
  const snRl = `DEVRL-${stamp}`;
  await fetch(`${BASE}/attendance-devices`, { method: 'POST', headers: adminJson, body: JSON.stringify({ serialNumber: snRl, name: 'Rate-limit probe' }) });
  let firstStatus = -1;
  let sawRateLimited = false;
  for (let i = 0; i < 130; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await fetch(`${ICLOCK_BASE}/iclock/getrequest?SN=${snRl}`);
    if (i === 0) firstStatus = r.status;
    if (r.status === 410) { sawRateLimited = true; break; }
  }
  check('the first request against a fresh SN is accepted', firstStatus === 200, String(firstStatus));
  check('flooding one SN eventually trips the per-SN rate limit (410)', sawRateLimited, 'never saw a 410 within 130 requests');

  // ── (m) cross-tenant isolation (throwaway org Z), incl. the SN registry being global ──
  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  const orgZ = await base.organization.create({ data: { name: `__device_push_probe_${stamp}__` } });
  const roleZ = await base.role.create({ data: { organizationId: orgZ.id, name: 'Admin', permissions: { all: true } } });
  const passwords = new PasswordService();
  const orgZAdminEmail = `devpush.z.admin.${stamp}@example.com`;
  const orgZAdminPassword = 'OrgZAdmin123!';
  const orgZAdminUser = await base.user.create({
    data: {
      organizationId: orgZ.id, email: orgZAdminEmail,
      passwordHash: await passwords.hash(orgZAdminPassword),
      mustChangePassword: false, roleId: roleZ.id,
    },
  });

  try {
    const tokenZAdmin = await login(orgZAdminEmail, orgZAdminPassword);
    const zAdminJson = { Authorization: `Bearer ${tokenZAdmin}`, 'Content-Type': 'application/json' };
    const zAdminAuth = { Authorization: `Bearer ${tokenZAdmin}` };

    // org Z cannot steal org A's serial number either — the registry is global, not per-org.
    const zStealSn = await fetch(`${BASE}/attendance-devices`, { method: 'POST', headers: zAdminJson, body: JSON.stringify({ serialNumber: sn1, name: 'Steal attempt' }) });
    check('org Z registering org A\'s already-used SN is also rejected (409, global registry)', zStealSn.status === 409, String(zStealSn.status));

    const snZ = `DEVZ-${stamp}`;
    await fetch(`${BASE}/attendance-devices`, { method: 'POST', headers: zAdminJson, body: JSON.stringify({ serialNumber: snZ, name: 'Org Z device' }) });

    const orgADevices = (await (await fetch(`${BASE}/attendance-devices`, { headers: adminAuth })).json()) as Device[];
    check('org A\'s device list does not include org Z\'s device', !orgADevices.some((d) => d.serialNumber === snZ), JSON.stringify(orgADevices.map((d) => d.serialNumber)));

    const orgZDevices = (await (await fetch(`${BASE}/attendance-devices`, { headers: zAdminAuth })).json()) as Device[];
    check('org Z\'s device list does not include org A\'s device', !orgZDevices.some((d) => d.serialNumber === sn1), JSON.stringify(orgZDevices.map((d) => d.serialNumber)));

    const orgZUnmatched = (await (await fetch(`${BASE}/attendance-devices/unmatched-punches`, { headers: zAdminAuth })).json()) as UnmatchedGroup[];
    check('org Z sees no unmatched punches belonging to org A', orgZUnmatched.length === 0, JSON.stringify(orgZUnmatched));
  } finally {
    await base.attendancePunch.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.attendanceDevice.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.session.deleteMany({ where: { userId: orgZAdminUser.id } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgZ.id } }).catch(() => undefined);

    // Org A cleanup (fully removable — nothing here sits behind an
    // append-only trigger the way Organization/audit_logs do).
    await base.attendancePunch.deleteMany({ where: { deviceId: { in: [dev1.id] } } }).catch(() => undefined);
    await base.attendanceDevice.deleteMany({ where: { serialNumber: { in: [sn1, snRl] } } }).catch(() => undefined);
    await base.attendanceRecord.deleteMany({ where: { employeeId: { in: [empA.id, empC.id] } } }).catch(() => undefined);
    await base.shiftAssignment.deleteMany({ where: { employeeId: { in: [empA.id, empC.id] } } }).catch(() => undefined);
    await base.employee.deleteMany({ where: { id: { in: [empA.id, empC.id] } } }).catch(() => undefined);
    await (prisma as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
