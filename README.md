# HRMS — Kenyan HR Management System

Modular monolith: **NestJS 11 (TypeScript) + Prisma 7 + PostgreSQL 17**, packaged
with Docker for single-tenant, hosting-agnostic deployment (one DB + one API per
client). `apps/api/prisma/schema.prisma` is the authoritative data model.

## Repository layout

```
hrms-app/
├─ apps/
│  └─ api/                       # NestJS API (the backend)
│     ├─ prisma/schema.prisma    # data model (ground truth)
│     ├─ prisma.config.ts        # Prisma 7 datasource/migrations config
│     ├─ passenger.js            # cPanel/Passenger startup shim
│     ├─ scripts/                # build-cpanel-bundle.sh, verify-spine.ts
│     ├─ src/
│     │  ├─ common/context/      # AsyncLocalStorage request context + middleware
│     │  ├─ config/              # env validation (fail-closed) + typed config
│     │  ├─ crypto/              # app-layer field encryption + blind index
│     │  ├─ prisma/              # extended client (tenant scoping + audit)
│     │  ├─ health/              # liveness + readiness endpoints
│     │  ├─ app.module.ts
│     │  └─ main.ts              # bootstrap: helmet, validation, Swagger
│     ├─ Dockerfile
│     └─ .env.example
│  # └─ web/                     # React frontend — added later
├─ docs/
│  ├─ spine.md                   # context, tenant scoping, audit conventions
│  └─ deployment-cpanel.md       # shared-hosting deployment guide
├─ docker-compose.yml            # db + api
└─ package.json                  # npm workspaces root
```

## First-time setup

```bash
npm install                              # from repo root (npm workspaces)
cp apps/api/.env.example apps/api/.env    # then set the two crypto secrets below
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('HMAC_KEY='       + require('crypto').randomBytes(32).toString('base64'))"
```

> Fails closed — won't start without `ENCRYPTION_KEY` and `HMAC_KEY`.

## Run — local (DB in Docker, API on host)

```bash
docker compose up -d db
cd apps/api
npx prisma generate
npx prisma migrate dev --name init
npm run start:dev
```

API at <http://localhost:3000/api> (Swagger at `/api/docs`). Health:
`/api/health` and `/api/health/ready`.

## Deployment

- **Recommended — VPS / Docker.** `docker compose up --build`. A small Kenyan VPS
  gives an isolated single-tenant instance and keeps the containerised deploy.
- **Alternate — shared cPanel.** `npm run bundle:cpanel`, then follow
  **[docs/deployment-cpanel.md](docs/deployment-cpanel.md)**.

## Architecture / security (already wired)

- **Request context + tenant scoping + audit** — see
  **[docs/spine.md](docs/spine.md)**. `organizationId` is injected/enforced
  automatically per request, and every write is recorded to an append-only audit
  trail — no per-module code required.
- **App-layer field encryption** (national ID, KRA PIN, bank account) with an
  HMAC blind index for search; key management switchable via `KEY_PROVIDER`
  (`env` | `aws_kms`).
- **Input validation** on every request, **helmet + CORS**, **env validated at
  boot** (fail-closed).

## The stack, briefly

- **Prisma 7** ships Rust-free/ESM-first. The generator uses `moduleFormat="cjs"`
  and emits the client to `src/generated/prisma` (git-ignored — run
  `prisma generate`). The connection URL lives in `prisma.config.ts`. The client
  is provided already-extended (tenant scoping + audit) via the `PRISMA` token —
  inject that, never `new PrismaClient()`.

## Not yet built (next stages)

**Auth** (login, JWT + refresh + sessions, RBAC guard) — which will populate the
request context with the real authenticated org/user. Then feature modules,
starting with **employees**, where `CryptoService` meets the encrypted identifier
fields.

## Verified so far

- `nest build` clean.
- Crypto core 10/10; crypto-through-DI 6/6.
- Spine pure logic 22/22 (tenant-scope injection shapes, recursion guard,
  snapshot serialisation); app DI-boots with the extended client + middleware.
- Passenger shim boots even with a socket-path `PORT`.
- **Run yourself against a live DB:** `npm run verify:spine` — proves org
  injection, read isolation, cross-tenant blocking, and audit writes end-to-end.
- Not verified in-sandbox: `prisma generate`, Docker image build, the AWS KMS
  provider (live creds), and the extension's live DB behavior (that's what
  `verify:spine` is for).
