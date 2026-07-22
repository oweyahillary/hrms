/**
 * Force the admin login back to a known-good state: reset the password hash,
 * clear mustChangePassword, and ensure the account is active. Use when the admin
 * row exists (so `npm run seed` reports "user already existed") but you can't log
 * in — e.g. an old hash, a forced password change, or duplicate admins left over
 * from earlier db resets.
 *
 *   cd apps/api && npx ts-node scripts/reset-admin-password.ts
 *
 * Defaults to admin@example.com / ChangeMe123!; override with
 * SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */
import 'dotenv/config';
import { createPrismaClient } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

async function main() {
  const prisma = createPrismaClient();
  const passwords = new PasswordService();

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const passwordHash = await passwords.hash(password);
  const res = await prisma.user.updateMany({
    where: { email },
    data: { passwordHash, mustChangePassword: false, isActive: true },
  });

  if (res.count === 0) {
    console.log(`No user found with email ${email}. Run "npm run seed" first to create the admin.`);
    process.exit(1);
  }

  console.log('--- Admin password reset ---');
  console.log('Email    :', email);
  console.log('Password :', password);
  console.log('Rows updated :', res.count, '(mustChangePassword -> false, isActive -> true)');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
