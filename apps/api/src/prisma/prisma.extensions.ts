import { Prisma, PrismaClient } from '../generated/prisma/client';
import { getRequestContext } from '../common/context/request-context';
import {
  applyTenantScope, blocksCrossTenantWrite, delegateKey, extractEntityId, isAuditableWrite,
  isCrossTenantRow, isTenantScoped, toJsonSnapshot, UNIQUE_READ,
} from './tenant-scope';

/**
 * The single cross-cutting Prisma extension:
 *   1. Tenant scoping — inject/enforce organizationId on tenant-scoped models.
 *   2. Audit — every create/update/delete writes an append-only AuditLog row
 *      with actor/entity/before/after/ip taken from the request context.
 *
 * Audit rows are written through the UNEXTENDED `base` client, so they are
 * neither re-scoped nor recursively audited (no infinite loop); organizationId
 * is set on them explicitly from context.
 *
 * COVERAGE NOTE: findUnique is post-filtered by org; single update/delete/upsert
 * by unique id are audited but NOT org-injected (a unique where can't take an
 * extra filter). In single-tenant Phase 1 that gap is harmless; the multi-tenant
 * hardening pass (composite FKs incl. organizationId) closes it — see docs/spine.md.
 */
export function tenantAndAuditExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'tenant-and-audit',
    query: {
      $allModels: {
        async $allOperations(params: {
          model?: string;
          operation: string;
          args: any;
          query: (args: any) => Promise<any>;
        }): Promise<any> {
          const { model, operation, query } = params;
          const ctx = getRequestContext();
          const orgId = ctx.organizationId;
          const workingArgs = applyTenantScope(model, operation, params.args, orgId);

          const auditable = isAuditableWrite(model, operation, orgId);

          // Best-effort before-state for single-row update/delete, read through a
          // *scoped* filter. If it resolves to null for a tenant-scoped model, we
          // fail closed below — closing the by-id gap so an update/delete can never
          // touch another org's row even if a service forgot to pre-check.
          let before: unknown = null;
          let scopedReadResolved = false;
          if (auditable && (operation === 'update' || operation === 'delete')) {
            try {
              const where = (workingArgs.where as Record<string, unknown> | undefined) ?? {};
              const delegate = (base as any)[delegateKey(model as string)];
              before = await delegate.findFirst({
                where: isTenantScoped(model) ? { ...where, organizationId: orgId } : where,
              });
              scopedReadResolved = true;
            } catch {
              /* an audit read miss (or a where shape findFirst can't take) never blocks by itself */
            }
          }

          // Fail-closed tenant guard: a tenant-scoped update/delete whose target is
          // not in the caller's org is rejected as not-found (mirrors Prisma's own
          // P2025), rather than silently mutating a foreign row.
          if (
            blocksCrossTenantWrite({
              model, operation, orgId,
              scopedReadResolved, beforeFound: before !== null && before !== undefined,
            })
          ) {
            throw new Prisma.PrismaClientKnownRequestError(
              'No record found for the current organization',
              { code: 'P2025', clientVersion: Prisma.prismaVersion?.client ?? 'unknown' },
            );
          }

          const result = await query(workingArgs);

          // Hide cross-tenant rows returned by a unique read.
          if (orgId && isTenantScoped(model) && UNIQUE_READ.has(operation) && isCrossTenantRow(result, orgId)) {
            if (operation === 'findUniqueOrThrow') {
              throw new Prisma.PrismaClientKnownRequestError('No record found', {
                code: 'P2025',
                clientVersion: Prisma.prismaVersion?.client ?? 'unknown',
              });
            }
            return null;
          }

          // Durable, best-effort audit write (a failure never fails the mutation).
          if (auditable) {
            const after = operation === 'delete' || operation === 'deleteMany' ? null : result;
            try {
              await base.auditLog.create({
                data: {
                  organizationId: orgId as string,
                  userId: ctx.userId ?? null,
                  action: operation,
                  entityType: model as string,
                  entityId: extractEntityId(result, before),
                  beforeState: toJsonSnapshot(before) as Prisma.InputJsonValue | undefined,
                  afterState: toJsonSnapshot(after) as Prisma.InputJsonValue | undefined,
                  ipAddress: ctx.ipAddress ?? null,
                },
              });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error('[audit] failed to write audit log:', (err as Error)?.message ?? err);
            }
          }

          return result;
        },
      },
    },
  });
}
