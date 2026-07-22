import { listEmployees } from './employees';

export interface EmployeeOption {
  value: string;
  label: string;
}

/**
 * Employee list flattened to Mantine Select options (id -> "Name (number)").
 * Pulls a large first page — enough for a picker in an SME payroll UI without
 * paging. Used by the loan/deduction create forms and the P9 report control.
 * pageSize is capped at the API's own max (ListEmployeesDto, @Max(100)) —
 * asking for more fails the whole request, not just truncates it.
 */
export async function loadEmployeeOptions(): Promise<EmployeeOption[]> {
  const res = await listEmployees({ pageSize: 100, sort: 'name', order: 'asc' });
  return res.data.map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeNumber})` }));
}
