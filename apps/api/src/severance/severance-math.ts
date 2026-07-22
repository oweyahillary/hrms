/**
 * Pure severance & notice math (Employment Act 2007). No I/O — deterministic and
 * testable in isolation, mirroring salary-math.ts / payroll-engine.ts. The
 * service layer runs the resulting gross through the PAYE engine and persists
 * the breakdown; nothing here touches the database or the tax rates.
 *
 *   severance (redundancy only) = a day's pay × 15 days × completed years  (§40)
 *   notice period               = max(statutory-by-frequency, contractual)  (§35)
 *
 * IMPORTANT — the tax treatment of a severance lump sum (spreading across years
 * of service, exemption thresholds) is NOT decided here and is flagged as
 * unverified in docs/severance.md. This module only produces the gross
 * entitlement and the audit trail behind it.
 */
export type PayFrequency = 'DAILY' | 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY';
export type ExitReason = 'RESIGNATION' | 'TERMINATION' | 'REDUNDANCY' | 'RETIREMENT';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Default days used to turn a monthly basic salary into a day's pay when no
 * organisation basis is supplied. Employment Act §40 fixes severance at "fifteen
 * days' pay for each completed year" but does not define a day's pay from a
 * monthly wage. 30 (calendar days) is the common convention and gives the
 * widely-cited "half a month per completed year" result; 26 (working days) is
 * the competing reading. This is now an organisation-level setting
 * (Organization.severanceDayRateBasis); 30 remains the default. See
 * docs/severance.md.
 */
export const DAYS_PER_MONTH = 30;
export const WORKING_DAYS_PER_MONTH = 26;

/** The two documented legal conventions, mirroring the Prisma enum. */
export type SeveranceDayRateBasis = 'CALENDAR_30' | 'WORKING_26';

/** Map an organisation's day-rate basis to the divisor it stands for. */
export function daysPerMonthForBasis(basis: SeveranceDayRateBasis): number {
  return basis === 'WORKING_26' ? WORKING_DAYS_PER_MONTH : DAYS_PER_MONTH;
}

/** Employment Act §40(1)(g): fifteen days' pay per completed year of service. */
export const SEVERANCE_DAYS_PER_YEAR = 15;

/** Statutory minimum notice by pay frequency (Employment Act §35). */
export const STATUTORY_NOTICE_DAYS: Record<PayFrequency, number> = {
  DAILY: 0, // §35(5)(a): terminable at the close of any day, no notice
  WEEKLY: 7, // one pay period
  BI_WEEKLY: 14, // one pay period
  MONTHLY: 28, // §35(5)(c): 28 days where wages are paid monthly (or at longer intervals)
};

/** A day's pay derived from a monthly basic salary (see DAYS_PER_MONTH). */
export function dailyRate(basicSalary: number, daysPerMonth: number = DAYS_PER_MONTH): number {
  return round2(basicSalary / daysPerMonth);
}

/**
 * Completed years of service between hire and exit. Employment Act §40 counts
 * "each COMPLETED year of service", so a partial year does NOT count — this
 * floors to whole anniversaries reached on/before the exit date. Compared on
 * (year, month, day) in UTC to match @db.Date storage and avoid timezone drift.
 * (Feb-29 hire dates are a known minor edge — treated as reaching their
 * anniversary on Feb 29, i.e. only in leap years.)
 */
export function completedYearsOfService(hireDate: Date, exitDate: Date): number {
  const hm = hireDate.getUTCMonth();
  const hd = hireDate.getUTCDate();
  const em = exitDate.getUTCMonth();
  const ed = exitDate.getUTCDate();
  let years = exitDate.getUTCFullYear() - hireDate.getUTCFullYear();
  if (em < hm || (em === hm && ed < hd)) years -= 1;
  return Math.max(0, years);
}

export interface NoticePeriod {
  payFrequency: PayFrequency;
  statutoryDays: number;
  contractualDays: number | null;
  appliedDays: number;
  basis: 'statutory' | 'contractual';
  dailyRate: number;
  payInLieu: number;
}

/**
 * Notice period by pay frequency, taking the GREATER of the statutory minimum
 * and any contractual notice — a longer contractual period must never be
 * understated by the statutory figure. payInLieu = appliedDays × a day's pay.
 */
