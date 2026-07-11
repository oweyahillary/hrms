/**
 * Remove stray/test organizations — those with NO users, roles, employees, or
 * payroll runs (so real tenants, including a freshly-provisioned one with just an
 * admin user, are never touched). Their audit rows are protected by the append-
 * only trigger, so each delete briefly disables ONLY that trigger inside a
 * transaction, then re-enables it.
 *
 *   cd apps/api
 *   npx ts-node scripts/purge-stray-orgs.ts            # dry run: shows what it would delete
 *   npx ts-node scripts/purge-stray-orgs.ts --confirm  # actually delete
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { Client } from 'pg';

const REAL_SIGNALS = ['user', 'role', 'employee', 'payrollRun'] as const;

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const base = baseClientOf(createPrismaClient()) as any;

  const orgs = await base.organization.findMany({});
  const strays: Array<{ id: string; name: string }> = [];
  for (const o of orgs) {
    let real = 0;
    for (const m of REAL_SIGNALS) real += await base[m].count({ where: { organizationId: o.id } });
    if (real === 0) strays.push({ id: o.id, name: o.name });
    else console.log(`  keep    ${o.id}  "${o.name}"  (has real data)`);
  }

  console.log(`\n${strays.length} stray org(s) with no users/roles/employees/payroll:`);
  strays.forEach((s) => console.log(`  ${s.id}  "${s.name}"`));
  if (!strays.length) { process.exit(0); }
  if (!confirm) {
    console.log('\nDry run — nothing deleted. Re-run with --confirm to remove the orgs listed above.');
    process.exit(0);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let deleted = 0;
  try {
    for (const s of strays) {
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_append_only');
        await client.query('DELETE FROM audit_logs WHERE "organizationId" = $1', [s.id]);
        await client.query('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_append_only');
        await client.query('DELETE FROM departments WHERE "organizationId" = $1', [s.id]);
        await client.query('DELETE FROM organizations WHERE id = $1', [s.id]);
        await client.query('COMMIT');
        console.log(`  deleted ${s.id}  "${s.name}"`);
        deleted += 1;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.log(`  SKIP    ${s.id}  "${s.name}" — ${String((e as Error).message).split('\n')[0]}`);
      }
    }
    // Belt-and-braces: ensure the append-only trigger is enabled no matter what.
    await client.query('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_append_only').catch(() => undefined);
  } finally {
    await client.end();
  }
  console.log(`\nDeleted ${deleted}/${strays.length} stray org(s).`);
  process.exit(0);
}
main().catch((e) => { console.error('purge error:', (e as Error).message); process.exit(1); });
