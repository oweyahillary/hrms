/**
 * Live proof of the fail-closed by-id tenant guard.
 *
 * Sets up (via the BASE client, so no audit rows -> fully cleanable):
 *   - a throwaway VICTIM org + department, and
 *   - a probe department inside an existing ATTACKER org.
 * Then, acting as the attacker org (context set correctly), it:
 *   - updates its OWN department  -> must SUCCEED (positive control), and
 *   - updates/deletes the VICTIM's department by id -> must be BLOCKED.
 * Cleans up everything afterwards.
 *
 *   cd apps/api && npx ts-node scripts/verify-tenant-scope.ts
 *
 * NOTE on context: the mutation MUST be awaited INSIDE the runWithContext
 * callback. Returning the Prisma promise to be awaited later executes the query
 * outside the AsyncLocalStorage scope, where no org context exists.
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { runWithContext } from '../src/common/context/request-context';

function isNotFound(e: any): boolean {
  return e?.code === 'P2025' || /No record found/i.test(String(e?.message));
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const base = baseClientOf(prisma) as any;
  let pass = 0;
  let fail = 0;
  const check = (ok: boolean, label: string) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); ok ? pass++ : fail++; };

  const orgA = await base.organization.findFirst({});
  if (!orgA) throw new Error('No organization found — run the seed first.');
  const orgB = await base.organization.create({ data: { name: `__tenant_probe_${Date.now()}__` } });
  const deptA = await base.department.create({ data: { organizationId: orgA.id, name: 'probe-own' } });
  const deptB = await base.department.create({ data: { organizationId: orgB.id, name: 'probe-victim' } });
  console.log(`Attacker org ${orgA.id} (own dept ${deptA.id}); victim org ${orgB.id} (dept ${deptB.id})`);

  try {
    // Positive control: as org A, update org A's OWN department -> must succeed.
    let ownOk = false;
    try {
      await runWithContext({ organizationId: orgA.id }, async () => {
        await prisma.department.update({ where: { id: deptA.id }, data: { name: 'own-renamed' } as never });
      });
      const a = await base.department.findUnique({ where: { id: deptA.id } });
      ownOk = !!a && a.name === 'own-renamed';
    } catch { ownOk = false; }
    check(ownOk, 'in-org UPDATE by id succeeds (context propagates, guard allows)');

    // Attack 1: as org A, update org B's department by id -> must be blocked.
    let updBlocked = false;
    try {
      await runWithContext({ organizationId: orgA.id }, async () => {
        await prisma.department.update({ where: { id: deptB.id }, data: { name: 'HACKED' } as never });
      });
    } catch (e) { if (!isNotFound(e)) throw e; updBlocked = true; }
    check(updBlocked, 'cross-tenant UPDATE by id blocked');

    // Attack 2: as org A, delete org B's department by id -> must be blocked.
    let delBlocked = false;
    try {
      await runWithContext({ organizationId: orgA.id }, async () => {
        await prisma.department.delete({ where: { id: deptB.id } });
      });
    } catch (e) { if (!isNotFound(e)) throw e; delBlocked = true; }
    check(delBlocked, 'cross-tenant DELETE by id blocked');

    // The victim row must be intact.
    const after = await base.department.findUnique({ where: { id: deptB.id } });
    check(!!after && after.name === 'probe-victim', 'victim row intact (unchanged, not deleted)');
  } finally {
    await base.department.delete({ where: { id: deptA.id } }).catch(() => undefined);
    await base.department.delete({ where: { id: deptB.id } }).catch(() => undefined);
    await base.organization.delete({ where: { id: orgB.id } }).catch(() => undefined);
    await (prisma as any).$disconnect?.();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
