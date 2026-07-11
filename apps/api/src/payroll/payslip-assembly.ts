/**
 * Pure: turn one employee's derived pay bases into a snapshot-ready payslip —
 * statutory figures from the engine, voluntary deductions, net (with optional
 * whole-shilling rounding) and BOTH one-third-rule checks (basic + gross based).
 */
import { computePayroll, round2, type RateSet } from './payroll-engine';

export interface PayslipInputs {
  basicSalary: number;
  gross: number;
  taxableGross: number;
  pensionable: number;
  otherDeductions: number;
}

export interface OneThirdDetail {
  basicBasedPass: boolean;
  grossBasedPass: boolean;
  minTakeHomeBasic: number;
  minTakeHomeGross: number;
}

export interface AssembledPayslip {
  grossPay: number;
  paye: number;
  nssfEmployee: number;
  nssfEmployer: number;
  shif: number;
  ahlEmployee: number;
  ahlEmployer: number;
  otherDeductions: number;
  netPay: number;
  taxablePay: number;
  oneThirdRulePass: boolean; // basic-based — the value persisted on the payslip
  oneThird: OneThirdDetail;  // full detail — exposed in API responses
}

export function assemblePayslip(inp: PayslipInputs, rates: RateSet, roundNetToShilling: boolean): AssembledPayslip {
  const b = computePayroll(
    { grossPay: inp.gross, taxableGross: inp.taxableGross, pensionablePay: inp.pensionable }, rates,
  );

  // engine net is gross - statutory; subtract voluntary deductions for take-home
  let netPay = round2(b.netPay - inp.otherDeductions);
  if (roundNetToShilling) netPay = Math.round(netPay);

  const minTakeHomeBasic = round2(inp.basicSalary / 3);
  const minTakeHomeGross = round2(inp.gross / 3);
  const basicBasedPass = netPay >= minTakeHomeBasic;
  const grossBasedPass = netPay >= minTakeHomeGross;

  return {
    grossPay: round2(inp.gross),
    paye: b.paye,
    nssfEmployee: b.nssf.employee,
    nssfEmployer: b.nssf.employer,
    shif: b.shif,
    ahlEmployee: b.ahl,
    ahlEmployer: b.employerCost.ahl,
    otherDeductions: round2(inp.otherDeductions),
    netPay,
    taxablePay: b.taxablePay,
    oneThirdRulePass: basicBasedPass,
    oneThird: { basicBasedPass, grossBasedPass, minTakeHomeBasic, minTakeHomeGross },
  };
}

/** Recompute the gross-based check from a stored payslip (net + gross), for exposure. */
export function grossBasedOneThird(netPay: number, grossPay: number): boolean {
  return netPay >= round2(grossPay / 3);
}
