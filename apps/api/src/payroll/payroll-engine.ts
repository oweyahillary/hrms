/**
 * Pure Kenyan statutory payroll engine. No I/O, no framework — deterministic,
 * exhaustively testable. Given a gross (and optional Act-faithful pensionable
 * pay) plus the effective rate set, it computes NSSF, SHIF, AHL, taxable pay,
 * PAYE (bands minus personal relief) and net pay.
 *
 * Computation order (2026 regime — NSSF/SHIF/AHL deductible before PAYE):
 *   taxable = gross - (deductible statutory components)
 *   payeBeforeRelief = bands(taxable)
 *   paye = max(0, payeBeforeRelief - personalRelief)
 *   net  = gross - nssf - shif - ahl - paye
 */
import type { PayeParams, NssfParams, ShifParams, AhlParams } from './rate-parameters';

export interface RateSet { paye: PayeParams; nssf: NssfParams; shif: ShifParams; ahl: AhlParams; }
export interface PayrollInput {
  grossPay: number;
  /** NSSF base; defaults to grossPay. */
  pensionablePay?: number;
  /** PAYE base before statutory deductions (excludes non-taxable allowances); defaults to grossPay. */
  taxableGross?: number;
}

export interface NssfBreakdown { employee: number; employer: number; tierI: number; tierII: number; }
export interface PayrollBreakdown {
  grossPay: number;
  pensionablePay: number;
  nssf: NssfBreakdown;
  shif: number;
  ahl: number;
  taxablePay: number;
  payeBeforeRelief: number;
  personalRelief: number;
  paye: number;
  totalEmployeeDeductions: number;
  netPay: number;
  employerCost: { nssf: number; ahl: number }; // SHIF employer share not modelled (employee deduction)
}

/** Round to 2 decimal places (cents), guarding against binary FP drift. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** NSSF = 6% of pensionable pay, capped at the Upper Earnings Limit; split into tiers for the payslip. */
export function computeNssf(pensionablePay: number, p: NssfParams): NssfBreakdown {
  const capped = Math.min(Math.max(0, pensionablePay), p.upperLimit);
  const tierI = round2(p.rate * Math.min(capped, p.lowerLimit));
  const tierII = round2(p.rate * Math.max(0, capped - p.lowerLimit));
  const employee = round2(tierI + tierII);
  return { employee, employer: employee, tierI, tierII };
}

/** SHIF = max(floor, rate × gross). */
export function computeShif(grossPay: number, p: ShifParams): number {
  return round2(Math.max(p.floor, p.rate * grossPay));
}

/** AHL = rate × gross. */
export function computeAhl(grossPay: number, p: AhlParams): number {
  return round2(p.rate * grossPay);
}

/** Progressive PAYE on taxable pay across the bands (before personal relief). */
export function computePayeTax(taxablePay: number, p: PayeParams): number {
  let tax = 0;
  let lower = 0;
  for (const band of p.bands) {
    const upper = band.upTo === null ? Infinity : band.upTo;
    if (taxablePay <= lower) break;
    const slice = Math.min(taxablePay, upper) - lower;
    if (slice > 0) tax += slice * band.rate;
    lower = upper;
  }
  return round2(tax);
}

export function computePayroll(input: PayrollInput, rates: RateSet): PayrollBreakdown {
  const grossPay = input.grossPay;
  const pensionablePay = input.pensionablePay ?? grossPay;

  const nssf = computeNssf(pensionablePay, rates.nssf);
  const shif = computeShif(grossPay, rates.shif);
  const ahl = computeAhl(grossPay, rates.ahl);

  let taxablePay = input.taxableGross ?? grossPay;
  if (rates.nssf.deductibleForPaye) taxablePay -= nssf.employee;
  if (rates.shif.deductibleForPaye) taxablePay -= shif;
  if (rates.ahl.deductibleForPaye) taxablePay -= ahl;
  taxablePay = round2(Math.max(0, taxablePay));

  const payeBeforeRelief = computePayeTax(taxablePay, rates.paye);
  const personalRelief = rates.paye.personalRelief;
  const paye = round2(Math.max(0, payeBeforeRelief - personalRelief));

  const totalEmployeeDeductions = round2(nssf.employee + shif + ahl + paye);
  const netPay = round2(grossPay - totalEmployeeDeductions);

  return {
    grossPay: round2(grossPay),
    pensionablePay: round2(pensionablePay),
    nssf, shif, ahl,
    taxablePay,
    payeBeforeRelief, personalRelief, paye,
    totalEmployeeDeductions, netPay,
    employerCost: { nssf: nssf.employer, ahl: round2(rates.ahl.rate * grossPay) },
  };
}
