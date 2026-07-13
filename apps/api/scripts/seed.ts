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
    data: { organizationId: org.id, name: 'Admin', permissions: { all: true } },
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

  console.log('\n--- Seed complete ---');
  console.log('Organization ID :', org.id);
  console.log('Admin email     :', email);
  console.log('Admin password  :', existing ? '(unchanged — user already existed)' : password);
  console.log('\nNext: set DEV_ORG_ID in apps/api/.env to the Organization ID above');
  console.log('so local requests are tenant-scoped until auth login is wired (Step 2).');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
