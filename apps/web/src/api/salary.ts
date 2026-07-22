import { api } from './client';

export const SALARY_COMPONENT_TYPES = ['ALLOWANCE', 'DEDUCTION_VOLUNTARY'] as const;
export type SalaryComponentType = (typeof SALARY_COMPONENT_TYPES)[number];

export interface SalaryComponent {
  componentType: SalaryComponentType;
  name: string;
  amount: number;
  isTaxable: boolean;
}

export interface SalaryStructureDerived {
  gross: number;
  taxableGross: number;
  pensionable: number;
  allowancesTotal: number;
  otherDeductions: number;
}

export interface SalaryStructure {
  id: string;
  employeeId: string;
  basicSalary: number;
  effectiveDate: string;
  endDate: string | null;
  reason: string;
  approvedById: string | null;
  components: SalaryComponent[];
  derived: SalaryStructureDerived;
}

export interface CreateSalaryStructureInput {
  basicSalary: number;
  effectiveDate: string;
  endDate?: string;
  reason: string;
  approvedById?: string;
  components?: SalaryComponent[];
}

/** Full version history, newest first. */
export const listSalaryStructures = (employeeId: string): Promise<SalaryStructure[]> =>
  api<SalaryStructure[]>(`/employees/${employeeId}/salary-structures`);

/** The structure in force on `asOf` (defaults to today), or null if none. */
export const getEffectiveSalaryStructure = (employeeId: string, asOf?: string): Promise<{ asOf: string; structure: SalaryStructure | null }> =>
  api(`/employees/${employeeId}/salary-structures/effective${asOf ? `?asOf=${asOf}` : ''}`);

/** Creates a new version; if it starts after the currently-open one, that one is auto-closed (endDate set). */
export const createSalaryStructure = (employeeId: string, input: CreateSalaryStructureInput): Promise<SalaryStructure> =>
  api<SalaryStructure>(`/employees/${employeeId}/salary-structures`, { method: 'POST', body: JSON.stringify(input) });
