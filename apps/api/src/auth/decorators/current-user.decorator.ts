import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { GrantedPermission } from '../permissions';

export interface AuthUser {
  userId: string;
  organizationId: string;
  role: string;
  /** Resolved from the caller's role at login/refresh time — see auth.service.ts issueSession. Each entry carries its own scope (ALL | OWN_DEPARTMENT); use scopeFor()/hasPermission() from auth/permissions.ts to read it. */
  permissions: GrantedPermission[];
  mustChangePassword: boolean;
}

/** Injects the authenticated user (from the validated JWT) into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
