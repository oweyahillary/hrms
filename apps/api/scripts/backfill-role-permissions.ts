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
 * overwrites `permissions` to the {key,scope} set that reproduces its
 * PRE-migration access exactly (every key at scope ALL — the coarser
 * catalogues that came before this one had no scope concept). A role with a
 * name OUTSIDE that set (a genuine custom role, or one already migrated) is
 * left untouched — this never clobbers a hand-picked permission list.
 *
 * Re-running after a LATER catalogue split (like this one, which broke
 * leave.manage into leave.view/approve/manage etc.) is exactly what keeps a
 * pre-existing "HR Manager" row's access identical across the split — safe
 * and expected to run again each time the catalogue grows.
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
