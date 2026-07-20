# Severance calculator

Computes an employee's statutory exit entitlements under the Employment Act 2007:
redundancy severance (§40) and notice / pay in lieu of notice (§35). Pure math
lives in `apps/api/src/severance/severance-math.ts` (unit-tested via `node:test`);
the service (`severance.service.ts`) loads the employee's basic salary, runs the
math, layers on a **provisional** PAYE figure, and persists a full audit trail.

## What it implements (verified)

**Severance pay** — `15 days' pay × completed years of service`, and **only** when
the exit reason is `REDUNDANCY`. Every other reason (`RESIGNATION`, `TERMINATION`,
`RETIREMENT`) returns `0` — but the zero is *reported* in the breakdown with a
reason line and the years it would have used, never silently omitted.

- **"Completed year"** — a partial final year does **not** count. Service is
  floored to whole anniversaries reached on/before the exit date
  (`completedYearsOfService`). Proven by unit test and the CI gate: hired
  2019‑07‑15, exiting 2024‑06‑30 = **4** completed years, not 5.
- **A day's pay** — `basic salary ÷ DAYS_PER_MONTH`, with `DAYS_PER_MONTH = 30`.
  See the assumption note below.

**Notice period (§35)** — statutory minimum by pay frequency:

| Pay frequency | Statutory notice |
|---|---|
| Daily | none (0 days) |
| Weekly | 7 days (one pay period) |
| Bi‑weekly | 14 days (one pay period) |
| Monthly or longer | 28 days |

The calculator takes the **greater** of the statutory minimum and any
`contractualNoticeDays` supplied — a longer contractual notice overrides the
statutory figure, and a shorter one never lowers the statutory floor. Pay in
lieu = `applied notice days × a day's pay`.

**Audit trail** — `calculationBreakdown` (JSON) stores every input and
intermediate: basic salary used, daily rate, days-per-month divisor, completed
years, the severance formula string and result, statutory vs contractual vs
applied notice days and the basis chosen, pay in lieu, the provisional PAYE
block, and totals. A disputed payout can be reconstructed by hand:
`dailyRate × 15 × completedYears == severanceAmount`.

## The day's-pay divisor — an organisation setting

`a day's pay = basic salary ÷ days-per-month`, and the days-per-month is an
**organisation-level setting** (`Organization.severanceDayRateBasis`), not a
fixed constant:

| Basis | Divisor | Meaning |
|---|---|---|
| `CALENDAR_30` (default) | 30 | calendar days — the common convention, giving the widely-cited "half a month per completed year" |
| `WORKING_26` | 26 | working days |

The Employment Act fixes severance at "fifteen days' pay per completed year" but
never defines a day's pay from a monthly wage, so the two readings above both
exist. HR sets the basis under **Settings → Payroll** (`/settings/payroll`);
`GET`/`PATCH /organization/payroll-settings` back it. The default remains 30, so
existing behaviour is unchanged unless the setting is moved to 26.

**The basis is snapshotted per calculation.** The divisor actually used is stored
in `calculationBreakdown.daysPerMonth` (and flows through `dailyRate`) at
calculation time. Editing the org setting later therefore affects only *new*
calculations — it never retroactively changes a severance figure already worked
out and saved. This is covered by the `verify-severance.ts` gate (a calculation
made under 30 keeps its value after the org is switched to 26).

## ⚠️ TODO — PAYE treatment of the severance lump sum (UNVERIFIED)

**Do not trust the PAYE figure for a real payout without direct KRA guidance.**

The tax treatment of a severance/redundancy lump sum is **not** settled between
the sources available, specifically:

- whether the lump sum is **spread back across the years of service** for PAYE
  (so it is taxed at lower marginal bands rather than all in the exit month), and
- whether any **exemption threshold** applies to redundancy/severance pay.

Because the sources disagree, we deliberately do **not** hardcode a spreading
rule or an exemption number. As an interim, the service taxes the **full gross
severance** as ordinary taxable income for the exit month, using the standard
PAYE bands and personal relief only — **no spreading, no exemption**, and none of
the monthly statutory deductions (NSSF/SHIF/AHL), which do not apply to a lump
sum. The breakdown records this under `paye.status = "PROVISIONAL_UNVERIFIED"`.

**Before this is used for an actual payout:** obtain KRA's position on spreading
and exemptions, then implement it in `SeveranceService.provisionalPaye` (and
update this section). Until then, treat the PAYE line as indicative only; the
**gross** severance entitlement is the defensible figure.

## Out of scope (this pass)

Accrued-leave payout, final salary proration, and any gratuity/pension on
retirement are not part of the severance calculation. `totals.grossExitPay`
(severance + notice pay in lieu) is informational only.

## API

- `POST /employees/:employeeId/severance-calculations` — body:
  `{ reason, exitDate, payFrequency, contractualNoticeDays? }` (HR roles).
- `GET /employees/:employeeId/severance-calculations` — history for an employee.
- `GET /severance-calculations/:id` — a single calculation.

Basic salary is taken from the salary structure **in force on the exit date**.
