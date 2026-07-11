import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * Runs after JwtAuthGuard. If a route has no @Roles metadata it allows through
 * (auth is still enforced by JwtAuthGuard unless @Public). Otherwise the user's
 * role must be in the allowed set.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
