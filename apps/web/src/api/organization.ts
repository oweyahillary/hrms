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

/** PNG or JPEG, up to 2 MB (enforced server-side too). */
export const uploadLogo = (file: File): Promise<{ hasLogo: boolean }> => {
  const form = new FormData();
  form.append('file', file);
  return api<{ hasLogo: boolean }>('/organization/logo', { method: 'POST', body: form });
};

export const deleteLogo = (): Promise<unknown> =>
  api('/organization/logo', { method: 'DELETE' });

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME = ['image/png', 'image/jpeg'];
