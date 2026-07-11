import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request ambient context, carried without threading it through every
 * function call. Both the tenant-scoping Prisma extension and the audit
 * extension read from here.
 *
 * organizationId / userId are populated by the auth guard once auth exists.
 * Until then, a server-controlled DEV_ORG_ID / DEV_USER_ID (never client input)
 * can prefill them for local development so the spine has values to work with.
 */
export interface RequestContext {
  requestId?: string;
  ipAddress?: string;
  organizationId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with a fresh context bound for the lifetime of the async chain. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Current context, or an empty object outside any request (e.g. system tasks). */
export function getRequestContext(): RequestContext {
  return storage.getStore() ?? {};
}
