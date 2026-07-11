/**
 * Read-only: list every organization with its child-row counts, so you can see
 * what's real vs. a stray/probe org before removing anything. Makes no changes.
 *   cd apps/api && npx ts-node scripts/list-orgs.ts
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';

const MODELS = [
  'user', 'role', 'department', 'jobTitle', 'employee', 'payrollRun', 'auditLog',
  'consentRecord', 'dataSubjectRequest', 'retentionPolicy', 'breachIncident',
  'leaveType', 'leaveBalance', 'leaveRequest', 'publicHoliday', 'attendanceRecord',
  'salaryStructure',
];

async function main(): Promise<void> {
  const base = baseClientOf(createPrismaClient()) as any;
  const orgs = await base.organization.findMany({});
  console.log(`Found ${orgs.length} organization(s):`);
  for (const o of orgs) {
    const counts: Record<string, number> = {};
    for (const m of MODELS) {
      try { counts[m] = await base[m].count({ where: { organizationId: o.id } }); }
      catch { counts[m] = -1; }
    }
    const nonzero = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', ') || '(no children)';
    const created = o.createdAt?.toISOString ? o.createdAt.toISOString() : String(o.createdAt);
    console.log(`\n  ${o.id}  "${o.name}"`);
    console.log(`     created: ${created}`);
    console.log(`     children: ${nonzero}`);
  }
  await (base as any).$disconnect?.();
  process.exit(0);
}
main().catch((e) => { console.error('list error:', (e as Error).message); process.exit(1); });
