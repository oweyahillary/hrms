import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * Runs after JwtAuthGuard. If a route has no @Permissions metadata it allows
 * through (auth is still enforced by JwtAuthGuard unless @Public). Otherwise
 * the caller's permission set (resolved from their role at login/refresh
 * time — see auth.service.ts issueSession) must include every listed key.
 * Replaces the deprecated (now-deleted) RolesGuard, which matched role NAMES.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    const granted = user?.permissions ?? [];
    if (!required.every((p) => granted.includes(p))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
