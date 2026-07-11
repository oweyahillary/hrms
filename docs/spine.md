# The cross-cutting spine — request context, tenant scoping, audit

This is the "how the system works" doc for the guardrails every feature module
sits on top of. (Endpoint-level docs live in Swagger at `/api/docs`; this is the
architecture layer Swagger can't express.)

## Request context (AsyncLocalStorage)

Every request gets an ambient context — `{ requestId, ipAddress, organizationId,
userId }` — carried via Node's `AsyncLocalStorage` so it doesn't have to be
threaded through every function call. `RequestContextMiddleware` establishes it
for all routes; `getRequestContext()` reads it anywhere.

- `requestId` + `ipAddress` are set from the request.
- `organizationId` + `userId` are set by the **auth guard** — which doesn't
  exist yet. Until it does, they come only from server config (`DEV_ORG_ID` /
  `DEV_USER_ID`), **never** client input. When auth lands, the guard enriches the
  same context object and everything downstream (scoping + audit) uses the real
  authenticated values with zero other changes.

## Tenant scoping (Prisma client extension)

`organizationId` is on every tenant-owned table, but nothing stops a developer
from forgetting the filter. The extension makes isolation structural instead of
disciplinary. For models in `TENANT_SCOPED_MODELS`, when a request has an org
context, it:

- **injects `organizationId` into `where`** on `findMany/findFirst/count/
  aggregate/groupBy/updateMany/deleteMany`;
- **injects `organizationId` into `data`** on `create/createMany`;
- **post-filters `findUnique`** — a row belonging to another org comes back as
  `null` (or `P2025` for `findUniqueOrThrow`).

**Deliberately not scoped:** `Organization` (it *is* the tenant), `StatutoryRate`
(national/global), and child tables reached via a parent (`Session`, `Payslip`,
`SalaryComponent`, `LeaveApprovalStep`, `BankExportBatch`). Keep
`TENANT_SCOPED_MODELS` in `tenant-scope.ts` in sync with the schema.

**Known coverage gap (intentional for Phase 1):** single-row `update`/`delete`/
`upsert` *by unique id* are not org-injected, because a unique `where` can't take
an extra filter. In single-tenant deployments this is harmless (one org exists).
The multi-tenant hardening pass — composite FKs that include `organizationId`,
already logged as the companion task — closes it before SaaS is switched on.
Until then, the safe pattern for a scoped single-row mutation is to read it
first (which *is* scoped) and act on the result.

**System / bootstrap operations** (no org in context, e.g. creating the first
Organization or seeding) are intentionally unscoped — there's no tenant yet.

## Audit (same extension)

Every `create/update/delete` (and their bulk forms) on a tenant-scoped model
writes an append-only `AuditLog` row with `action`, `entityType`, `entityId`,
`beforeState`/`afterState`, and the actor's `userId`/`organizationId`/`ipAddress`
from context. Notes:

- Audit rows are written through the **unextended** base client, so they are
  never re-scoped or recursively audited (the `AuditLog` model is also excluded
  explicitly) — no infinite loop.
- `beforeState` is captured for single `update`/`delete` via a pre-read
  (best-effort). Bulk ops log a coarse row (`entityId: "batch"`).
- The audit write is **best-effort**: a failure is logged but never fails the
  user's operation. Making audit transactional with the mutation is a later
  hardening option for the legally-sensitive tables (payroll).
- Writes with no org context are not audited (there's no valid `organizationId`
  to attribute them to).

## Verifying it works (on a live DB)

Pure logic is unit-tested; the end-to-end behavior needs a real database:

```bash
cd apps/api
npx ts-node scripts/verify-spine.ts
```

It creates two throwaway orgs and asserts: org-injection on write, read
isolation, cross-tenant `findUnique` blocking, and audit-row creation. Expect
all checks to pass. (It writes test rows to your dev DB — delete them or reset
the dev database afterwards.)

## Adding a new feature module (the conventions)

- Inject the Prisma client with the token: `@Inject(PRISMA) prisma:
  ExtendedPrismaClient`. Don't `new PrismaClient()` anywhere.
- Never write `where: { organizationId }` by hand — the extension does it. Don't
  pass `organizationId` on create either; it's injected.
- Never call `auditLog.create` yourself — writes are audited automatically.
- Encrypt sensitive identifier fields via `CryptoService` and store the HMAC
  companion (`*Hmac`) for anything you need to search; query by the HMAC, not the
  ciphertext.
