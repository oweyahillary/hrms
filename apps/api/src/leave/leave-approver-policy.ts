/**
 * Who approves a leave request.
 *
 * Approvers are DERIVED from the organisation's policy, not chosen by the person
 * applying — someone selecting who signs off their own leave is a control
 * weakness. (An organisation can opt out via allowEmployeeChosenApprovers, but
 * that's an explicit decision, not the default.)
 *
 * The rules:
 *   - The department head applying     -> HR alone. A head can't be their own approver.
 *   - DEPT_HEAD_THEN_HR (default)      -> department head, then HR, in that order.
 *   - HR_ONLY                          -> HR.
 *   - DEPT_HEAD_ONLY                   -> the department head.
 *
 * Two invariants hold no matter what:
 *   1. NOBODY EVER APPROVES THEIR OWN LEAVE. The applicant is stripped from the
 *      chain last, after every other rule has run.
 *   2. The chain is de-duplicated but keeps its order, so one person holding two
 *      roles approves once rather than twice.
 *
 * Pure — no I/O — so the policy can be reasoned about and tested on its own.
 */

export type LeaveApprovalMode = 'DEPT_HEAD_THEN_HR' | 'HR_ONLY' | 'DEPT_HEAD_ONLY';

export const LEAVE_APPROVAL_MODES: readonly LeaveApprovalMode[] = [
  'DEPT_HEAD_THEN_HR', 'HR_ONLY', 'DEPT_HEAD_ONLY',
];

export interface ApproverInputs {
  mode: LeaveApprovalMode;
  /** Employee the leave is for. */
  applicantEmployeeId: string;
  /** That employee's login, or null if they have none. */
  applicantUserId: string | null;
  /** Head of the applicant's department, or null (no department, or no head). */
  departmentHeadEmployeeId: string | null;
  /**
   * The head's login. Null if the head has no user account — an approval step
   * points at a User, so a head without a login simply cannot approve.
   */
  departmentHeadUserId: string | null;
  /** The configured HR approver's login. */
  hrApproverUserId: string | null;
}

export type ApproverRule =
  /** The applicant heads their own department, so HR signs off alone. */
  | 'DEPT_HEAD_APPLIES_HR_ALONE'
  | 'DEPT_HEAD_THEN_HR'
  | 'HR_ONLY'
  | 'DEPT_HEAD_ONLY'
  /** Wanted a department head but there isn't a usable one; HR takes it. */
  | 'FALLBACK_HR_NO_DEPT_HEAD';

export interface ResolvedApprovers {
  /** Ordered approver user ids. EMPTY means nobody can approve — the caller must refuse. */
  approverUserIds: string[];
  /** Which rule produced this, for explaining it in the UI and in errors. */
  rule: ApproverRule;
}

export function resolveApprovers(i: ApproverInputs): ResolvedApprovers {
  const build = (chain: Array<string | null>, rule: ApproverRule): ResolvedApprovers => {
    const present = chain.filter((id): id is string => Boolean(id));
    // De-dupe first so order survives (Set keeps insertion order), then remove
    // the applicant. Stripping self LAST is what makes invariant 1 unconditional.
    const unique = [...new Set(present)];
    return { approverUserIds: unique.filter((id) => id !== i.applicantUserId), rule };
  };

  const headUser = i.departmentHeadUserId;
  const applicantHeadsDept = i.departmentHeadEmployeeId != null
    && i.departmentHeadEmployeeId === i.applicantEmployeeId;

  // A head can't approve their own leave, so HR takes it — whatever the mode.
  if (applicantHeadsDept) return build([i.hrApproverUserId], 'DEPT_HEAD_APPLIES_HR_ALONE');

  if (i.mode === 'HR_ONLY') return build([i.hrApproverUserId], 'HR_ONLY');

  if (i.mode === 'DEPT_HEAD_ONLY') {
    return headUser
      ? build([headUser], 'DEPT_HEAD_ONLY')
      : build([i.hrApproverUserId], 'FALLBACK_HR_NO_DEPT_HEAD');
  }

  // DEPT_HEAD_THEN_HR
  return headUser
    ? build([headUser, i.hrApproverUserId], 'DEPT_HEAD_THEN_HR')
    : build([i.hrApproverUserId], 'FALLBACK_HR_NO_DEPT_HEAD');
}

/** Plain-English explanation of a resolution, for the apply screen. */
export function describeRule(rule: ApproverRule): string {
  switch (rule) {
    case 'DEPT_HEAD_APPLIES_HR_ALONE':
      return 'You head this department, so HR approves this directly.';
    case 'DEPT_HEAD_THEN_HR':
      return 'Your department head approves first, then HR.';
    case 'HR_ONLY':
      return 'HR approves this.';
    case 'DEPT_HEAD_ONLY':
      return 'Your department head approves this.';
    case 'FALLBACK_HR_NO_DEPT_HEAD':
      return 'This department has no head who can approve, so HR approves it.';
    default:
      return '';
  }
}
