/**
 * Prove the leave approver policy: approvers are DERIVED, not chosen; the
 * department head applying is signed off by HR alone; and a client cannot
 * bypass the control by posting its own approver list.
 *
 * Self-contained — creates its own department, employees and leave type under a
 * unique tag, and restores the organisation's policy at the end.
 *
 *   cd apps/api && npx ts-node scripts/verify-leave-approvers.ts
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface Preview {
  approvers: Array<{ step: number; userId: string; name: string; role: string }>;
  rule: string;
  explanation: string;
  employeeMayChoose: boolean;
  unresolved: boolean;
}

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) { console.log('  FAIL  login'); process.exit(1); }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };

  const me = (await (await fetch(`${BASE}/auth/me`, { headers: auth })).json()) as { id: string };
  const ADMIN = me.id;
  const stamp = Date.now();

  const original = (await (await fetch(`${BASE}/organization/leave-approval`, { headers: auth })).json()) as {
    leaveApprovalMode: string; leaveHrApproverUserId: string | null; allowEmployeeChosenApprovers: boolean;
  };

  const setPolicy = async (body: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/organization/leave-approval`, {
      method: 'PATCH', headers: authJson, body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  // --- defaults
  check('the default approval mode is department head then HR',
    original.leaveApprovalMode === 'DEPT_HEAD_THEN_HR', original.leaveApprovalMode);
  check('employees may NOT choose their own approvers by default',
    original.allowEmployeeChosenApprovers === false, JSON.stringify(original.allowEmployeeChosenApprovers));

  // --- fixtures
  const dept = ((await (await fetch(`${BASE}/departments`, {
    method: 'POST', headers: authJson, body: JSON.stringify({ name: `Approvals-${stamp}` }),
  })).json()) as { id: string }).id;

  const mkEmp = async (seq: string): Promise<string> => {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeNumber: `APV${stamp}-${seq}`, firstName: 'Apv', lastName: `Person${seq}`,
        nationalId: `${String(stamp).slice(-7)}${seq}`, employmentType: 'PERMANENT',
        hireDate: '2020-01-01', departmentId: dept,
      }),
    });
    const id = ((await r.json()) as { id?: string }).id;
    if (!id) { console.log(`  FAIL  create employee ${seq}`); process.exit(1); }
    return id;
  };
  const member = await mkEmp('1');
  const head = await mkEmp('2');

  // --- department head
  const setHead = await fetch(`${BASE}/departments/${dept}`, {
    method: 'PATCH', headers: authJson, body: JSON.stringify({ headEmployeeId: head }),
  });
  const setHeadBody = (await setHead.json()) as { headEmployeeId?: string };
  check('a department can be given a head', setHeadBody.headEmployeeId === head, JSON.stringify(setHeadBody));

  const badHead = await fetch(`${BASE}/departments/${dept}`, {
    method: 'PATCH', headers: authJson,
    body: JSON.stringify({ headEmployeeId: '00000000-0000-0000-0000-000000000000' }),
  });
  check('a head that does not exist is refused (400)', badHead.status === 400, `got ${badHead.status}`);

  await setPolicy({ leaveApprovalMode: 'DEPT_HEAD_THEN_HR', leaveHrApproverUserId: ADMIN, allowEmployeeChosenApprovers: false });

  const preview = async (employeeId: string): Promise<Preview> =>
    (await (await fetch(`${BASE}/leave-requests/approvers-for?employeeId=${employeeId}`, { headers: auth })).json()) as Preview;

  // --- resolution
  // The head has no login, and an approval step points at a User, so the head
  // cannot approve and HR takes it. This is the real state of the product today:
  // nothing creates user accounts for employees yet.
  const pMember = await preview(member);
  check('a member of a headed department falls back to HR (the head has no login)',
    pMember.rule === 'FALLBACK_HR_NO_DEPT_HEAD', pMember.rule);
  check('the fallback names HR as the sole approver',
    pMember.approvers.length === 1 && pMember.approvers[0].userId === ADMIN,
    JSON.stringify(pMember.approvers));
  check('the preview explains itself in plain English',
    typeof pMember.explanation === 'string' && pMember.explanation.length > 0, pMember.explanation);

  // "If its the dept head applying the hr is the approver alone"
  const pHead = await preview(head);
  check('the department head applying is signed off by HR alone',
    pHead.rule === 'DEPT_HEAD_APPLIES_HR_ALONE', pHead.rule);
  check('the head is not offered as their own approver',
    pHead.approvers.every((a) => a.userId === ADMIN), JSON.stringify(pHead.approvers));

  await setPolicy({ leaveApprovalMode: 'HR_ONLY' });
  check('single layer HR_ONLY resolves to HR', (await preview(member)).rule === 'HR_ONLY');

  await setPolicy({ leaveApprovalMode: 'DEPT_HEAD_ONLY' });
  check('single layer DEPT_HEAD_ONLY with no usable head falls back to HR',
    (await preview(member)).rule === 'FALLBACK_HR_NO_DEPT_HEAD');

  await setPolicy({ leaveApprovalMode: 'DEPT_HEAD_THEN_HR' });

  // --- creating a request
  const leaveType = ((await (await fetch(`${BASE}/leave-types`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ name: `ApvLeave-${stamp}`, accrualMethod: 'NONE', annualDays: 30 }),
  })).json()) as { id: string }).id;

  for (const emp of [member, head]) {
    await fetch(`${BASE}/leave-balances`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ employeeId: emp, leaveTypeId: leaveType, year: 2035, accruedDays: 30 }),
    });
  }

  // Every date here must be a WEEKDAY: a request with no working days is
  // rejected before the approver logic runs, which would quietly turn these
  // into false failures. March 2035: 1 Thu, 2 Fri, 5 Mon, 6 Tue, 7 Wed, 8 Thu.
  const apply = async (employeeId: string, body: Record<string, unknown> = {}, from = '2035-03-02') => {
    const r = await fetch(`${BASE}/leave-requests`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeId, leaveTypeId: leaveType, startDate: from, endDate: from,
        reason: 'approver gate', ...body,
      }),
    });
    return { status: r.status, body: (await r.json()) as {
      message?: string | string[];
      approvalSteps?: Array<{ approverUserId: string; stepOrder: number }>;
    } };
  };

  const noApprovers = await apply(member, {}, '2035-03-02');
  check('a request with NO approverUserIds is accepted — the system decides',
    noApprovers.status === 201 || noApprovers.status === 200,
    `${noApprovers.status} ${JSON.stringify(noApprovers.body.message)}`);
  check('the derived chain is HR',
    noApprovers.body.approvalSteps?.length === 1
    && noApprovers.body.approvalSteps[0].approverUserId === ADMIN,
    JSON.stringify(noApprovers.body.approvalSteps));

  // The control must not be bypassable by posting an approver list directly.
  const smuggled = await apply(member, { approverUserIds: [ADMIN, ADMIN] }, '2035-03-05');
  check('a client-supplied approver list is IGNORED while the opt-out is off',
    (smuggled.status === 201 || smuggled.status === 200)
    && smuggled.body.approvalSteps?.length === 1
    && smuggled.body.approvalSteps[0].approverUserId === ADMIN,
    `${smuggled.status} ${JSON.stringify(smuggled.body.approvalSteps ?? smuggled.body.message)}`);

  // --- the opt-out
  await setPolicy({ allowEmployeeChosenApprovers: true });
  const chosen = await apply(member, { approverUserIds: [ADMIN] }, '2035-03-06');
  check('with the opt-out on, a chosen approver list is honoured',
    (chosen.status === 201 || chosen.status === 200)
    && chosen.body.approvalSteps?.length === 1
    && chosen.body.approvalSteps[0].approverUserId === ADMIN,
    `${chosen.status} ${JSON.stringify(chosen.body.approvalSteps ?? chosen.body.message)}`);
  const stillWorks = await apply(member, {}, '2035-03-07');
  check('with the opt-out on, omitting approvers still derives them',
    stillWorks.body.approvalSteps?.length === 1, JSON.stringify(stillWorks.body.approvalSteps));
  await setPolicy({ allowEmployeeChosenApprovers: false });

  // --- unresolvable
  await setPolicy({ leaveHrApproverUserId: null });
  const orphan = await apply(member, {}, '2035-03-08');
  check('with no HR approver configured, applying is refused (400)',
    orphan.status === 400, `got ${orphan.status}`);
  check('the refusal tells you how to fix it',
    JSON.stringify(orphan.body.message ?? '').toLowerCase().includes('settings'),
    JSON.stringify(orphan.body.message));
  const unresolved = await preview(member);
  check('the preview flags that nothing can be approved', unresolved.unresolved === true,
    JSON.stringify(unresolved.unresolved));

  // --- validation of the setting itself
  await setPolicy({ leaveHrApproverUserId: ADMIN });
  const badMode = await setPolicy({ leaveApprovalMode: 'SOMETHING_ELSE' });
  check('an unknown approval mode is refused (400)', badMode.status === 400, `got ${badMode.status}`);
  const badUser = await setPolicy({ leaveHrApproverUserId: '00000000-0000-0000-0000-000000000000' });
  check('an HR approver that does not exist is refused (400)', badUser.status === 400, `got ${badUser.status}`);

  // --- restore
  await setPolicy({
    leaveApprovalMode: original.leaveApprovalMode,
    leaveHrApproverUserId: original.leaveHrApproverUserId,
    allowEmployeeChosenApprovers: original.allowEmployeeChosenApprovers,
  });
  const restored = (await (await fetch(`${BASE}/organization/leave-approval`, { headers: auth })).json()) as {
    leaveApprovalMode: string;
  };
  check('the organisation policy is restored after the gate',
    restored.leaveApprovalMode === original.leaveApprovalMode, restored.leaveApprovalMode);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
