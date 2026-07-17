import { api } from './client';

export interface Branding {
  name: string;
  kraPin: string | null;
  physicalAddress: string | null;
  registrationNumber: string | null;
  payslipNotice: string | null;
  logoAlignment: 'LEFT' | 'CENTER' | 'RIGHT';
  brandColor: string | null;
  bankAccountNumber: string | null;
  bankPurposeCode: string | null;
  hasLogo: boolean;
}

export type BrandingUpdate = Partial<Omit<Branding, 'hasLogo'>>;

export const getBranding = (): Promise<Branding> =>
  api<Branding>('/organization/branding', { method: 'GET' });

export const updateBranding = (patch: BrandingUpdate): Promise<Branding> =>
  api<Branding>('/organization/branding', { method: 'PATCH', body: JSON.stringify(patch) });

/**
 * Employee-number auto-numbering config. `preview` is what the NEXT create will
 * get — it is not reserved, so two people looking at it see the same value.
 */
export interface Numbering {
  employeeNumberPrefix: string | null;
  employeeNumberPadding: number;
  employeeNumberNextSeq: number;
  autoNumbering: boolean;
  preview: string | null;
}

export type NumberingUpdate = {
  employeeNumberPrefix?: string | null;
  employeeNumberPadding?: number;
  employeeNumberNextSeq?: number;
};

export const getNumbering = (): Promise<Numbering> =>
  api<Numbering>('/organization/employee-numbering', { method: 'GET' });

export const updateNumbering = (patch: NumberingUpdate): Promise<Numbering> =>
  api<Numbering>('/organization/employee-numbering', { method: 'PATCH', body: JSON.stringify(patch) });

/** PNG or JPEG, up to 2 MB (enforced server-side too). */
export const uploadLogo = (file: File): Promise<{ hasLogo: boolean }> => {
  const form = new FormData();
  form.append('file', file);
  return api<{ hasLogo: boolean }>('/organization/logo', { method: 'POST', body: form });
};

export const deleteLogo = (): Promise<unknown> =>
  api('/organization/logo', { method: 'DELETE' });

export const LEAVE_APPROVAL_MODES = ['DEPT_HEAD_THEN_HR', 'HR_ONLY', 'DEPT_HEAD_ONLY'] as const;
export type LeaveApprovalMode = (typeof LEAVE_APPROVAL_MODES)[number];

export interface LeaveApproval {
  leaveApprovalMode: LeaveApprovalMode;
  leaveHrApproverUserId: string | null;
  hrApproverName: string | null;
  allowEmployeeChosenApprovers: boolean;
  /** True when no HR approver is set — nothing can be approved until it is. */
  needsHrApprover: boolean;
}

export type LeaveApprovalUpdate = {
  leaveApprovalMode?: LeaveApprovalMode;
  leaveHrApproverUserId?: string | null;
  allowEmployeeChosenApprovers?: boolean;
};

export const getLeaveApproval = (): Promise<LeaveApproval> =>
  api<LeaveApproval>('/organization/leave-approval', { method: 'GET' });

export const updateLeaveApproval = (patch: LeaveApprovalUpdate): Promise<LeaveApproval> =>
  api<LeaveApproval>('/organization/leave-approval', { method: 'PATCH', body: JSON.stringify(patch) });

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME = ['image/png', 'image/jpeg'];
