# HRMS Build — Session Handoff

> **Purpose of this document:** hand the next AI session everything it needs to continue this build *seamlessly and productively*. Read this top to bottom before doing anything. The **"How to work in this session"** section is the most important part — it's what made the last session fruitful.

---

## 0. How to work in this session (READ FIRST)

This is the working style that made the last session precise, fast, and low-friction. Please match it:

- **Act as lead engineer.** Make decisive recommendations. When the user says "pick and let's build" or "you decide / lead the call," *own the direction* — don't bounce the decision back. The user explicitly values this.
- **Be direct and concise.** No hedging, no filler, no over-explaining. Get to the point. The user dislikes back-and-forth for its own sake.
- **Verify before you ship — always.** The sandbox here cannot run Postgres/Docker/Prisma. The proven pattern:
  1. Write pure logic → test it in the sandbox (transpile + run with sample data).
  2. Compile the whole app via `npx nest build` using a **temporary Prisma stub** at `apps/api/src/generated/prisma/client.ts` (delete it after — see §7 for the exact stub).
  3. **CRITICAL:** any `scripts/verify-*.ts` (CI gate) run via ts-node uses the **real repo tsconfig** (strict, `lib: ES2023`, NO DOM). ALWAYS typecheck it under a temp `tsconfig.verify.json` that `extends ./tsconfig.json` BEFORE shipping. Looser sandbox flags will let bugs through that then fail CI. This bit us more than once.
- **Incremental delivery.** Build in small increments: pure builder first (proven) → wire to DB → CI gate. One feature = a few increments.
- **ONE zip per turn.** Share exactly one zip containing ONLY the files created/edited that turn. Put it in `/mnt/user-data/outputs/` and present it. No dumping the whole repo.
- **Live proof.** After each increment, give the user exact copy-paste `curl` commands to prove it works against their running server. They value seeing it work.
- **Honesty over guessing.** Be explicit about verified vs unverified. **Never ship guessed formats for validated artifacts** (esp. tax returns — a wrong column order fails iTax validation / misfiles and causes penalties). If you can't determine something reliably, say so and ask for the one input that removes the risk.
- **Reconcile/research before building** compliance features. Confirm the numbers/format against the real spec first.
- **Use `ask_user_input` only for genuine product/scope forks**, not for things you should decide as lead. Keep it to 1–3 crisp options.
- Read the relevant `SKILL.md` before creating files (docx/pptx/xlsx/pdf). Runtime libs here are Node (pdfkit, exceljs); the skills are Python-oriented and useful for *verifying* output, not for the runtime code.

---

## 1. Goal & Product

Building an **HRMS (HR management system) for Kenyan SMEs**. Single-tenant-per-client (each client gets their own deployment + DB), hosting-agnostic (VPS/cloud OR cPanel/shared). The user is a solo developer (may add a collaborator soon).

