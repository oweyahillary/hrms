/**
 * Seed the first Organization + Admin role + Admin user so you can log in.
 * Single-tenant deployments are admin-provisioned — there is no public signup.
 *
 *   cd apps/api
 *   npx ts-node scripts/seed.ts
 *
 * Override defaults via env: SEED_ORG_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.
 * Idempotent: re-running won't duplicate the org/role/user.
 */
import 'dotenv/config';
import { createPrismaClient } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { PERMISSION_KEYS } from '../src/auth/permissions';

async function main() {
  const prisma = createPrismaClient();
  const passwords = new PasswordService();

  const orgName = process.env.SEED_ORG_NAME ?? 'Demo Organization';
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  // Force rotation of the default on first login. Disable only for automated
  // tests/CI (SEED_FORCE_PASSWORD_CHANGE=false) so gates can log in unblocked.
  const forceChange = (process.env.SEED_FORCE_PASSWORD_CHANGE ?? 'true') !== 'false';

  // No request context here => runs unscoped (bootstrapping the first tenant),
  // so organizationId is passed explicitly rather than injected.
  let org = await prisma.organization.findFirst({ where: { name: orgName } });
  org ??= await prisma.organization.create({ data: { name: orgName } });

  let role = await prisma.role.findFirst({ where: { organizationId: org.id, name: 'Admin' } });
  role ??= await prisma.role.create({
    // Every permission at scope ALL, explicitly — see auth/permissions.ts.
    // Not `{ all: true }` or a bare string[]: those legacy shapes are still
    // HONOURED by resolveRolePermissions() for rows written before this
    // migration / before scope existed, but new rows get the real,
    // editable {key,scope}[] shape so the Settings > Roles page renders
    // every checkbox checked (not a black box) with the right scope picker state.
    data: { organizationId: org.id, name: 'Admin', permissions: PERMISSION_KEYS.map((key) => ({ key, scope: 'ALL' })) },
  });

  const existing = await prisma.user.findFirst({ where: { organizationId: org.id, email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        organizationId: org.id,
        email,
        passwordHash: await passwords.hash(password),
        mustChangePassword: forceChange, // force rotation of the seeded default on first login
        roleId: role.id,
      },
    });
  }

  // Default Kenyan shift patterns — data, not code (same philosophy as
  // StatutoryRate), so every org starts with something usable and can edit
  // freely from there. Idempotent per (organizationId, code), like the rest
  // of this script.
  const DEFAULT_SHIFTS = [
    { code: 'G', name: 'General', startTime: '08:00', endTime: '17:00', crossesMidnight: false, isNightShift: false, breakMinutes: 60 },
    { code: 'M', name: 'Morning', startTime: '06:00', endTime: '14:00', crossesMidnight: false, isNightShift: false, breakMinutes: 30 },
    { code: 'A', name: 'Afternoon', startTime: '14:00', endTime: '22:00', crossesMidnight: false, isNightShift: false, breakMinutes: 30 },
    { code: 'N', name: 'Night', startTime: '22:00', endTime: '06:00', crossesMidnight: true, isNightShift: true, breakMinutes: 30 },
  ];
  for (const shift of DEFAULT_SHIFTS) {
    const existingShift = await prisma.shiftDefinition.findFirst({ where: { organizationId: org.id, code: shift.code } });
    if (!existingShift) {
      await prisma.shiftDefinition.create({ data: { organizationId: org.id, ...shift } });
    }
  }

  // A default overtime policy so derive()/payroll never fall back to
  // hardcoded constants for a real org — same "data, not code" philosophy as
  // the shifts above. effectiveFrom far enough in the past to always be in
  // force; HR edits it (or adds a future-dated version) from Settings.
  // normalDayMultiplier/restDayMultiplier/holidayMultiplier, hourlyRateBasis
  // and normalWeeklyHours are NOT settled figures for any specific client —
  // see docs/overtime.md — these are reasonable starting defaults, not a
  // confirmed value.
  const existingOvertimePolicy = await prisma.overtimePolicy.findFirst({ where: { organizationId: org.id } });
  if (!existingOvertimePolicy) {
    await prisma.overtimePolicy.create({
      data: {
        organizationId: org.id, effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        normalDayMultiplier: 1.5, restDayMultiplier: 2, holidayMultiplier: 2,
        hourlyRateBasis: 'MONTHLY_X12_DIV_52_WEEKLY_HOURS', normalWeeklyHours: 45,
        minimumMinutesToCount: 30, maxHoursPerDay: null, requiresApproval: true,
      },
    });
  }

  console.log('\n--- Seed complete ---');
  console.log('Organization ID :', org.id);
  console.log('Admin email     :', email);
  console.log('Admin password  :', existing ? '(unchanged — user already existed)' : password);
  console.log('\nNext: set DEV_ORG_ID in apps/api/.env to the Organization ID above');
  console.log('so local requests are tenant-scoped until auth login is wired (Step 2).');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
