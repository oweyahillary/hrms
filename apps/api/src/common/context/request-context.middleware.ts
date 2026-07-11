import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext, type RequestContext } from './request-context';

/**
 * Establishes the per-request context store. Runs before guards/handlers, so
 * the auth guard (added later) can enrich the SAME context object with the
 * authenticated user's organizationId/userId and everything downstream sees it.
 *
 * SECURITY: organizationId is NEVER taken from client input (a spoofed header
 * could cross tenants). Pre-auth it comes only from server config (DEV_ORG_ID).
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const ctx: RequestContext = {
      requestId: randomUUID(),
      ipAddress: req.ip,
      organizationId: process.env.DEV_ORG_ID || undefined,
      userId: process.env.DEV_USER_ID || undefined,
    };
    runWithContext(ctx, () => next());
  }
}
