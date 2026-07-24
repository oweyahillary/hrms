/**
 * One-time (but idempotent — safe to re-run) data fix for the permissions
 * migration: before this change, Role.permissions was written but never
 * read, so every non-Admin role name granted via POST /employees/:id/create-
 * login (HR Manager, HR Officer, Manager, Employee) was lazily created with
 * EMPTY permissions ({}), and Admin rows from before this migration used the
 * legacy `{ all: true }` shape. Now that authorization actually reads this
 * column, an org with an already-provisioned "HR Manager" login would
 * silently lose all their access the moment this ships — unless this script
 * (or the equivalent normalization already applied by seed.ts for freshly
 * seeded orgs) backfills it first.
 *
 * For every Role in every org whose NAME matches one of the historically-
 * known names (see auth/permissions.ts's ROLE_PERMISSION_DEFAULTS), this
 * overwrites `permissions` to that name's current default. A role with a
 * name OUTSIDE that set (a genuine custom role, or one already migrated) is
 * left untouched — this never clobbers a hand-picked permission list.
 *
 * Re-running after a LATER catalogue split (like the one that broke
 * leave.manage into leave.view/approve/manage) is exactly what keeps a
 * pre-existing "HR Manager" row's access identical across the split — safe
 * and expected to run again each time the catalogue grows.
 *
 * ONE NAME IS NOT "identical to before" — read this before re-running on a
 * production-like org: as of 2026-07-25, 'Manager' defaults to
 * DEPARTMENT_SUPERVISOR_SET (OWN_DEPARTMENT leave/overtime/attendance/
 * employees access), not the empty set it used to be. Re-running this
 * script GRANTS that access to every existing "Manager" Role row across
 * every org, where before it granted nothing — see the doc comment on
 * ROLE_PERMISSION_DEFAULTS.Manager in auth/permissions.ts for why (a
 * Manager named as a department's LeaveApprovalStep approver was silently
 * unable to approve once leave.approve became a hard requirement). If an
 * org has already hand-edited its "Manager" role's permissions since this
 * shipped, re-running this script will OVERWRITE that customization back to
 * the new default — same caveat as any other name in this list, just newly
 * relevant here because the default itself changed from empty to something.
 *
 *   cd apps/api && npx ts-node scripts/backfill-role-permissions.ts
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { ROLE_PERMISSION_DEFAULTS } from '../src/auth/permissions';

async function main(): Promise<void> {
  const base = baseClientOf(createPrismaClient()) as any;
  const roles = (await base.role.findMany({
    where: { name: { in: Object.keys(ROLE_PERMISSION_DEFAULTS) } },
  })) as Array<{ id: string; organizationId: string; name: string }>;

  let updated = 0;
  for (const role of roles) {
    const permissions = [...(ROLE_PERMISSION_DEFAULTS[role.name] ?? [])];
    // eslint-disable-next-line no-await-in-loop
    await base.role.update({ where: { id: role.id }, data: { permissions } });
    updated += 1;
    const summary = permissions.map((p) => `${p.key}:${p.scope}`).join(', ') || '(none)';
    console.log(`  ${role.name} (org ${role.organizationId}) -> [${summary}]`);
  }

  console.log(`\nBackfilled ${updated} role(s) across every organisation.`);
  await base.$disconnect?.();
}
main().catch((e) => { console.error('backfill error:', (e as Error).message); process.exit(1); });