export function computeNoticePeriod(input: {
  payFrequency: PayFrequency;
  basicSalary: number;
  contractualNoticeDays?: number | null;
  daysPerMonth?: number;
}): NoticePeriod {
  const statutoryDays = STATUTORY_NOTICE_DAYS[input.payFrequency];
  const contractualDays =
    input.contractualNoticeDays != null && input.contractualNoticeDays > 0
      ? Math.floor(input.contractualNoticeDays)
      : null;
  const appliedDays = Math.max(statutoryDays, contractualDays ?? 0);
  const basis: 'statutory' | 'contractual' =
    contractualDays != null && contractualDays > statutoryDays ? 'contractual' : 'statutory';
  const rate = dailyRate(input.basicSalary, input.daysPerMonth ?? DAYS_PER_MONTH);
  return {
    payFrequency: input.payFrequency,
    statutoryDays,
    contractualDays,
    appliedDays,
    basis,
    dailyRate: rate,
    payInLieu: round2(rate * appliedDays),
  };
}

export interface Severance {
  applies: boolean;
  reason: ExitReason;
  basicSalary: number;
  daysPerMonth: number;
  dailyRate: number;
  daysPerYear: number;
  completedYears: number;
  gross: number;
  formula: string;
  note: string;
}

/**
 * Redundancy severance (§40): a day's pay × 15 × completed years of service.
 * ONLY REDUNDANCY attracts statutory severance; every other exit reason returns
 * 0 with an explicit note — the zero case is always reported, never omitted.
 */
export function computeSeverance(input: {
  reason: ExitReason;
  basicSalary: number;
  hireDate: Date;
  exitDate: Date;
  daysPerMonth?: number;
}): Severance {
  const daysPerMonth = input.daysPerMonth ?? DAYS_PER_MONTH;
  const completedYears = completedYearsOfService(input.hireDate, input.exitDate);
  const rate = dailyRate(input.basicSalary, daysPerMonth);
  const base = {
    reason: input.reason,
    basicSalary: round2(input.basicSalary),
    daysPerMonth,
    dailyRate: rate,
    daysPerYear: SEVERANCE_DAYS_PER_YEAR,
    completedYears,
  };

  if (input.reason !== 'REDUNDANCY') {
    return {
      ...base,
      applies: false,
      gross: 0,
      formula: 'n/a — statutory severance applies to redundancy only',
      note: `No statutory severance for ${input.reason}. Employment Act §40 severance is payable on redundancy only.`,
    };
  }

  const gross = round2(rate * SEVERANCE_DAYS_PER_YEAR * completedYears);
  return {
    ...base,
    applies: true,
    gross,
    formula: `${rate} (day's pay) × ${SEVERANCE_DAYS_PER_YEAR} days × ${completedYears} completed year(s)`,
    note:
      completedYears === 0
        ? 'Redundancy, but under one completed year of service — no severance accrued yet.'
        : 'Redundancy severance at 15 days per completed year (Employment Act §40).',
  };
}

export interface SeveranceComputation {
  severance: Severance;
  notice: NoticePeriod;
  /** The auditable record (minus PAYE, which the service adds from live rates). */
  breakdown: Record<string, unknown>;
}

/**
 * Contract classification for PAYE spreading of a severance lump sum — the KRA
 * three-bucket rule (docs/severance.md). Specific to a given exit, supplied at
 * calculation time.
 */
export type ContractTermType = 'FIXED_TERM' | 'UNSPECIFIED_WITH_CLAUSE' | 'NO_PROVISION';

export interface SeveranceTaxSpread {
  bucket: ContractTermType;
  /** Human-readable statement of the rule applied — part of the audit trail. */
  rule: string;
  /** Number of equal MONTHLY periods the lump sum is spread across for PAYE. */
  periods: number;
  /** Taxable amount assigned to each period (lump sum / periods). */
  amountPerPeriod: number;
}

