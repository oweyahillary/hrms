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

Restrict by role with `@Roles(...)` (checked by the global `RolesGuard`, which is
a no-op when no `@Roles` is present):

```ts
@Roles('Admin')
@Post('departments')
create(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartmentDto) { ... }
```

`@CurrentUser()` injects `{ userId, organizationId, role }` from the validated JWT.

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
