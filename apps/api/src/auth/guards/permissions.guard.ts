import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ANY_PERMISSION_KEY } from '../decorators/permissions.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * Runs after JwtAuthGuard. If a route has no @Permissions/@AnyPermission
 * metadata it allows through (auth is still enforced by JwtAuthGuard unless
 * @Public). @Permissions requires every listed key; @AnyPermission requires
 * at least one — a route with both must satisfy both conditions. Replaces
 * the deprecated (now-deleted) RolesGuard, which matched role NAMES.
 *
 * Route access only cares whether a key is held at all — scope decides what
 * DATA a service returns/writes once inside, not whether the route is
 * reachable (see auth/permissions.ts's scopeFor/GrantedPermission).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if ((!requiredAll || requiredAll.length === 0) && (!requiredAny || requiredAny.length === 0)) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    const granted = user?.permissions ?? [];
    const has = (key: string) => granted.some((g) => g.key === key);

    if (requiredAll?.length && !requiredAll.every(has)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (requiredAny?.length && !requiredAny.some(has)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