**Repo:** `github.com/oweyahillary/hrms`
**Working dir (user's machine):** `~/Downloads/Software Dev/HRMS/hrms-app`

---

## 2. Stack & Architecture

- **NestJS 11 (TypeScript) + Prisma 7 + PostgreSQL 17 + Docker.** Modular monolith. npm workspaces: `apps/api` (workspace name `@hrms/api`).
- Schema is ground truth at `apps/api/prisma/schema.prisma`.
- Design: `organizationId` on every tenant table; append-only audit/payroll; statutory rates as effective-dated global lookup.

**Key architecture decisions (still in force):**
- **Prisma 7** (Rust-free/ESM): generator `provider="prisma-client"`, `output="../src/generated/prisma"`, `moduleFormat="cjs"`; datasource URL via `env('DATABASE_URL')` in `prisma.config.ts`; `@prisma/adapter-pg`. Client injected via `PRISMA` token as `ExtendedPrismaClient`. Prisma-typed `data`/`where` objects use `as never` casts; results cast `as unknown as T`.
- **Encryption:** `CryptoService` (`@Global`): `encrypt`/`decrypt` async, `blindIndex`/`isEncrypted` sync. Encrypted PII: `nationalId`, `kraPin`, `bankAccountNumber` on **Employee**. The employer's own `Organization.kraPin` / `Organization.bankAccountNumber` are **plaintext** (own-company data, needed for filings). Password hashing = scrypt.
- **Auth:** JWT `{sub, org, role}` 15-min access + opaque refresh. `HR_MANAGEMENT_ROLES = ['Admin','HR Manager','HR Officer']`. `Roles` decorator + `CurrentUser`/`AuthUser = {userId, organizationId, role}`.
- **Tenant scoping** via a Prisma extension (`src/prisma/tenant-scope.ts`, `TENANT_SCOPED_MODELS`). Models WITHOUT their own `organizationId` are scoped **via a relation**: `Payslip` & `BankExportBatch` via `PayrollRun`; `SalaryComponent` via `SalaryStructure`; etc. **Important for aggregation:** to bound a Payslip query to the org, resolve the org-scoped `PayrollRun` IDs first, then query payslips by those IDs (the extension does NOT inject org into nested relation filters).
- **Immutability:** DB triggers on `payroll_runs`, `payslips`, `audit_logs` (`apps/api/db/immutability.sql`). Payslip trigger allows a one-time PDF-path attach.

---

## 3. Current State — v0.3.0 RELEASED

`main` = `develop` = **v0.3.0** (tagged). Three features shipped this session, all CI-green:
1. **Bank export** (generic CSV/XLSX + real EFT/RTGS bank adapter)
2. **KRA P9** (annual tax deduction card — JSON + PDF, with reconciliation guard)
3. **Reporting** (payroll summary, statutory remittance, year trend, headcount — JSON + PDFs)

Phase 1 + hardening was complete before this session (foundation, auth, core HR/employees, leave, attendance, payroll engine, compliance/DPA, immutability, tenant isolation, payslip PDF, org branding/logo).

**Branch strategy:** two-tier — `feat/*` → `develop` (integration) → `main` (release). **`develop` is now the default branch** on GitHub.

**⚠️ Release process warning:** two releases in a row turned into merge-conflict/divergence cleanups, caused by **mixing CLI merges with GitHub PR merges on `main`**. **Recommendation for next session: switch to a single PR-only path** — feature → PR into `develop` (CI runs, confirm green, merge in UI) → at release, one PR `develop → main` (merge in UI) → tag. Optionally add a `main` branch ruleset requiring the CI check to pass. This eliminates both the divergence and the "released before CI green" problems.

---

## 4. CI Pipeline (`.github/workflows/ci.yml`)

Single `e2e` job (`Build + end-to-end verification`) on Postgres 17 service. Order of gates:
`smoke` → `finalize fixture` → `verify immutability` → `verify tenant` → `verify payslip-pdf` → `verify bank-export` → `verify p9` → `verify reports`.

Each `verify-*.ts` is self-contained (creates its own data on the ephemeral DB) and asserts **relational** properties (identities that hold regardless of statutory rates), not hardcoded shilling figures — so the gates survive rate changes.

---

## 5. Features Built This Session — Active Files

### Bank export
- `src/payroll/bank-export-file.ts` — pure builders: `buildSalaryCsv/Xlsx` (generic 8-col), `buildEftCsv/Xlsx` (EFT 11-col matching real bank template). Uses **exceljs**. RTGS if amount ≥ 1,000,000 else ACH. Codes/accounts kept as TEXT in xlsx (leading zeros preserved).
- `src/payroll/bank-export.service.ts`, `bank-export.controller.ts`
- Schema: Employee `+bankCode +bankBranchCode`; Organization `+bankAccountNumber +bankPurposeCode`; BankExportBatch `+format +template +rowCount`; enums `BankExportFormat{CSV XLSX}`, `BankExportTemplate{GENERIC EFT}`.
- Endpoints: `POST /payroll/runs/:id/bank-export?template=generic|eft&format=csv|xlsx|both`, `GET :id/bank-exports`, `GET :id/bank-exports/:batchId/download`.
- EFT requires employer debit account configured (409 if not). CI gate: `scripts/verify-bank-export.ts`.
- **New dependency: `exceljs`** (in package.json + lockfile).

### KRA P9 (annual tax deduction card)
- `src/payroll/p9-model.ts` — pure `buildP9Card(months)`, derives KRA columns A–O + totals + **reconciliation flag** (computed PAYE must equal deducted PAYE).
- `src/payroll/p9.service.ts` — gathers finalized payslips for a year; per month re-runs the engine via the SAME path the run used (`pickEffectiveStructure` → `deriveStructureAmounts` → `computePayroll` with that period's rates); reconciles to stored PAYE.
- `src/payroll/p9-document.ts` — pure `renderP9Pdf` (landscape KRA grid, pdfkit).
- `src/payroll/p9.controller.ts` — `GET /employees/:id/p9?year=`, `GET :id/p9/pdf?year=`.
- CI gate: `scripts/verify-p9.ts`. Reconciles **by construction** (built from stored figures).

### Reporting
- `src/reports/reports.service.ts` — `payrollSummary`, `statutoryRemittance`, `yearTrend`, `headcount`, + `remittancePdf`/`payrollSummaryPdf`.
- `src/reports/reports.controller.ts`, `reports.module.ts` (registered in `app.module.ts`).
- `src/reports/reports-document.ts` — pure `renderRemittancePdf`, `renderPayrollSummaryPdf` (portrait pdfkit).
- Endpoints: `GET /reports/payroll-summary`, `/statutory-remittance`, `/year-trend?year=`, `/headcount`, plus `/statutory-remittance/pdf` and `/payroll-summary/pdf`.
- CI gate: `scripts/verify-reports.ts`.

---

## 6. Confirmed 2026 Kenyan Statutory Rates (seeded, golden-tested)

- **PAYE** bands 10 / 25 / 30 / 32.5 / 35%; personal relief **2,400/mo**.
- **NSSF** Phase 4: 6% employee + 6% employer, UEL 108,000, max **6,480**.
- **SHIF** 2.75%, floor 300 (employee only).
- **AHL** 1.5% employee + 1.5% employer.
- **Pension deductible cap: 30,000/mo** (raised from 20,000 by Finance Act 2024) — for P9 column E lower-of-three (30% of basic / actual / 30,000).
- **GOLDEN test (memorize):** Jane, gross **105,000** → nssf 6,300, shif 2,887.50, ahl 1,575, paye **19,154.60**, net **65,082.90**.

---

## 7. Environment, Deployment Quirks & The Verification Stub

**User's machine:** Windows, Git Bash/MINGW. Node v20, Postgres port 5433.
- Dev server from ROOT: `npm run api:dev`. Build from ROOT: `npm run api:build`. Prisma commands from `apps/api`.
- `source scripts/env.sh` (from `apps/api`) sets `$TOKEN`, `$EMP`, `$SCRATCH`; run **`refresh`** to re-mint the token when it expires (access tokens last 15 min).
- `.scratch/` (repo root, git-ignored) is the home for test downloads; `$SCRATCH` points there. Download test files with `-o "$SCRATCH/whatever"`.

**Recurring friction (anticipate these):**
- **Token expiry → 401s.** Fix: `refresh` (or re-`source scripts/env.sh`).
- **After ANY schema change:** must `npx prisma db push` + `npx prisma generate` + **RESTART the server**, or endpoints 500 with "column does not exist." This caused several red-herring 500s.
- **MINGW mangles multi-line pastes** — give commands ONE LINE AT A TIME.
- **Placeholder values run literally** — the user has pasted `REAL_ID`/`<next-thing>` verbatim into bash. Give real values or `$VAR`s, and tell them exactly what to substitute.
- **Wrong-directory errors** — be explicit about `cd` target (`apps/api` vs root).

**Sandbox verification stub** (can't run DB/Prisma here). Create at `apps/api/src/generated/prisma/client.ts`, build, then delete:
```ts
/* OFFLINE COMPILE STUB */
/* eslint-disable @typescript-eslint/no-explicit-any */
export namespace Prisma {
  export type InputJsonValue = any; export type EmployeeUncheckedCreateInput = any; export type EmployeeUncheckedUpdateInput = any;
  export const prismaVersion: { client: string } = { client: '7.0.0' };
  export class PrismaClientKnownRequestError extends Error {
    code: string; clientVersion: string; meta?: Record<string, unknown>; batchRequestIdx?: number;
    constructor(m: string, o: { code: string; clientVersion: string; meta?: Record<string, unknown>; batchRequestIdx?: number }) {
      super(m); this.name='PrismaClientKnownRequestError'; this.code=o.code; this.clientVersion=o.clientVersion; this.meta=o.meta; this.batchRequestIdx=o.batchRequestIdx;
    }
  }
  export function defineExtension(ext: any): any { return ext; }
}
export declare class PrismaClient {
  constructor(...args: any[]); [model: string]: any;
  $extends(ext: any): PrismaClient & { $base: PrismaClient };
  $transaction<R>(fn: (tx: PrismaClient) => Promise<R>): Promise<R>;
  $transaction<R>(ops: Array<Promise<R>>): Promise<R[]>;
  $connect(): Promise<void>; $disconnect(): Promise<void>;
  $queryRaw(...a: any[]): Promise<any>; $executeRaw(...a: any[]): Promise<any>;
  $queryRawUnsafe(...a: any[]): Promise<any>; $executeRawUnsafe(...a: any[]): Promise<any>;
}
```
**Verify-script typecheck** (do this BEFORE shipping any `verify-*.ts`): create `apps/api/tsconfig.verify.json` = `{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": true, "skipLibCheck": true }, "include": ["scripts/verify-X.ts"] }`, run `npx tsc -p tsconfig.verify.json`, then delete it.

---

## 8. Key IDs / Test Data

- **Seeded admin:** `admin@example.com` / `ChangeMe123!` — **⚠️ MUST be changed before production** (this is the #1 pending security item).
- **Jane Wanjiru** EMP-001 = `d14e23a6-4b96-4700-87a0-ed12a774193d` (this is `$EMP`).
- **Finalized runs:** March 2026 = `59839187-cf37-4b40-a613-145623ba5d1a` (net 65,082.90); August 2026 = `2825b2fd-aac7-40bf-b52b-8cb715065eb3`.
- **Leftover test data on the user's local DB:** ~8 employees named `BANK-*`, `P9-*`, `RPT-*` (from CI verify scripts run locally), all ACTIVE + "Unassigned" department. Harmless, but they inflate the headcount report. Could be cleaned up if desired.

---

## 9. Failed Attempts & Lessons (don't repeat these)

- **Strict-tsconfig CI miss:** verify scripts must compile under the real tsconfig. Caught: Buffer generics mismatch (`exceljs .load()` expects a specific Buffer type — cast via `Parameters<typeof wb.xlsx.load>[0]`), and `.json()` returning `unknown`. Always typecheck under the real config first (§7).
- **Stray test files committed repeatedly** (`logo-check.png`, `apps/salary.*`) — solved with a root `.scratch/` folder (git-ignored wholesale) + broad gitignore patterns. Downloads now go to `$SCRATCH`.
- **Branch divergence on release ×2** — mixing CLI merges + GitHub PRs on `main`. → move to PR-only (§3).
- **`env.sh` SCRATCH path off-by-one** (was `apps/.scratch`) — fixed to repo-root `.scratch` (script is 3 levels deep at `apps/api/scripts`).
- **False-alarm 500s** — almost always "schema changed but server not restarted / not db-pushed," not a code bug. Check that first.

---

## 10. Parked / Skipped

- **P10 (KRA monthly PAYE return)** — PARKED. It's a multi-sheet iTax return: Sheet A (employer), **Sheet B (employee details)**, **Sheet M (AHL)**, Sheet N (summary). Payroll software exports a **CSV imported into `P10_Return.xlsm`** via "IMPORT CSV". Research found the column *semantics* (from KRA's instruction PDF), but the exact **25-column order of Sheet B can't be pinned from public sources + a data-only sample** — and shipping a wrong-order tax CSV fails iTax validation. **Blocker:** need the header row from the real `P10_Return.xlsm` (Sheet B tab). **User currently has no PAYE obligation on their KRA PIN, so cannot download the template.** Resume when they (or a client) can provide the header row. The **AHL M-sheet** is a fully-reconcilable alternative (needs only PIN/name/gross; iTax auto-computes 1.5%) if they want P10 value before the Sheet B headers arrive.
- **Bank-specific template adapters** (per a client's actual bank) — wait until a real client's bank is known; the current EFT adapter matches a representative template and should be validated by a real upload before promising "one-click."

---

## 11. Proposed Next Steps (in recommended order)

1. **Security hardening (RECOMMENDED FIRST).** Force-change the seeded admin password (small, high-impact — it's a live vulnerability: an HRMS full of employee PII with a known default login). Then MFA on local accounts. The local-account path survives even after SSO, so this is needed regardless.
2. **Set up PR-only release flow** + optional `main` branch ruleset requiring CI green (§3). Prevents the release-divergence pain.
3. **OIDC SSO** (roadmap — see §12). The right long-term B2B auth direction, but build it when a **pilot client's IdP is known** (Google Workspace / Microsoft Entra / Okta), not speculatively. It replaces the password check, not the session model.
4. **Leave auto-accrual** — makes the leave module month-to-month useful. Self-contained.
5. **P10** — when iTax template access is available (§10).
6. **Frontend/dashboard** — the reporting JSON endpoints are built to feed one; there's no UI yet.

---

## 12. OIDC SSO Sketch (for when it's time)

**Core idea:** OIDC replaces the password check, NOT the session model. After a successful OIDC login you still mint your own `{sub, org, role}` JWT + refresh, so the rest of the app is unchanged.

- **Config:** single-tenant-per-client = one org = one OIDC provider config per instance (issuer URL, client ID, client secret, allowed email domains) in org settings or env. No multi-tenant IdP juggling.
- **Flow:** "Sign in with [IdP]" → redirect to IdP authorize → IdP authenticates → callback to `/auth/oidc/callback` with code → exchange code for `id_token` at token endpoint → validate JWT (signature via IdP JWKS + issuer/audience/expiry) → extract email/sub.
- **Identity mapping:** match id_token email to an existing Employee/User (safer for HR: only pre-existing employees; JIT provisioning is a policy choice). Keep roles managed in-app, not from IdP claims.
- **Libraries:** `openid-client` via `@nestjs/passport` + `passport-openidconnect`.
- **Keep local password auth as break-glass** (admin/setup) — hence hardening (§11.1) is still needed.
- **OAuth vs OIDC vs SAML:** OAuth 2.0 = authorization/delegation (not authentication). OIDC = authentication layer on OAuth (JWT id_token) — the modern default, JWT-native, fits this stack → **this is the one to use.** SAML = older XML-based enterprise SSO; add it *alongside* OIDC only if a large enterprise client's IT mandates it.

---

## 13. Uploaded Reference Files

These were uploaded during the session (in `/mnt/user-data/uploads/` — **may not persist to the next session**; ask the user to re-upload if needed):
- **`BULK_EFT_RTGS_FILE...xlsx`** — real bank bulk EFT/RTGS template (11 cols: Beneficiary Name, Account Number, Bank Code, Branch Code, Amount, Payment Currency, Payment Type, Debit Account Number, Purpose of payments, Notes to Payee, Email Address). Basis for the EFT adapter. RTGS row uses SWIFT/BIC + empty branch; ACH uses numeric codes.
- **`Sample-CSV-Sheet-B_Employees_Dtls.xlsx`** — KRA P10 Sheet B (employee details), DATA-ONLY (no header row). For future P10. 25 columns; ends identifiable (PIN, name, residential status, primary/secondary, disability, exemption cert … personal relief, insurance relief, self-assessed PAYE), middle columns 8–21 ambiguous.
- **`P9-FORM-Template-2025.xlsx`** — KRA P9A annual tax card. Columns A–O incl. pension lower-of-three (E1=30% of basic, E2=actual, E3=30,000/mo), AHL, SHIF, post-retirement medical (H), owner-occupied interest (I), personal relief (M), insurance relief (N), PAYE (O). Basis for the P9 feature.

---

## 14. Suggested First Message for the Next Session

> "Continuing the Kenyan HRMS build (NestJS 11 + Prisma 7 + PG 17). Read the handoff doc I'm attaching. We're at v0.3.0 (bank export + P9 + reporting shipped, CI-green). I want to start **security hardening — force-change the seeded admin password, then MFA**. Work as lead engineer: reconcile/verify first, build incrementally, one zip per turn, live proof, and compile verify-scripts under the real tsconfig before shipping."

(Attach this document. Then it should investigate the current auth module before proposing the hardening increment.)
