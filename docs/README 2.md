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
│     ├─ src/
│     │  ├─ config/              # env validation (fail-closed) + typed config
│     │  ├─ crypto/              # app-layer field encryption + blind index
│     │  │  └─ providers/        #   env master key | AWS KMS (switchable)
│     │  ├─ prisma/              # PrismaService (pg driver adapter) + module
│     │  ├─ health/              # liveness + readiness endpoints
│     │  ├─ app.module.ts
│     │  └─ main.ts              # bootstrap: helmet, validation, Swagger
│     ├─ Dockerfile
│     └─ .env.example
│  # └─ web/                     # React frontend — added later
├─ docker-compose.yml            # db + api
└─ package.json                  # npm workspaces root
```

## Prerequisites

- Node.js 22+ and npm 10+
- Docker + Docker Compose (for the containerised path)
- PostgreSQL 17 (only if running the API outside Docker)

## First-time setup

```bash
# 1. Install deps (from repo root — npm workspaces)
npm install

# 2. Create the API env file
cp apps/api/.env.example apps/api/.env

# 3. Generate the two required crypto secrets, paste them into apps/api/.env
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('HMAC_KEY='       + require('crypto').randomBytes(32).toString('base64'))"
```

> The app **fails closed** — it refuses to start without `ENCRYPTION_KEY` and
> `HMAC_KEY`. Deliberate: no accidental boot with unset secrets.

## Run — Docker (recommended)

```bash
docker compose up --build
```

API serves at <http://localhost:3000/api> (Swagger UI at `/api/docs`) once the
database is healthy and migrations are applied.

> First run only: create the initial migration once (local step 4 below) so
> `migrate deploy` has something to apply.

## Run — local (DB in Docker, API on host)

```bash
docker compose up -d db              # 1. start just Postgres
cd apps/api                          # 2.
npx prisma generate                  # 3. generate the Rust-free client
npx prisma migrate dev --name init   # 4. create + apply the first migration
npm run start:dev                    # 5. run the API in watch mode
```

## Health checks

- `GET /api/health` — liveness (process is up)
- `GET /api/health/ready` — readiness (can reach PostgreSQL)

## Security posture (already wired)

- **App-layer field encryption.** Sensitive identifiers (national ID, KRA PIN,
  bank account) are AES-256-GCM encrypted at the application layer, on top of
  Postgres at-rest encryption — a database dump alone is useless without the key.
  Searchable fields use an HMAC **blind index** (`*Hmac` columns) so lookup works
  over ciphertext. Key management is switchable via `KEY_PROVIDER` (`env` for
  self-hosted pilots, `aws_kms` for KMS-backed deployments); every ciphertext is
  self-describing, so switching providers or rotating keys never strands data.
- **Input validation** on every request — global `ValidationPipe`
  (`whitelist` + `forbidNonWhitelisted` + `transform`).
- **`helmet` + CORS**, and **env validated at boot** (fail-closed).

## The stack, briefly

- **Prisma 7** ships Rust-free and ESM-first. To interoperate with NestJS's
  CommonJS runtime the generator uses `moduleFormat = "cjs"` and emits the client
  to `src/generated/prisma` (git-ignored — run `prisma generate`). The connection
  URL lives in `prisma.config.ts`, not in `schema.prisma`.

## Not yet built (next stages)

Cross-cutting spine still to add: **audit interceptor**, **tenant-scoping Prisma
extension**, **auth** (JWT + refresh + sessions, RBAC guard). Then feature
modules — starting with **employees**, where `CryptoService` gets wired to the
encrypted identifier fields.

## Verified so far

- `nest build` clean.
- Crypto core: 10/10 unit tests (AES-GCM round-trip, envelope, blind index,
  tamper detection). Crypto module through Nest DI: 6/6.
- **Not** verified in the build sandbox: `prisma generate` (needs internet for
  the engine binary), the Docker image build, and the AWS KMS provider (needs
  live credentials) — all work on a normal machine via the setup steps above.
