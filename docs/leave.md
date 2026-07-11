# Leave & public holidays

Leave types, per-employee balances, public holidays, and leave requests routed
through an ordered multi-step approval chain.

## Balances

A balance is per `(employee, leaveType, year)`. HR upserts `accruedDays` and
`carriedOverDays`; `usedDays` is owned by the approval flow (never hand-set).
Reads expose `availableDays = accrued + carriedOver − used`.

## Requests & the approval chain

`POST /api/leave-requests` with `{ employeeId, leaveTypeId, startDate, endDate,
reason?, approverUserIds[] }`. On creation the server:
1. Enforces self-service — a non-HR caller may only request for their own linked
   employee; HR/Admin may file for anyone.
2. Computes `daysRequested` = **working days** in the range, excluding weekends
   and any `public_holidays` that fall inside it.
3. If a balance exists for that type/year, rejects the request when it exceeds
   `availableDays` (no balance configured ⇒ no enforcement).
4. Creates the request `PENDING` with one `LeaveApprovalStep` per approver, in
   the given order.

Approvers act **in turn** (lowest `stepOrder` still pending is the current one):
- `POST /api/leave-requests/:id/approve` — only the current approver may act. If
  it's the last step, the request becomes `APPROVED` and the balance's
  `usedDays` is incremented by `daysRequested`.
- `POST /api/leave-requests/:id/reject` — sets the request `REJECTED`; no
  deduction.
- `POST /api/leave-requests/:id/cancel` — requester or HR, while still pending.
- `GET /api/leave-requests/inbox` — requests currently awaiting *your* approval.
- `GET /api/leave-requests` — HR sees all (filter `employeeId`, `status`);
  others see only their own.

## Endpoints (management = Admin / HR Manager / HR Officer)

- Leave types: `POST/GET/GET :id/PATCH/DELETE /api/leave-types` (writes managed)
- Balances: `POST /api/leave-balances` (upsert, managed), `GET /api/leave-balances?employeeId=&year=`
- Public holidays: `POST/GET/PATCH/DELETE /api/public-holidays` (`?year=` filter; writes managed)
- Requests: see above (any authenticated user; rules enforced in the service)

## Known limitations (Phase 1)

- Approval writes are sequential, each individually audited; making the final
  approval + balance deduction a single DB transaction is a hardening item.
- No auto-accrual yet (HR sets balances); monthly accrual can be added later.

## Verified

- Working-days + balance math: 10/10 unit tests.
- Approval-chain logic (turn order, inbox, last-step): 9/9 unit tests.
- Full app compiles; DI-boots with all leave services resolving.
- Live: types/holidays/balances proven; request→approve→deduct is the Step-2
  acceptance test.
