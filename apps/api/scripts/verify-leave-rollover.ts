/**
 * Prove the carry-over lifecycle end to end: year-end rollover (cap, expiry,
 * idempotency, exited staff), and the two places expiry changes what people see
 * and what they're allowed to book.
 *
 * Self-contained: creates its own leave types and employees with a unique tag,
 * and asserts on those rows only — never on org-wide totals — so it survives
 * whatever else is already in the database.
 *
 *   cd apps/api && npx ts-node scripts/verify-leave-rollover.ts
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface Balance {
  employeeId: string; leaveTypeId: string; year: number;
  accruedDays: number; usedDays: number; carriedOverDays: number; availableDays: number;
}

// A year far enough back that nothing else in the fixture data touches it.
const FROM_YEAR = 2031;
const TO_YEAR = FROM_YEAR + 1;

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) { console.log('  FAIL  login'); process.exit(1); }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };

  const stamp = Date.now();

  // --- leave types with different carry-over policies
  const mkType = async (
    name: string, carryOverMax: number | null, carryOverExpiryMonths: number | null,
  ): Promise<string> => {
    const body: Record<string, unknown> = {
      name: `${name}-${stamp}`, accrualMethod: 'NONE', annualDays: 21,
    };
    if (carryOverMax !== null) body.carryOverMax = carryOverMax;
    if (carryOverExpiryMonths !== null) body.carryOverExpiryMonths = carryOverExpiryMonths;
    const r = await fetch(`${BASE}/leave-types`, {
      method: 'POST', headers: authJson, body: JSON.stringify(body),
    });
    const out = (await r.json()) as { id?: string; message?: unknown };
    if (!out.id) { console.log(`  FAIL  create leave type ${name} — ${JSON.stringify(out.message)}`); process.exit(1); }
    return out.id;
  };

  const capped = await mkType('RollCapped', 5, null);      // at most 5 days carry
  const unlimited = await mkType('RollUnlimited', null, null); // everything carries
  const noCarry = await mkType('RollNone', 0, null);        // nothing carries
  const expiring = await mkType('RollExpiring', null, 3);   // lapses 1 Apr

  // --- employees
  const mkEmp = async (seq: string, status: 'ACTIVE' | 'EXITED'): Promise<string> => {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeNumber: `ROLL${stamp}-${seq}`, firstName: 'Roll', lastName: `Over${seq}`,
        nationalId: `${String(stamp).slice(-7)}${seq}`,
        employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const id = ((await r.json()) as { id?: string }).id;
    if (!id) { console.log(`  FAIL  create employee ${seq}`); process.exit(1); }
    if (status === 'EXITED') {
      await fetch(`${BASE}/employees/${id}/terminate`, {
        method: 'POST', headers: authJson, body: JSON.stringify({ exitDate: `${FROM_YEAR}-11-30` }),
      });
    }
    return id;
  };

  const active = await mkEmp('1', 'ACTIVE');
  const leaver = await mkEmp('2', 'EXITED');

  /**
   * Seed a balance. NOTE: the upsert API has no usedDays — days used only move
   * through approved leave requests. So fixtures express "what's left" directly
   * as accruedDays. The used/carried consumption order is covered by the pure
   * unit tests in leave-math; this gate is about the database path.
   */
  const setBal = async (
    employeeId: string, leaveTypeId: string, year: number,
    accruedDays: number, carriedOverDays = 0,
  ) => {
    const r = await fetch(`${BASE}/leave-balances`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ employeeId, leaveTypeId, year, accruedDays, carriedOverDays }),
    });
    if (!r.ok) {
      console.log(`  FAIL  seed balance — ${r.status} ${JSON.stringify(await r.json())}`);
      process.exit(1);
    }
  };

  const getBal = async (employeeId: string, year: number): Promise<Balance[]> => {
    const r = await fetch(`${BASE}/leave-balances?employeeId=${employeeId}&year=${year}`, { headers: auth });
    const body = (await r.json()) as { data?: Balance[] } | Balance[];
    return Array.isArray(body) ? body : (body.data ?? []);
  };
  const find = (rows: Balance[], typeId: string): Balance | undefined =>
    rows.find((b) => b.leaveTypeId === typeId);

  // 9 days left at year end, under three different policies.
  await setBal(active, capped, FROM_YEAR, 9);
  await setBal(active, unlimited, FROM_YEAR, 9);
  await setBal(active, noCarry, FROM_YEAR, 9);
  // Expiring type: 21 accrued plus 5 carried in from the year before, with a
  // 3-month expiry. Those 5 lapsed on 1 Apr of FROM_YEAR and were never used,
  // so only the 21 should reach the new year — the lapsed days must not rise
  // from the dead and carry a second time.
  await setBal(active, expiring, FROM_YEAR, 21, 5);
  // The leaver has days left, but must not be carried.
  await setBal(leaver, unlimited, FROM_YEAR, 21);

  const runRollover = async (fromYear: number) => {
    const r = await fetch(`${BASE}/leave/rollover/run`, {
      method: 'POST', headers: authJson, body: JSON.stringify({ fromYear }),
    });
    return { status: r.status, body: (await r.json()) as Record<string, number> };
  };

  const first = await runRollover(FROM_YEAR);
  check('rollover runs', first.status === 201 || first.status === 200, `got ${first.status}`);
  check('rollover reports the target year', first.body.toYear === TO_YEAR, JSON.stringify(first.body.toYear));

  const after = await getBal(active, TO_YEAR);

  const cappedBal = find(after, capped);
  check('carry-over is capped at carryOverMax (9 remaining, cap 5 -> 5)',
    cappedBal?.carriedOverDays === 5, JSON.stringify(cappedBal?.carriedOverDays));

  const unlimitedBal = find(after, unlimited);
  check('null carryOverMax carries everything (9 -> 9)',
    unlimitedBal?.carriedOverDays === 9, JSON.stringify(unlimitedBal?.carriedOverDays));

  const noCarryBal = find(after, noCarry);
  check('carryOverMax 0 carries nothing (no row, or 0)',
    noCarryBal === undefined || noCarryBal.carriedOverDays === 0,
    JSON.stringify(noCarryBal?.carriedOverDays));

  const expiringBal = find(after, expiring);
  check('carry-over that lapsed during the year is not carried again (21 survives)',
    expiringBal?.carriedOverDays === 21, JSON.stringify(expiringBal?.carriedOverDays));

  check('a new balance starts with zero accrual — rollover does not grant leave',
    unlimitedBal?.accruedDays === 0, JSON.stringify(unlimitedBal?.accruedDays));
  check('a carried balance is immediately available',
    unlimitedBal?.availableDays === 9, JSON.stringify(unlimitedBal?.availableDays));

  const leaverAfter = await getBal(leaver, TO_YEAR);
  check('an exited employee gets no carry-over', leaverAfter.length === 0, `got ${leaverAfter.length} rows`);

  // --- idempotency: the whole point of SET rather than INCREMENT
  const second = await runRollover(FROM_YEAR);
  const afterTwice = await getBal(active, TO_YEAR);
  check('running rollover twice does not double the carry-over',
    find(afterTwice, unlimited)?.carriedOverDays === 9,
    JSON.stringify(find(afterTwice, unlimited)?.carriedOverDays));
  check('the second run reports nothing created',
    second.body.created === 0, JSON.stringify(second.body.created));
  check('the second run reports rows unchanged',
    second.body.unchanged > 0, JSON.stringify(second.body.unchanged));

  // --- rollover must not disturb next year's accrual or usage
  await setBal(active, unlimited, TO_YEAR, 10, 9);
  const third = await runRollover(FROM_YEAR);
  check('re-running rollover after accrual is still clean', third.status === 201 || third.status === 200);
  const preserved = find(await getBal(active, TO_YEAR), unlimited);
  check('rollover leaves next year\'s accruedDays alone',
    preserved?.accruedDays === 10, JSON.stringify(preserved?.accruedDays));
  check('rollover still sets the carried figure',
    preserved?.carriedOverDays === 9, JSON.stringify(preserved?.carriedOverDays));
  check('the carried days show up as available (10 accrued + 9 carried)',
    preserved?.availableDays === 19, JSON.stringify(preserved?.availableDays));

  // --- a year with nothing in it is a no-op, not a crash
  const empty = await runRollover(2039);
  check('a year with no balances is a clean no-op',
    (empty.status === 201 || empty.status === 200) && empty.body.created === 0,
    JSON.stringify(empty.body));

  // --- expiry as the BALANCE DISPLAY sees it
  // A past year, so "already expired" is true regardless of when CI runs.
  const PAST = 2020;
  await setBal(active, expiring, PAST, 3, 5); // 3 accrued + 5 carried, lapsed 2020-03-31
  const pastRows = await getBal(active, PAST);
  const pastBal = find(pastRows, expiring) as (Balance & {
    carryOverExpiresOn: string | null; expiringDays: number; expiredDays: number;
  }) | undefined;
  check('expired carried days drop out of availableDays (3 accrued survive)',
    pastBal?.availableDays === 3, JSON.stringify(pastBal?.availableDays));
  check('carriedOverDays still reports what was carried (history is not rewritten)',
    pastBal?.carriedOverDays === 5, JSON.stringify(pastBal?.carriedOverDays));
  check('the balance reports the last usable date, not the internal lapse instant',
    pastBal?.carryOverExpiresOn === `${PAST}-03-31`, JSON.stringify(pastBal?.carryOverExpiresOn));
  check('expiredDays reports the 5 days lost', pastBal?.expiredDays === 5, JSON.stringify(pastBal?.expiredDays));
  check('expiringDays is 0 once they have already lapsed',
    pastBal?.expiringDays === 0, JSON.stringify(pastBal?.expiringDays));

  // A type with no expiry policy must be unaffected by any of this.
  await setBal(active, unlimited, PAST, 3, 5);
  const noExpiryBal = find(await getBal(active, PAST), unlimited) as (Balance & {
    carryOverExpiresOn: string | null; expiredDays: number;
  }) | undefined;
  check('a type with no expiry policy keeps its carried days for ever',
    noExpiryBal?.availableDays === 8, JSON.stringify(noExpiryBal?.availableDays));
  check('no expiry policy reports no expiry date',
    noExpiryBal?.carryOverExpiresOn === null, JSON.stringify(noExpiryBal?.carryOverExpiresOn));
  check('no expiry policy loses nothing', noExpiryBal?.expiredDays === 0, JSON.stringify(noExpiryBal?.expiredDays));

  // --- expiry as the REQUEST GUARD sees it (judged at the leave START date)
  // GET /auth/me returns { id, email, role, organizationId, ... } — `id` is the user id.
  const me = (await (await fetch(`${BASE}/auth/me`, { headers: auth })).json()) as { id?: string };
  const approverId = me.id ?? '';
  check('resolved an approver user id for the request tests', Boolean(approverId), JSON.stringify(me));

  // Approvers are DERIVED from the organisation's policy now, so nothing can be
  // requested until an HR approver is configured. Save the current policy, set
  // one for the duration, and put it back at the end — this gate is about
  // carry-over, and must not leave the org's approval settings changed.
  const policyBefore = (await (await fetch(`${BASE}/organization/leave-approval`, { headers: auth })).json()) as {
    leaveApprovalMode: string; leaveHrApproverUserId: string | null; allowEmployeeChosenApprovers: boolean;
  };
  const setPolicy = (body: Record<string, unknown>) => fetch(`${BASE}/organization/leave-approval`, {
    method: 'PATCH', headers: authJson, body: JSON.stringify(body),
  });
  await setPolicy({ leaveHrApproverUserId: approverId });

  // The approver picker: without it, a UI can't build a leave request at all.
  const approversRes = await fetch(`${BASE}/leave-requests/approvers`, { headers: auth });
  const approvers = (await approversRes.json()) as Array<{ id: string; name: string; role: string }>;
  check('approvers endpoint returns options', Array.isArray(approvers) && approvers.length > 0,
    JSON.stringify(approvers).slice(0, 120));
  check('the signed-in admin is offered as an approver',
    approvers.some((a) => a.id === approverId), JSON.stringify(approvers.map((a) => a.name)));
  check('approver options carry a name and a role, and no email field',
    approvers.every((a) => typeof a.name === 'string' && a.name.length > 0
      && typeof a.role === 'string' && !('email' in a)),
    JSON.stringify(approvers[0]));

  const askLeave = async (leaveTypeId: string, startDate: string, endDate: string) => {
    const r = await fetch(`${BASE}/leave-requests`, {
      method: 'POST', headers: authJson,
      // No approverUserIds: the system derives them from org policy.
      body: JSON.stringify({
        employeeId: active, leaveTypeId, startDate, endDate, reason: 'rollover gate',
      }),
    });
    return { status: r.status, body: (await r.json()) as { message?: string | string[]; id?: string } };
  };

  // Balance for a year whose carry-over lapses on 31 March: 0 accrued, 5 carried.
  const GUARD_YEAR = 2033;
  await setBal(active, expiring, GUARD_YEAR, 0, 5);

  // Leave STARTING before the lapse date can spend the carried days.
  const before = await askLeave(expiring, `${GUARD_YEAR}-03-01`, `${GUARD_YEAR}-03-05`);
  check('leave starting before the carry-over lapses is allowed',
    before.status === 201 || before.status === 200, `${before.status} ${JSON.stringify(before.body.message)}`);

  // The same leave STARTING after the lapse date cannot — the days are gone by
  // the time it's taken, even though the balance row still shows 5 carried.
  const after2 = await askLeave(expiring, `${GUARD_YEAR}-06-01`, `${GUARD_YEAR}-06-05`);
  check('leave starting after the carry-over lapses is refused (400)',
    after2.status === 400, `got ${after2.status}`);
  check('the refusal explains that the carried days had to be used by the expiry date',
    JSON.stringify(after2.body.message ?? '').includes(`${GUARD_YEAR}-03-31`),
    JSON.stringify(after2.body.message));

  // The request response must be readable without a second lookup.
  check('an allowed request carries the employee name, not just an id',
    (before.body as unknown as { employeeName?: string }).employeeName === 'Roll Over1',
    JSON.stringify((before.body as unknown as { employeeName?: string }).employeeName));
  check('an allowed request carries the employee number',
    (before.body as unknown as { employeeNumber?: string }).employeeNumber === `ROLL${stamp}-1`,
    JSON.stringify((before.body as unknown as { employeeNumber?: string }).employeeNumber));

  // A type with no expiry is unaffected: same dates, allowed.
  await setBal(active, unlimited, GUARD_YEAR, 0, 5);
  const noExpiryReq = await askLeave(unlimited, `${GUARD_YEAR}-06-01`, `${GUARD_YEAR}-06-05`);
  check('with no expiry policy the same late leave is allowed',
    noExpiryReq.status === 201 || noExpiryReq.status === 200,
    `${noExpiryReq.status} ${JSON.stringify(noExpiryReq.body.message)}`);

  await setPolicy({
    leaveApprovalMode: policyBefore.leaveApprovalMode,
    leaveHrApproverUserId: policyBefore.leaveHrApproverUserId,
    allowEmployeeChosenApprovers: policyBefore.allowEmployeeChosenApprovers,
  });
  const policyAfter = (await (await fetch(`${BASE}/organization/leave-approval`, { headers: auth })).json()) as {
    leaveHrApproverUserId: string | null;
  };
  check('the org approval policy is restored after the gate',
    policyAfter.leaveHrApproverUserId === policyBefore.leaveHrApproverUserId,
    JSON.stringify(policyAfter.leaveHrApproverUserId));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
