import { api } from './client';

export interface TrendMonth {
  month: number;
  employeesPaid: number;
  grossPay: number;
  paye: number;
  statutory: number;
  netPay: number;
}
export interface YearTrend {
  year: number;
  months: TrendMonth[];
  totals: { grossPay: number; paye: number; statutory: number; netPay: number };
}
export interface Headcount {
  total: number;
  active: number;
  byStatus: Record<string, number>;
  activeByDepartment: Array<{ department: string; activeCount: number }>;
}

export const getYearTrend = (year: number): Promise<YearTrend> =>
  api<YearTrend>(`/reports/year-trend?year=${year}`);

export const getHeadcount = (): Promise<Headcount> =>
  api<Headcount>('/reports/headcount');

export const getLeaveInboxCount = async (): Promise<number> => {
  const rows = await api<unknown[]>('/leave-requests/inbox');
  return Array.isArray(rows) ? rows.length : 0;
};
