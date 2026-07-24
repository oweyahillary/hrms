import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: string;
  organizationId: string;
  role: string;
  /** Resolved from the caller's role at login/refresh time — see auth.service.ts issueSession. */
  permissions: string[];
  mustChangePassword: boolean;
}

/** Injects the authenticated user (from the validated JWT) into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
