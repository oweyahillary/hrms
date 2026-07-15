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
│     ├─ scripts/                # bundle build, seed, verify-*.ts (live proofs)
│     ├─ src/
│     │  ├─ common/context/      # AsyncLocalStorage request context + middleware
│     │  ├─ config/              # env validation (fail-closed) + typed config
│     │  ├─ crypto/              # app-layer field encryption + blind index
│     │  ├─ prisma/              # extended client (tenant scoping + audit)
│     │  ├─ auth/                # login, JWT + refresh + sessions, RBAC, MFA
│     │  ├─ organization/        # tenant/org
│     │  ├─ employees/           # employee records (encrypted identifiers)
│     │  ├─ departments/ job-titles/ public-holidays/
│     │  ├─ salary/              # salary structures + component math
│     │  ├─ payroll/             # engine (PAYE/NSSF/SHIF/AHL), runs, payslips,
│     │  │                       #   bank export, P9 card, P10 return
│     │  ├─ attendance/ leave/   # time + leave
│     │  ├─ reports/ compliance/ # statutory reporting
│     │  ├─ health/              # liveness + readiness endpoints
│     │  ├─ app.module.ts
│     │  └─ main.ts              # bootstrap: helmet, validation, Swagger
│     ├─ Dockerfile
│     └─ .env.example
│  # └─ web/                     # React frontend — added later
├─ docs/                         # spine, deployment, auth, payroll, p10, …
├─ docker-compose.yml            # db + api
└─ package.json                  # npm workspaces root
```

## Prerequisites

- Node.js 20+ and npm 10+ (Node 20 is the tested runtime; some optional deps
  prefer 22 and warn harmlessly on 20)
- Docker + Docker Compose (for the containerised path)
- PostgreSQL 17 (only if running the API outside Docker)

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
- **App-layer field encryption.** Sensitive identifiers (national ID, KRA PIN,
  bank account) are AES-256-GCM encrypted at the application layer, on top of
  Postgres at-rest encryption — a database dump alone is useless without the key.
  Searchable fields use an HMAC **blind index** (`*Hmac` columns) so lookup works
  over ciphertext. Key management is switchable via `KEY_PROVIDER` (`env` |
  `aws_kms`); every ciphertext is self-describing, so rotating keys or switching
  providers never strands data.
- **Auth.** Login with JWT (15-min access) + opaque refresh + sessions, RBAC
  guard, **forced first-login password change**, and optional **MFA (TOTP)** with
  one-time backup codes.
- **Input validation** on every request, **helmet + CORS**, **env validated at
  boot** (fail-closed).

## The stack, briefly

- **Prisma 7** ships Rust-free/ESM-first. The generator uses `moduleFormat="cjs"`
  and emits the client to `src/generated/prisma` (git-ignored — run
  `prisma generate`). The connection URL lives in `prisma.config.ts`. The client
  is provided already-extended (tenant scoping + audit) via the `PRISMA` token —
  inject that, never `new PrismaClient()`.

## Built so far (through v0.4.0)

- **Spine** — request context, tenant scoping, append-only audit.
- **Crypto** — field encryption + blind-index search, switchable key provider.
- **Auth** — login/JWT/refresh/sessions, RBAC, forced password change, MFA (TOTP).
- **Core HR** — organization, employees (encrypted PII), departments, job titles,
  public holidays, attendance, leave.
- **Payroll** — statutory engine (PAYE bands, NSSF Phase 4, SHIF, AHL; SHIF/AHL
  deductible before PAYE per the 2024 Tax Laws Amendment), payroll runs and
  payslips with DB-level immutability triggers.
- **Statutory outputs** — bank export (bulk EFT/RTGS CSV), **P9** tax-deduction
  card (PDF), **P10** employer PAYE return Section B (iTax import CSV — see
  **[docs/p10.md](docs/p10.md)**), and JSON reporting endpoints (payroll summary,
  statutory remittance).

## Verified (CI)

A single end-to-end CI job runs on PostgreSQL 17 and gates every merge. Each
`verify-*.ts` script asserts **relational** identities against a live API, so the
gates are independent of the exact statutory rates. Current gates: smoke,
immutability, tenant isolation, payslip PDF, bank export, P9, P10, reports,
password change, MFA. Run any of them yourself against a live DB, e.g.
`cd apps/api && npx ts-node scripts/verify-p10.ts`.

## Roadmap (next)

- **OIDC SSO** groundwork (IdP-specific wiring once a pilot client's provider is
  known — Google Workspace / Entra / Okta; local break-glass login retained).
- **Leave auto-accrual.**
- **Frontend / dashboard** (the JSON reporting endpoints already feed it).
