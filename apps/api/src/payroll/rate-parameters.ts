/**
 * Shapes + validation for the `parameters` JSON on each StatutoryRate version,
 * and effective-date selection. Pure — no I/O — so it's exhaustively testable.
 *
 * Rates are versioned by effectiveDate; the engine picks the version in force on
 * the payroll period's date. Editing = adding a NEW effective-dated version.
 */

export type RateType = 'PAYE_BAND' | 'NSSF' | 'SHIF' | 'AHL';

export interface PayeBand { upTo: number | null; rate: number; }
export interface PayeParams { bands: PayeBand[]; personalRelief: number; }
export interface NssfParams { rate: number; lowerLimit: number; upperLimit: number; deductibleForPaye: boolean; }
export interface ShifParams { rate: number; floor: number; deductibleForPaye: boolean; }
export interface AhlParams { rate: number; deductibleForPaye: boolean; }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRate = (v: unknown): boolean => isNum(v) && v >= 0 && v <= 1;
const isNonNeg = (v: unknown): boolean => isNum(v) && v >= 0;

/** Returns a list of human-readable problems; empty array means valid. */
export function validateRateParameters(rateType: string, params: unknown): string[] {
  const errors: string[] = [];
  if (typeof params !== 'object' || params === null) return ['parameters must be an object'];
  const p = params as Record<string, unknown>;

  switch (rateType) {
    case 'PAYE_BAND': {
      const bands = p.bands as unknown[];
      if (!Array.isArray(bands) || bands.length === 0) {
        errors.push('bands must be a non-empty array');
      } else {
        let prevUpTo = 0;
        bands.forEach((raw, i) => {
          const b = raw as Record<string, unknown>;
          if (!(b.upTo === null || isNum(b.upTo))) errors.push(`bands[${i}].upTo must be a number or null`);
          if (!isRate(b.rate)) errors.push(`bands[${i}].rate must be between 0 and 1`);
          if (isNum(b.upTo)) {
            if (b.upTo <= prevUpTo) errors.push(`bands[${i}].upTo must increase (ascending thresholds)`);
            prevUpTo = b.upTo;
          }
        });
        const last = bands[bands.length - 1] as Record<string, unknown>;
        if (last.upTo !== null) errors.push('the final band must have upTo = null (open-ended top rate)');
      }
      if (!isNonNeg(p.personalRelief)) errors.push('personalRelief must be a non-negative number');
      break;
    }
    case 'NSSF': {
      if (!isRate(p.rate)) errors.push('rate must be between 0 and 1');
      if (!isNonNeg(p.lowerLimit)) errors.push('lowerLimit must be >= 0');
      if (!isNum(p.upperLimit) || p.upperLimit <= 0) errors.push('upperLimit must be > 0');
      if (isNum(p.lowerLimit) && isNum(p.upperLimit) && p.lowerLimit > p.upperLimit) {
        errors.push('lowerLimit cannot exceed upperLimit');
      }
      if (typeof p.deductibleForPaye !== 'boolean') errors.push('deductibleForPaye must be a boolean');
      break;
    }
    case 'SHIF': {
      if (!isRate(p.rate)) errors.push('rate must be between 0 and 1');
      if (!isNonNeg(p.floor)) errors.push('floor must be >= 0');
      if (typeof p.deductibleForPaye !== 'boolean') errors.push('deductibleForPaye must be a boolean');
      break;
    }
    case 'AHL': {
      if (!isRate(p.rate)) errors.push('rate must be between 0 and 1');
      if (typeof p.deductibleForPaye !== 'boolean') errors.push('deductibleForPaye must be a boolean');
      break;
    }
    default:
      errors.push(`unknown rateType "${rateType}"`);
  }
  return errors;
}

export interface EffectiveDated { effectiveDate: Date | string; }

/** The version in force on `asOf` = latest effectiveDate <= asOf, or null. */
export function pickEffective<T extends EffectiveDated>(rows: readonly T[], asOf: Date): T | null {
  const cutoff = asOf.getTime();
  let best: T | null = null;
  let bestTime = -Infinity;
  for (const r of rows) {
    const t = new Date(r.effectiveDate).getTime();
    if (t <= cutoff && t > bestTime) { best = r; bestTime = t; }
  }
  return best;
}
