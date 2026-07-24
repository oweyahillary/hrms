import { Inject, Injectable } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';

/**
 * Resolves the department an OWN_DEPARTMENT-scoped actor is limited to.
 * A user with no linked Employee, or an Employee with no departmentId, has
 * no department to scope to — callers MUST treat that as "matches nothing",
 * never "matches everything". See scopeFor()/GrantedPermission in
 * auth/permissions.ts for how a route decides whether to call this at all.
 */
@Injectable()
export class DepartmentScopeService {
  constructor(@Inject(PRISMA) private readonly prisma: ExtendedPrismaClient) {}

  async ownDepartmentId(userId: string): Promise<string | null> {
    const user = (await this.prisma.user.findFirst({
      where: { id: userId } as never,
      select: { employee: { select: { departmentId: true } } },
    } as never)) as unknown as { employee: { departmentId: string | null } | null } | null;
    return user?.employee?.departmentId ?? null;
  }
}
