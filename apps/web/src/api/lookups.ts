import { api } from './client';

/**
 * Reference lists used to turn the IDs on an employee record into names.
 * The employees list returns departmentId / jobTitleId only, so the client
 * fetches these once and joins locally rather than the API denormalising every
 * row. Both endpoints are open to any authenticated user.
 *
 * Note the asymmetry in the API: a Department has `name`, a JobTitle has
 * `title`. `toOptions` normalises both to {value,label} so callers don't have
 * to care.
 */

export interface Department {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  employeeCount: number;
}

export interface JobTitle {
  id: string;
  title: string;
  grade: string | null;
  employeeCount: number;
}

export interface Option {
  value: string;
  label: string;
}

export const getDepartments = (): Promise<Department[]> => api<Department[]>('/departments');

export const getJobTitles = (): Promise<JobTitle[]> => api<JobTitle[]>('/job-titles');

export const departmentOptions = (rows: Department[]): Option[] =>
  rows.map((d) => ({ value: d.id, label: d.name }));

/** id -> name maps for O(1) lookup while rendering rows. */
export const departmentMap = (rows: Department[]): Map<string, string> =>
  new Map(rows.map((d) => [d.id, d.name]));

export const jobTitleMap = (rows: JobTitle[]): Map<string, string> =>
  new Map(rows.map((j) => [j.id, j.title]));
