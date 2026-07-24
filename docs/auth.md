# Auth

JWT access tokens + revocable refresh tokens, scrypt password hashing, a global
auth guard, and role-based authorization. This is the layer that populates the
request context with the authenticated user (retiring `DEV_ORG_ID`).

## Token model

- **Access token** — short-lived JWT (`JWT_ACCESS_TTL`, default 15m) carrying
  `{ sub: userId, org: organizationId, role }`; signed with `JWT_ACCESS_SECRET`.
- **Refresh token** — opaque random string (revocable). Only its SHA-256 hash is
  stored in `sessions`; rotated on every use (`JWT_REFRESH_TTL_DAYS`, default 7).
- Separate access/refresh secrets so a leaked access secret can't mint refresh
  tokens.

## Password hashing

Node's built-in **scrypt** — memory-hard, OWASP-acceptable, and zero native deps
so it runs identically on VPS, Docker, and cPanel. Self-describing stored format
(`scrypt$N$r$p$salt$hash`) for future parameter upgrades.

## Endpoints

- `POST /api/auth/login` — `{ email, password }` -> `{ accessToken, refreshToken, user }`
- `POST /api/auth/refresh` — `{ refreshToken }` -> new token pair (old one revoked)
- `POST /api/auth/logout` — `{ refreshToken }` -> revokes the session
- `GET  /api/auth/me` — returns the caller's identity (requires access token)

Login/refresh/logout are `@Public`; everything else requires a valid access token.

## Guards & authorization (conventions)

Every route is protected by a **global `JwtAuthGuard`** — opt out per route with
`@Public()`. On success the guard writes the authenticated `organizationId`/
`userId` into the request context, so tenant scoping and audit attribute to the
real user for the rest of the request.

Authorization is **permission-based**, not role-name-based — `@Roles(...)`/
`RolesGuard` were removed. The catalogue of ~25 `resource.action` keys lives in
`apps/api/src/auth/permissions.ts` (`PERMISSIONS`); a role grants a set of
`{ key, scope }` pairs, checked by the global `PermissionsGuard`:

```ts
@Permissions('org_structure.manage')          // ALL of these keys required
@Post('departments')
create(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartmentDto) { ... }

@AnyPermission('leave.view', 'leave.approve', 'leave.manage')  // ANY ONE is enough
@Get()
list(@CurrentUser() user: AuthUser, @Query() query: QueryLeaveRequestDto) { ... }
```

`@CurrentUser()` injects `AuthUser` — `{ userId, organizationId, role, permissions, mustChangePassword }`,
where `permissions` is the resolved `GrantedPermission[]` (see `resolveRolePermissions()`).

### Scope: ALL vs OWN_DEPARTMENT

A subset of keys (`PermissionDef.scopeable`) can additionally be scoped to
`OWN_DEPARTMENT` — the grant only applies to rows in the actor's own
department, resolved via their linked `Employee.departmentId`
(`DepartmentScopeService.ownDepartmentId`). Scope filters **data**, not just
route access — the guard only confirms the actor holds the key at all; the
service layer narrows the query. A non-scopeable key's scope is always
FORCED to `ALL` server-side (`UsersService.normalize()`), regardless of what
a client submits — never trust a client-supplied scope on a key that isn't
`scopeable`.

**Fail closed:** if an OWN_DEPARTMENT-scoped actor has no linked Employee (or
that Employee has no department), the result is empty/refused — never "falls
through to everyone." List endpoints return `[]`; single-resource endpoints
refuse the action.

### 403 vs 404 for out-of-scope resources

**Rule:** a resource outside the actor's scope reads as **404**, identical to
one that genuinely doesn't exist — never 403. A 403 confirms the resource
exists (just not for you), which is itself a leak: it tells a Line Supervisor
that SOME other department has a pending leave request with that id, even
though they can never see its contents. **403 stays reserved for**: the
actor lacks a permission on the route at all (caught by the guard, before any
resource is looked up), or a genuine business-rule refusal unrelated to
department scope (e.g. "it is not your turn to approve this request" — an
in-scope caller learning they're not the assigned approver doesn't leak
anything about another department).

Concretely, in a scoped single-resource method: check scope **first**, right
after loading the row, before checking status/business-rule details — so an
out-of-scope caller gets a uniform 404 regardless of the resource's internal
state (see `LeaveRequestsService.act()`/`cancel()`/`get()` and
`OvertimeService.assertInScope()` for the pattern). `assertTargetInScope()`
(leave) and `assertInScope()` (overtime) both throw `NotFoundException`, not
`ForbiddenException`, for exactly this reason.

## Seeding the first admin

Single-tenant deployments are admin-provisioned (no public signup):

```bash
cd apps/api
npm run seed     # prints the Organization ID + admin credentials
```

## Testing login end to end

With the API running and `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` set:

```bash
# 1) log in
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'

# 2) call a protected route with the accessToken from step 1
curl -s http://localhost:3000/api/auth/me -H "Authorization: Bearer <ACCESS_TOKEN>"

# 3) rotate tokens
curl -s -X POST http://localhost:3000/api/auth/refresh \
  -H 'Content-Type: application/json' -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

Once login works you can unset `DEV_ORG_ID`: authenticated requests get the org
from the JWT, and unauthenticated ones (login) run unscoped.

## Verified

- Security core: 14/14 unit tests (hash/verify, token sign/verify, refresh hash).
- Full app compiles; DI-boots with the global guards + JWT strategy resolving.
- Live login flow (against your DB) is the acceptance test — see curl above.
