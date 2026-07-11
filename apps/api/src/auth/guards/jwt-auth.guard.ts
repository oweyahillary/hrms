import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';
import { getRequestContext } from '../../common/context/request-context';

/**
 * Global guard: every route requires a valid access token unless marked @Public.
 * On success it enriches the request context with the authenticated org/user, so
 * tenant scoping and audit attribute to the real user for the rest of the request.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException();
    }
    const u = user as unknown as AuthUser;
    const ctx = getRequestContext();
    ctx.organizationId = u.organizationId;
    ctx.userId = u.userId;
    return user;
  }
}
