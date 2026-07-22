/**
 * Pure report aggregation — no I/O, no Nest, no Prisma. The service fetches raw
 * rows (tenant-scoped) and hands them here; these functions derive the figures
 * and totals. Kept pure so the real logic (loan-book installments/exposure, the
 * severance PAYE-flagging) is unit-testable in isolation.
 */
import { nextInstallment } from '../loans/loan-math';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Loan book ──────────────────────────────────────────────────────────────
export interface LoanBookInput {
  id: string;
  employeeId: string;
  type: string; // 'LOAN' | 'ADVANCE'
  status: string; // 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  principal: number;
  balance: number;
  installmentAmount: number;
  disbursedDate: string;
  reason: string | null;
}
export interface LoanBookRow extends LoanBookInput {
  installmentsRemaining: number;
  nextDueAmount: number;
}
export interface LoanBook {
  rows: LoanBookRow[];
  totals: {
    count: number;
    totalPrincipal: number;
    /** Sum of balances on ACTIVE loans/advances — the outstanding staff-loan exposure. */
    totalOutstanding: number;
    byStatus: Record<string, number>;
  };
}

/**
 * installmentsRemaining = whole installments still needed to clear the balance
 * (only meaningful while ACTIVE; a completed/cancelled loan has none due).
 * nextDueAmount = what the next payroll run would take (capped at the balance).
 */
export function buildLoanBook(loans: LoanBookInput[]): LoanBook {
  const rows: LoanBookRow[] = loans.map((l) => {
    const active = l.status === 'ACTIVE';
    const balance = round2(l.balance);
    const installmentsRemaining =
      active && balance > 0 && l.installmentAmount > 0 ? Math.ceil(balance / l.installmentAmount) : 0;
    const nextDueAmount = active ? nextInstallment(balance, l.installmentAmount) : 0;
    return { ...l, balance, installmentsRemaining, nextDueAmount };
  });

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  return {
    rows,
    totals: {
      count: rows.length,
      totalPrincipal: round2(rows.reduce((t, r) => t + r.principal, 0)),
      totalOutstanding: round2(rows.filter((r) => r.status === 'ACTIVE').reduce((t, r) => t + r.balance, 0)),
      byStatus,
    },
  };
}

// ── Severance register ─────────────────────────────────────────────────────
export interface SeveranceCalcInput {
  id: string;
  employeeId: string;
  exitDate: string;
  reason: string;
  severanceAmount: number;
  noticePeriodDays: number;
  calculationBreakdown: unknown;
}
export interface SeveranceRegisterRow {
  id: string;
  employeeId: string;
  exitDate: string;
  reason: string;
  completedYears: number | null;
  severanceAmount: number;
  noticeDays: number;
  noticePayInLieu: number | null;
  payeStatus: string;
  /** True for PROVISIONAL_UNVERIFIED PAYE — the flag an auditor must see, not bury. */
  provisional: boolean;
  /** Which KRA spreading bucket was applied (audit: which rule was used). */
  bucket: string | null;
}
export interface SeveranceRegister {
  rows: SeveranceRegisterRow[];
  totals: {
    count: number;
    totalSeverance: number;
    totalNoticePayInLieu: number;
    /** How many rows carry an unverified provisional PAYE figure. */
    provisionalCount: number;
  };
}

/** Safely dig a nested value out of the stored (unknown-shaped) breakdown JSON. */
function dig(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function severanceRegisterRow(calc: SeveranceCalcInput): SeveranceRegisterRow {
  const b = calc.calculationBreakdown;
  const completedYears = dig(b, 'severance', 'completedYears');
  const payInLieu = dig(b, 'notice', 'payInLieu');
  const payeStatusRaw = dig(b, 'paye', 'status');
  const payeStatus = typeof payeStatusRaw === 'string' ? payeStatusRaw : 'UNKNOWN';
  const bucketRaw = dig(b, 'paye', 'bucket');
  return {
    id: calc.id,
    employeeId: calc.employeeId,
    exitDate: calc.exitDate,
    reason: calc.reason,
    completedYears: typeof completedYears === 'number' ? completedYears : null,
    severanceAmount: round2(calc.severanceAmount),
    noticeDays: calc.noticePeriodDays,
    noticePayInLieu: typeof payInLieu === 'number' ? round2(payInLieu) : null,
    payeStatus,
    provisional: payeStatus === 'PROVISIONAL_UNVERIFIED',
    bucket: typeof bucketRaw === 'string' ? bucketRaw : null,
  };
}

export function buildSeveranceRegister(calcs: SeveranceCalcInput[]): SeveranceRegister {
  const rows = calcs.map(severanceRegisterRow);
  return {
    rows,
    totals: {
      count: rows.length,
      totalSeverance: round2(rows.reduce((t, r) => t + r.severanceAmount, 0)),
      totalNoticePayInLieu: round2(rows.reduce((t, r) => t + (r.noticePayInLieu ?? 0), 0)),
      provisionalCount: rows.filter((r) => r.provisional).length,
    },
  };
}

// ── Adjustments register ────────────────────────────────────────────────────
export interface AdjustmentRegisterInput {
  id: string;
  employeeId: string;
  type: string; // 'BONUS' | 'DEDUCTION'
  amount: number;
  isTaxable: boolean;
  reason: string;
  targetPeriodMonth: number;
  targetPeriodYear: number;
  status: string; // 'PENDING' | 'APPLIED' | 'CANCELLED'
}
export type AdjustmentRegisterRow = AdjustmentRegisterInput;
export interface AdjustmentsRegister {
  rows: AdjustmentRegisterRow[];
  totals: {
    count: number;
    /** Sum of BONUS amounts that are not CANCELLED (i.e. will/did apply). */
    totalBonuses: number;
    /** Sum of DEDUCTION amounts that are not CANCELLED. */
    totalDeductions: number;
    byStatus: Record<string, number>;
  };
}

/**
 * Org-wide payroll-adjustments register — the bonus/deduction analogue of the
 * loan book. Rows pass through as-is; the value here is the typed totals, which
 * exclude CANCELLED rows since those never hit a payslip.
 */
export function buildAdjustmentsRegister(adjustments: AdjustmentRegisterInput[]): AdjustmentsRegister {
  const rows: AdjustmentRegisterRow[] = adjustments.map((a) => ({ ...a, amount: round2(a.amount) }));

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const live = rows.filter((r) => r.status !== 'CANCELLED');
  return {
    rows,
    totals: {
      count: rows.length,
      totalBonuses: round2(live.filter((r) => r.type === 'BONUS').reduce((t, r) => t + r.amount, 0)),
      totalDeductions: round2(live.filter((r) => r.type === 'DEDUCTION').reduce((t, r) => t + r.amount, 0)),
      byStatus,
    },
  };
}
