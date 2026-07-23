import { api, downloadFile } from './client';
import type { LeaveRequest, LeaveBalance } from './leave';

/** The signed-in user's own employee record — always fully decrypted (see /me/profile on the API). */
export interface MyProfile {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  kraPin: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  bankCode: string | null;
  bankBranchCode: string | null;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  departmentId: string | null;
  jobTitleId: string | null;
  employmentType: string;
  employmentStatus: string;
  hireDate: string;
  exitDate: string | null;
  nextOfKin: unknown;
}

export const getMyProfile = (): Promise<MyProfile> => api<MyProfile>('/me/profile');

export interface MyPayslip {
  id: string;
  periodMonth: number | null;
  periodYear: number | null;
  runType: string | null;
  grossPay: number;
  paye: number;
  nssfEmployee: number;
  shif: number;
  ahlEmployee: number;
  otherDeductions: number;
  netPay: number;
  oneThirdRulePass: boolean;
  pdfStatus: string;
}

export const getMyPayslips = (): Promise<MyPayslip[]> => api<MyPayslip[]>('/me/payslips');

export const downloadMyPayslipPdf = (id: string): Promise<void> =>
  downloadFile(`/me/payslips/${id}/pdf`, `payslip-${id.slice(0, 8)}.pdf`);

export interface MyLeave {
  requests: LeaveRequest[];
  balances: LeaveBalance[];
}

export const getMyLeave = (): Promise<MyLeave> => api<MyLeave>('/me/leave');
