/**
 * Pure approval-chain logic. Steps are approved in ascending stepOrder; the
 * "current" step is the lowest-ordered one still PENDING.
 */
export interface ApprovalStepLike {
  stepOrder: number;
  approverUserId: string;
  status: string; // 'PENDING' | 'APPROVED' | 'REJECTED'
}

/** The step awaiting action, or null if none are pending. */
export function currentPendingStep<T extends ApprovalStepLike>(steps: readonly T[]): T | null {
  const pending = steps
    .filter((s) => s.status === 'PENDING')
    .sort((a, b) => a.stepOrder - b.stepOrder);
  return pending[0] ?? null;
}

/** True if `step` is the highest-ordered step (approving it finalises the request). */
export function isLastStep(steps: readonly ApprovalStepLike[], step: ApprovalStepLike): boolean {
  if (steps.length === 0) return false;
  const maxOrder = Math.max(...steps.map((s) => s.stepOrder));
  return step.stepOrder === maxOrder;
}

/** True if the request currently awaits THIS user's approval. */
export function awaitsApprovalBy(steps: readonly ApprovalStepLike[], userId: string): boolean {
  const cur = currentPendingStep(steps);
  return !!cur && cur.approverUserId === userId;
}
