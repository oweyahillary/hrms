/**
 * Live acceptance test for the cross-cutting spine (tenant scoping + audit).
 * Run against your dev database AFTER `prisma generate` + `prisma migrate dev`:
 *
 *   cd apps/api
 *   npx ts-node scripts/verify-spine.ts
 *
 * IMPORTANT: each DB call is awaited INSIDE runWithContext(). Prisma promises
 * are lazy — they execute when awaited — so the await must happen inside the
 * AsyncLocalStorage scope, exactly like the real HTTP path (the whole request
 * runs inside the context middleware). Awaiting outside the scope loses the
 * context and the extension sees no org.
 */
import 'dotenv/config';
import { createPrismaClient } from '../src/prisma/prisma.service';
import { runWithContext } from '../src/common/context/request-context';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log('  PASS ' + m)) : (fail++, console.log('  FAIL ' + m)); };

async function main() {
  const prisma = createPrismaClient();
  const tag = Date.now().toString();

  // Bootstrap two orgs (no context => unscoped/unaudited, as system ops should be).
  const orgA = await prisma.organization.create({ data: { name: `Org A ${tag}` } });
  const orgB = await prisma.organization.create({ data: { name: `Org B ${tag}` } });

  // As Org A: create a department. Note we DON'T pass organizationId — the
  // extension injects it. `as any` only because the static type still lists it.
  const deptA = await runWithContext(
    { organizationId: orgA.id, ipAddress: '127.0.0.1' },
    async () => await prisma.department.create({ data: { name: `Engineering ${tag}` } as any }),
  );
  ok(deptA.organizationId === orgA.id, 'write injects organizationId (never passed it explicitly)');

  // As Org B: create a department.
  const deptB = await runWithContext(
    { organizationId: orgB.id, ipAddress: '127.0.0.1' },
    async () => await prisma.department.create({ data: { name: `Sales ${tag}` } as any }),
  );

  // As Org A: list departments -> must see ONLY Org A's.
  const visible = await runWithContext(
    { organizationId: orgA.id },
    async () => await prisma.department.findMany({ where: { name: { contains: tag } } }),
  );
  ok(visible.length === 1 && visible[0].id === deptA.id, 'read isolation: Org A sees only its own department');

  // As Org A: findUnique Org B's department by id -> must be blocked (null).
  const leaked = await runWithContext(
    { organizationId: orgA.id },
    async () => await prisma.department.findUnique({ where: { id: deptB.id } }),
  );
  ok(leaked === null, 'cross-tenant findUnique is blocked (post-filter returns null)');

  // Audit rows for the two department creates (unscoped read => sees both).
  const audits = await prisma.auditLog.findMany({
    where: { entityType: 'Department', action: 'create', organizationId: { in: [orgA.id, orgB.id] } },
  });
  ok(audits.length >= 2, `audit rows written for writes (found ${audits.length}, expected >= 2)`);
  const a = audits.find((r) => r.entityId === deptA.id);
  ok(!!a && a.organizationId === orgA.id, 'audit row carries correct actor org + entityId');
  ok(!!a && a.afterState !== null, 'audit row captured after-state snapshot');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
