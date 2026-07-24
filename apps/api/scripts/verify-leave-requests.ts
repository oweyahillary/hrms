/**
 * Prove the leave approval flow: step ORDER, rejection, cancellation, and that a
 * balance is only spent when a request is fully approved.
 *
 * This is the control the approver policy sits on top of. verify-leave-approvers
 * proves the right people are CHOSEN; this proves the chain then behaves.
 *
 * WHY THIS SCRIPT TOUCHES PRISMA DIRECTLY: a two-step chain needs two distinct
 * approvers, and nothing in the API creates a user — only scripts/seed.ts does.
 * So the second approver is made the same way the seed makes the first. The
 * fixture is Prisma; every assertion below goes through the HTTP API.
 *
 *   cd apps/api && npx ts-node scripts/verify-leave-requests.ts
 */
import 'dotenv/config';
import { createPrismaClient, baseClientOf } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface Req {
  id: string; status: string; daysRequested: number;
  currentApproverUserId: string | null;
  approvalSteps: Array<{ stepOrder: number; approverUserId: string; status: string }>;
  message?: string | string[];
}

const YEAR = 2036;

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const passwords = new PasswordService();
  const stamp = Date.now();

  const loginAs = async (email: string, password: string): Promise<string> => {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const t = ((await r.json()) as { accessToken?: string }).accessToken;
    if (!t) { console.log(`  FAIL  login as ${email}`); process.exit(1); }
    return t;
  };

  const adminToken = await loginAs('admin@example.com', 'ChangeMe123!');
  const adminAuth = { Authorization: `Bearer ${adminToken}` };
  const adminJson = { ...adminAuth, 'Content-Type': 'application/json' };
  const admin = (await (await fetch(`${BASE}/auth/me`, { headers: adminAuth })).json()) as {
    id: string; organizationId: string;
  };

  // --- second approver, created the way the seed does (no API exists for it)
  //
  // Reuse the ADMIN'S OWN ROLE rather than creating one: it is guaranteed to
  // exist, is already an HR/management role, and inventing a Role here means
  // guessing at a model this script can't typecheck offline.
  const adminRow = (await prisma.user.findFirst({
    where: { id: admin.id }, select: { roleId: true },
  })) as unknown as { roleId: string } | null;
  if (!adminRow) { console.log('  FAIL  could not read the admin user'); process.exit(1); }

  const secondEmail = `approver.${stamp}@example.com`;
  const secondPassword = 'ChangeMe123!';
  // Exactly the fields scripts/seed.ts sets — nothing invented. isActive
  // defaults to true, mustChangePassword to false.
  const second = (await prisma.user.create({
    data: {
      organizationId: admin.organizationId,
      email: secondEmail,
      passwordHash: await passwords.hash(secondPassword),
      roleId: adminRow.roleId,
    },
  })) as unknown as { id: string };
  check('a second approver exists for the chain', Boolean(second.id));

  const secondToken = await loginAs(secondEmail, secondPassword);
  const secondAuth = { Authorization: `Bearer ${secondToken}` };

  // --- policy: let this gate set the chain explicitly, so ORDER is under test
  const policyBefore = (await (await fetch(`${BASE}/organization/leave-approval`, { headers: adminAuth })).json()) as {
    leaveApprovalMode: string; leaveHrApproverUserId: string | null; allowEmployeeChosenApprovers: boolean;
  };
  const setPolicy = (body: Record<string, unknown>) => fetch(`${BASE}/organization/leave-approval`, {
    method: 'PATCH', headers: adminJson, body: JSON.stringify(body),
  });
  await setPolicy({ leaveHrApproverUserId: admin.id, allowEmployeeChosenApprovers: true });

  // --- fixtures
  const employee = ((await (await fetch(`${BASE}/employees`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({
      employeeNumber: `FLOW${stamp}`, firstName: 'Flow', lastName: 'Tester',
      nationalId: `${String(stamp).slice(-8)}`, employmentType: 'PERMANENT', hireDate: '2020-01-01',
    }),
  })).json()) as { id: string }).id;

  const leaveType = ((await (await fetch(`${BASE}/leave-types`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ name: `FlowLeave-${stamp}`, accrualMethod: 'NONE', annualDays: 40 }),
  })).json()) as { id: string }).id;

  const setBalance = (accruedDays: number) => fetch(`${BASE}/leave-balances`, {
    method: 'POST', headers: adminJson,
    body: JSON.stringify({ employeeId: employee, leaveTypeId: leaveType, year: YEAR, accruedDays }),
  });
  await setBalance(40);

  const balanceNow = async (): Promise<{ usedDays: number; availableDays: number }> => {
    const rows = (await (await fetch(
      `${BASE}/leave-balances?employeeId=${employee}&year=${YEAR}`, { headers: adminAuth },
    )).json()) as Array<{ leaveTypeId: string; usedDays: number; availableDays: number }>;
    const b = rows.find((r) => r.leaveTypeId === leaveType);
    return { usedDays: b?.usedDays ?? -1, availableDays: b?.availableDays ?? -1 };
  };

  // All weekdays: a range with no working days is refused before any of this runs.
  // 2036: 3 Mar Mon, 4 Tue, 5 Wed, 6 Thu, 7 Fri, 10 Mon, 11 Tue, 12 Wed.
  const ask = async (from: string, to: string, approvers: string[]): Promise<Req> => {
    const r = await fetch(`${BASE}/leave-requests`, {
      method: 'POST', headers: adminJson,
      body: JSON.stringify({
        employeeId: employee, leaveTypeId: leaveType, startDate: from, endDate: to,
        reason: 'flow gate', approverUserIds: approvers,
      }),
    });
    return (await r.json()) as Req;
  };
  const act = async (id: string, what: 'approve' | 'reject' | 'cancel', headers: Record<string, string>) => {
    const r = await fetch(`${BASE}/leave-requests/${id}/${what}`, { method: 'POST', headers });
    return { status: r.status, body: (await r.json()) as Req };
  };
  const get = async (id: string): Promise<Req> =>
    (await (await fetch(`${BASE}/leave-requests/${id}`, { headers: adminAuth })).json()) as Req;

  // ------------------------------------------------------------------
  // Two-step chain: admin first, then the second approver.
  // ------------------------------------------------------------------
  const two = await ask(`${YEAR}-03-03`, `${YEAR}-03-04`, [admin.id, second.id]);
  check('a two-step chain is created with both approvers',
    two.approvalSteps?.length === 2, JSON.stringify(two.approvalSteps ?? two.message));
  check('the chain keeps the order it was given',
    two.approvalSteps?.[0]?.approverUserId === admin.id
    && two.approvalSteps?.[1]?.approverUserId === second.id,
    JSON.stringify(two.approvalSteps?.map((s) => s.approverUserId)));
  check('the request starts PENDING with step 1 as the current approver',
    two.status === 'PENDING' && two.currentApproverUserId === admin.id,
    `${two.status} / ${two.currentApproverUserId}`);

  // THE ORDER GUARD: step 2 must not be able to jump the queue.
  const jump = await act(two.id, 'approve', secondAuth);
  check('step 2 cannot approve before step 1 (403)', jump.status === 403, `got ${jump.status}`);
  check('the queue-jump changed nothing', (await get(two.id)).status === 'PENDING');

  const usedBefore = (await balanceNow()).usedDays;
  const step1 = await act(two.id, 'approve', adminAuth);
  check('step 1 can approve', step1.status === 200 || step1.status === 201, `got ${step1.status}`);
  check('after step 1 the request is still PENDING — not yet granted',
    step1.body.status === 'PENDING', step1.body.status);
  check('after step 1 the turn passes to step 2',
    step1.body.currentApproverUserId === second.id, String(step1.body.currentApproverUserId));

  // The one that matters most: a half-approved request must not spend the balance.
  const usedMid = (await balanceNow()).usedDays;
  check('an intermediate approval does NOT deduct the balance',
    usedMid === usedBefore, `${usedBefore} -> ${usedMid}`);

  // And step 1 must not be able to approve twice to finish it alone.
  const twice = await act(two.id, 'approve', adminAuth);
  check('step 1 cannot approve a second time to finish the chain alone',
    twice.status === 403, `got ${twice.status}`);

  const step2 = await act(two.id, 'approve', secondAuth);
  check('step 2 approves and the request is APPROVED',
    step2.body.status === 'APPROVED', step2.body.status);
  const usedAfter = (await balanceNow()).usedDays;
  check('the balance is spent only on FINAL approval (2 days)',
    usedAfter === usedBefore + 2, `${usedBefore} -> ${usedAfter}`);
  check('an already-approved request cannot be approved again',
    (await act(two.id, 'approve', secondAuth)).status === 400);

  // ------------------------------------------------------------------
  // Rejection stops the chain dead.
  // ------------------------------------------------------------------
  const rej = await ask(`${YEAR}-03-05`, `${YEAR}-03-05`, [admin.id, second.id]);
  const usedPreReject = (await balanceNow()).usedDays;
  const rejected = await act(rej.id, 'reject', adminAuth);
  check('a rejection at step 1 rejects the whole request',
    rejected.body.status === 'REJECTED', rejected.body.status);
  check('a rejected request never reaches step 2',
    rejected.body.approvalSteps?.[1]?.status === 'PENDING',
    JSON.stringify(rejected.body.approvalSteps?.map((s) => s.status)));
  check('step 2 cannot approve a rejected request',
    (await act(rej.id, 'approve', secondAuth)).status === 400);
  check('a rejection spends nothing', (await balanceNow()).usedDays === usedPreReject);

  // ------------------------------------------------------------------
  // Cancellation.
  // ------------------------------------------------------------------
  const can = await ask(`${YEAR}-03-06`, `${YEAR}-03-06`, [admin.id]);
  const cancelled = await act(can.id, 'cancel', adminAuth);
  check('a pending request can be cancelled', cancelled.body.status === 'CANCELLED', cancelled.body.status);
  check('a cancelled request cannot then be approved',
    (await act(can.id, 'approve', adminAuth)).status === 400);
  check('cancelling spends nothing', (await balanceNow()).usedDays === usedAfter);

  // ------------------------------------------------------------------
  // The inbox only shows what is actually yours to action, now.
  // ------------------------------------------------------------------
  const queued = await ask(`${YEAR}-03-10`, `${YEAR}-03-10`, [admin.id, second.id]);
  const inboxOf = async (headers: Record<string, string>): Promise<string[]> =>
    ((await (await fetch(`${BASE}/leave-requests/inbox`, { headers })).json()) as Req[]).map((r) => r.id);

  check('a new request appears in step 1\'s inbox',
    (await inboxOf(adminAuth)).includes(queued.id));
  check('it does NOT appear in step 2\'s inbox while step 1 is pending',
    !(await inboxOf(secondAuth)).includes(queued.id));
  await act(queued.id, 'approve', adminAuth);
  check('after step 1 approves it moves to step 2\'s inbox',
    (await inboxOf(secondAuth)).includes(queued.id));
  check('and leaves step 1\'s inbox',
    !(await inboxOf(adminAuth)).includes(queued.id));

  // ------------------------------------------------------------------
  // Balance guard still applies to the chain.
  // ------------------------------------------------------------------
  const fresh = (await balanceNow()).availableDays;
  const tooBig = await ask(`${YEAR}-03-11`, `${YEAR}-06-11`, [admin.id]);
  check('a request beyond the available balance is refused',
    !tooBig.id, JSON.stringify(tooBig.message));
  check('the refused request left the balance alone',
    (await balanceNow()).availableDays === fresh);

  // ------------------------------------------------------------------
  // Cross-tenant policy isolation: approvalPolicy() used to read
  // Organization.findFirst() with NO where clause at all — whichever org
  // happened to sort first backed EVERY org's approval resolution. Prove the
  // fix by giving org A and a throwaway org B distinct, deliberately
  // different HR approvers and confirming each org's requests resolve to
  // its OWN approver, never the other's — checked both directions.
  // ------------------------------------------------------------------
  await setPolicy({ leaveApprovalMode: 'DEPT_HEAD_THEN_HR', leaveHrApproverUserId: admin.id, allowEmployeeChosenApprovers: false });

  const base = baseClientOf(prisma) as any;
  const orgB = await base.organization.create({ data: { name: `__leave_policy_probe_${stamp}__` } });
  const roleB = await base.role.create({ data: { organizationId: orgB.id, name: 'Admin', permissions: { all: true } } });
  const orgBAdminEmail = `leavepolicy.b.admin.${stamp}@example.com`;
  const orgBAdminPassword = 'OrgBAdmin123!';
  const orgBAdminUser = await base.user.create({
    data: {
      organizationId: orgB.id, email: orgBAdminEmail,
      passwordHash: await passwords.hash(orgBAdminPassword),
      mustChangePassword: false, roleId: roleB.id,
    },
  });

  let orgBEmpUserId: string | null = null;
  try {
    const tokenBAdmin = await loginAs(orgBAdminEmail, orgBAdminPassword);
    const bJson = { Authorization: `Bearer ${tokenBAdmin}`, 'Content-Type': 'application/json' };
    const bAuth = { Authorization: `Bearer ${tokenBAdmin}` };

    // org B's own HR approver is its own admin — deliberately NOT org A's admin.id.
    await fetch(`${BASE}/organization/leave-approval`, {
      method: 'PATCH', headers: bJson,
      body: JSON.stringify({ leaveApprovalMode: 'HR_ONLY', leaveHrApproverUserId: orgBAdminUser.id, allowEmployeeChosenApprovers: false }),
    });

    const empBRes = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: bJson,
      body: JSON.stringify({
        employeeNumber: `POLICYB-${stamp}`, firstName: 'PolicyProbe', lastName: 'B',
        nationalId: `${String(stamp).slice(-7)}9`, employmentType: 'PERMANENT', hireDate: '2020-01-01',
      }),
    });
    const empB = ((await empBRes.json()) as { id?: string }).id;
    if (!empB) { console.log('  FAIL  org-B employee create'); process.exit(1); }

    const typeBRes = await fetch(`${BASE}/leave-types`, {
      method: 'POST', headers: bJson,
      body: JSON.stringify({ name: `PolicyProbeLeave-${stamp}`, accrualMethod: 'NONE', annualDays: 40 }),
    });
    const typeB = ((await typeBRes.json()) as { id?: string }).id;

    // Preview: org B's own admin resolves as the approver, not org A's.
    const previewB = (await (await fetch(
      `${BASE}/leave-requests/approvers-for?employeeId=${empB}`, { headers: bAuth },
    )).json()) as { approvers: Array<{ userId: string }> };
    check('org B\'s approver preview resolves to ITS OWN HR approver',
      previewB.approvers?.[0]?.userId === orgBAdminUser.id, JSON.stringify(previewB));
    check('org B\'s approver preview does NOT resolve to org A\'s HR approver',
      !previewB.approvers?.some((a) => a.userId === admin.id), JSON.stringify(previewB));

    // Actually create the request (derived chain, no explicit approverUserIds)
    // and confirm the stored LeaveApprovalStep points at org B's own approver.
    const reqBRes = await fetch(`${BASE}/leave-requests`, {
      method: 'POST', headers: bJson,
      body: JSON.stringify({ employeeId: empB, leaveTypeId: typeB, startDate: `${YEAR}-03-03`, endDate: `${YEAR}-03-03`, reason: 'cross-tenant policy probe' }),
    });
    const reqB = (await reqBRes.json()) as Req;
    check('org B\'s leave request resolves its approval chain to org B\'s own HR approver',
      reqB.approvalSteps?.[0]?.approverUserId === orgBAdminUser.id, JSON.stringify(reqB.approvalSteps ?? reqB.message));

    // The other direction: org A's own resolution must be unaffected by org
    // B's policy having just been set (proves this isn't a one-way accident
    // of creation order — the bug was "whichever org sorts first wins").
    const previewA = (await (await fetch(
      `${BASE}/leave-requests/approvers-for?employeeId=${employee}`, { headers: adminAuth },
    )).json()) as { approvers: Array<{ userId: string }> };
    check('org A\'s approver preview still resolves to ITS OWN HR approver after org B\'s policy was set',
      previewA.approvers?.[0]?.userId === admin.id, JSON.stringify(previewA));

    const orgBEmpRow = await base.user.findFirst({ where: { organizationId: orgB.id, email: orgBAdminEmail } });
    orgBEmpUserId = orgBEmpRow?.id ?? null;
  } finally {
    // Organization itself is never deleted once real auth activity (a login,
    // here) has touched it — see verify-self-service.ts / verify-attendance-ui.ts
    // for the same rationale. Everything else is fully cleanable.
    await base.leaveRequest.deleteMany({ where: { organizationId: orgB.id } }).catch(() => undefined);
    await base.leaveType.deleteMany({ where: { organizationId: orgB.id } }).catch(() => undefined);
    const userIds = [orgBAdminUser.id, ...(orgBEmpUserId && orgBEmpUserId !== orgBAdminUser.id ? [orgBEmpUserId] : [])];
    await base.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await base.user.deleteMany({ where: { organizationId: orgB.id } }).catch(() => undefined);
    await base.employee.deleteMany({ where: { organizationId: orgB.id } }).catch(() => undefined);
    await base.role.deleteMany({ where: { organizationId: orgB.id } }).catch(() => undefined);
  }

  // --- restore + tidy up after ourselves
  await setPolicy({
    leaveApprovalMode: policyBefore.leaveApprovalMode,
    leaveHrApproverUserId: policyBefore.leaveHrApproverUserId,
    allowEmployeeChosenApprovers: policyBefore.allowEmployeeChosenApprovers,
  });
  const restored = (await (await fetch(`${BASE}/organization/leave-approval`, { headers: adminAuth })).json()) as {
    allowEmployeeChosenApprovers: boolean;
  };
  check('the org approval policy is restored after the gate',
    restored.allowEmployeeChosenApprovers === policyBefore.allowEmployeeChosenApprovers,
    JSON.stringify(restored.allowEmployeeChosenApprovers));

  // The fixture user has a working login and an HR role, so it can't just be
  // left enabled. But it CAN'T be deleted either: every FK to User is Restrict,
  // including LeaveApprovalStep.approver — and this user has approved things.
  // That's the product's own model, not an obstacle: users are deactivated, not
  // deleted, so history keeps pointing at a real person. Do what the product does.
  await prisma.user.update({ where: { id: second.id }, data: { isActive: false } });
  const after = (await prisma.user.findFirst({
    where: { id: second.id }, select: { isActive: true },
  })) as unknown as { isActive: boolean } | null;
  check('the fixture approver is deactivated', after?.isActive === false, JSON.stringify(after));

  // Deactivation must actually take it out of circulation.
  const stillOffered = ((await (await fetch(`${BASE}/leave-requests/approvers`, { headers: adminAuth })).json()) as Array<{ id: string }>)
    .some((a) => a.id === second.id);
  check('a deactivated approver drops out of the approver list', !stillOffered);

  const relogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: secondEmail, password: secondPassword }),
  });
  check('a deactivated approver can no longer sign in', relogin.status === 401, `got ${relogin.status}`);

  // The approval history still resolves to a real person rather than a dangling id.
  const historic = await get(two.id);
  check('an approved request still names its approvers after deactivation',
    historic.approvalSteps?.some((st) => st.approverUserId === second.id) === true,
    JSON.stringify(historic.approvalSteps?.map((st) => st.approverUserId)));

  await prisma.$disconnect();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
