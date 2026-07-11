import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { tenantAndAuditExtension } from './prisma.extensions';

/**
 * Injection token for the extended Prisma client. Inject it with:
 *   constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}
 *
 * We provide the client via a factory (not a class extending PrismaClient) so
 * the adapter reads DATABASE_URL at provider-instantiation time — AFTER
 * ConfigModule has loaded .env — and so the $extends result (a new instance) is
 * what actually gets injected everywhere.
 */
export const PRISMA = 'PRISMA_CLIENT';

export function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string });
  const base = new PrismaClient({ adapter });
  // base is captured by the audit extension for recursion-free audit writes.
  const extended = base.$extends(tenantAndAuditExtension(base));
  // Expose the UNEXTENDED base client so services that need a real DB
  // transaction can bypass the per-query extension (which does not compose
  // cleanly with interactive transactions) and inject organizationId + write
  // audit rows explicitly, atomically, inside the transaction.
  (extended as unknown as { $base: PrismaClient }).$base = base;
  return extended;
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/** The unextended base client attached to an extended client, for manual transactions. */
export function baseClientOf(prisma: ExtendedPrismaClient): PrismaClient {
  return (prisma as unknown as { $base: PrismaClient }).$base;
}
