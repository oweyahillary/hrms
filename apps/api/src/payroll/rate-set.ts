import { BadRequestException } from '@nestjs/common';
import type { RateSet } from './payroll-engine';
import {
  validateRateParameters, type PayeParams, type NssfParams, type ShifParams, type AhlParams,
} from './rate-parameters';

interface EffectiveRow { parameters: unknown; effectiveDate: Date | string; }

/** Turn the effective() DB result into a typed, validated RateSet for the engine. */
export function assembleRateSet(rates: Record<string, EffectiveRow | null>): RateSet {
  const required = ['PAYE_BAND', 'NSSF', 'SHIF', 'AHL'];
  const missing = required.filter((t) => !rates[t]);
  if (missing.length) {
    throw new BadRequestException(
      `No effective statutory rate in force for: ${missing.join(', ')}. Seed or add a version dated on/before the period.`,
    );
  }
  for (const t of required) {
    const errs = validateRateParameters(t, rates[t]!.parameters);
    if (errs.length) throw new BadRequestException({ message: `Stored ${t} parameters are invalid`, errors: errs });
  }
  return {
    paye: rates['PAYE_BAND']!.parameters as PayeParams,
    nssf: rates['NSSF']!.parameters as NssfParams,
    shif: rates['SHIF']!.parameters as ShifParams,
    ahl: rates['AHL']!.parameters as AhlParams,
  };
}
