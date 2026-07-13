import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BYPASS_PASSWORD_CHANGE_KEY } from '../decorators/bypass-password-change.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * Runs after JwtAuthGuard. If the authenticated user still owes a password
 * change (e.g. the seeded admin on first login, or an admin-forced reset),
 * every route is refused except those marked @BypassPasswordChange — so a
 * default/temporary credential can do nothing but rotate itself. Public routes
 * have no req.user and pass straight through.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !user.mustChangePassword) return true;

    const bypass = this.reflector.getAllAndOverride<boolean>(BYPASS_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bypass) return true;

    throw new ForbiddenException({
      statusCode: 403,
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'You must change your password before continuing.',
    });
  }
}
