/**
 * Pure P9 (annual tax deduction card) assembly. No I/O, no framework.
 * Builds the KRA P9 column model (A–O) from monthly payroll figures, derives
 * the totals row, and reports whether the recomputed PAYE (O) reconciles to the
 * PAYE actually deducted on each payslip — the property KRA cares about (P9
 * total PAYE must equal the monthly PAYE returns).
 *
 * KRA P9 2025 columns:
 *   A Basic  B Non-cash benefits  C Value of quarters  D Total gross
 *   E Defined-contribution retirement (incl. NSSF)  F AHL  G SHIF
 *   H Post-retirement medical  I Owner-occupied interest
 *   J Total deductions (E+F+G+H+I)  K Chargeable pay (D-J)
 *   L Tax charged  M Personal relief  N Insurance relief  O PAYE (L-M-N)
 *
 * Optional columns (B, C, H, I, N) default to 0 and are populated only once the
 * payroll engine computes the corresponding benefit/relief.
 */

export interface P9MonthFigures {
  month: number; // 1–12
  basicSalary: number; // A
  nonCashBenefits?: number; // B
  valueOfQuarters?: number; // C
  grossPay: number; // D (as deducted on the payslip)
  pensionContribution: number; // E (deductible retirement contribution incl. NSSF)
  ahl: number; // F
  shif: number; // G
  postRetirementMedical?: number; // H
  ownerOccupiedInterest?: number; // I
  taxCharged: number; // L (PAYE before relief, from the engine)
  personalRelief: number; // M
  insuranceRelief?: number; // N
  payeDeducted: number; // O as actually deducted (payslip.paye) — reconciliation target
}

export interface P9Row {
  month: number;
  A: number; B: number; C: number; D: number;
  E: number; F: number; G: number; H: number; I: number;
  J: number; K: number; L: number; M: number; N: number; O: number;
  reconciles: boolean; // computed O matches the PAYE actually deducted
}

export type P9Totals = Omit<P9Row, 'month' | 'reconciles'>;

export interface P9Card {
  rows: P9Row[];
  totals: P9Totals;
  reconciles: boolean; // every month reconciles
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildP9Card(months: P9MonthFigures[]): P9Card {
  const rows: P9Row[] = months
    .slice()
    .sort((a, b) => a.month - b.month)
    .map((m) => {
      const E = r2(m.pensionContribution);
      const F = r2(m.ahl);
      const G = r2(m.shif);
      const H = r2(m.postRetirementMedical ?? 0);
      const I = r2(m.ownerOccupiedInterest ?? 0);
      const D = r2(m.grossPay);
      const J = r2(E + F + G + H + I);
      const K = r2(Math.max(0, D - J));
      const L = r2(m.taxCharged);
      const M = r2(m.personalRelief);
      const N = r2(m.insuranceRelief ?? 0);
      const O = r2(Math.max(0, L - M - N));
      return {
        month: m.month,
        A: r2(m.basicSalary), B: r2(m.nonCashBenefits ?? 0), C: r2(m.valueOfQuarters ?? 0), D,
        E, F, G, H, I, J, K, L, M, N, O,
        reconciles: Math.abs(O - r2(m.payeDeducted)) < 0.01,
      };
    });

  const sum = (k: keyof P9Totals): number => r2(rows.reduce((s, row) => s + row[k], 0));
  const totals: P9Totals = {
    A: sum('A'), B: sum('B'), C: sum('C'), D: sum('D'), E: sum('E'), F: sum('F'),
    G: sum('G'), H: sum('H'), I: sum('I'), J: sum('J'), K: sum('K'), L: sum('L'),
    M: sum('M'), N: sum('N'), O: sum('O'),
  };

  return { rows, totals, reconciles: rows.every((r) => r.reconciles) };
}