/**
 * Resolve which KRA bucket applies and how the lump sum spreads for PAYE. All
 * three buckets resolve to a number of MONTHLY periods, so each slice can run
 * through the ordinary monthly PAYE bands (the way a normal month is taxed)
 * rather than taxing the whole lump sum in the exit month:
 *
 *   FIXED_TERM              → spread over the unexpired term (unexpiredTermMonths)
 *   UNSPECIFIED_WITH_CLAUSE → spread forward at the pre-termination monthly rate
 *                             (periods = ceil(lump ÷ monthly gross))
 *   NO_PROVISION            → spread evenly over the 3 years (36 months) after exit
 *
 * FIXED_TERM without a positive unexpiredTermMonths REJECTS (throws) rather than
 * silently defaulting. This produces the methodology only — the resulting PAYE
 * remains PROVISIONAL_UNVERIFIED until a tax firm signs the methodology off.
 */
export function classifySeveranceTaxTreatment(input: {
  severanceAmount: number;
  contractTermType: ContractTermType;
  unexpiredTermMonths?: number | null;
  annualGross: number;
}): SeveranceTaxSpread {
  const amount = Math.max(0, round2(input.severanceAmount));

  switch (input.contractTermType) {
    case 'FIXED_TERM': {
      const m = input.unexpiredTermMonths;
      if (m == null || !(m > 0)) {
        throw new Error('unexpiredTermMonths is required and must be positive for a FIXED_TERM contract.');
      }
      const periods = Math.floor(m);
      return {
        bucket: 'FIXED_TERM',
        rule: 'Fixed-term contract: lump sum spread over the unexpired term.',
        periods,
        amountPerPeriod: round2(amount / periods),
      };
    }
    case 'UNSPECIFIED_WITH_CLAUSE': {
      const monthly = input.annualGross / 12;
      const periods = monthly > 0 ? Math.max(1, Math.ceil(amount / monthly)) : 1;
      return {
        bucket: 'UNSPECIFIED_WITH_CLAUSE',
        rule: 'Unspecified-term contract with a termination-pay clause: spread forward at the pre-termination rate.',
        periods,
        amountPerPeriod: round2(amount / periods),
      };
    }
    case 'NO_PROVISION': {
      const periods = 36; // 3 years following termination
      return {
        bucket: 'NO_PROVISION',
        rule: 'No provision for compensation: spread evenly over the 3 years following termination.',
        periods,
        amountPerPeriod: round2(amount / periods),
      };
    }
    default:
      throw new Error(`Unknown contract term type: ${String(input.contractTermType)}`);
  }
}

/**
 * Assemble the full deterministic breakdown for a severance calculation. Every
 * input and intermediate is captured so a disputed payout can be reconstructed
 * by hand. The PAYE block is deliberately absent here — it needs the live
 * statutory rates and is layered on in the service.
 */
export function buildSeveranceComputation(input: {
  reason: ExitReason;
  hireDate: Date;
  exitDate: Date;
  basicSalary: number;
  payFrequency: PayFrequency;
  contractualNoticeDays?: number | null;
  daysPerMonth?: number;
}): SeveranceComputation {
  const daysPerMonth = input.daysPerMonth ?? DAYS_PER_MONTH;
  const severance = computeSeverance({
    reason: input.reason,
    basicSalary: input.basicSalary,
    hireDate: input.hireDate,
    exitDate: input.exitDate,
    daysPerMonth,
  });
  const notice = computeNoticePeriod({
    payFrequency: input.payFrequency,
    basicSalary: input.basicSalary,
    contractualNoticeDays: input.contractualNoticeDays,
    daysPerMonth,
  });

  const breakdown: Record<string, unknown> = {
    reason: input.reason,
    hireDate: input.hireDate.toISOString().slice(0, 10),
    exitDate: input.exitDate.toISOString().slice(0, 10),
    basicSalary: round2(input.basicSalary),
    daysPerMonth,
    dailyRate: severance.dailyRate,
    severance: {
      applies: severance.applies,
      daysPerYear: severance.daysPerYear,
      completedYears: severance.completedYears,
      formula: severance.formula,
      gross: severance.gross,
      note: severance.note,
    },
    notice: {
      payFrequency: notice.payFrequency,
      statutoryDays: notice.statutoryDays,
      contractualDays: notice.contractualDays,
      appliedDays: notice.appliedDays,
      basis: notice.basis,
      payInLieu: notice.payInLieu,
    },
  };

  return { severance, notice, breakdown };
}
