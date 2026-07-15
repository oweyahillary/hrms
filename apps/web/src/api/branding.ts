import { api } from './client';

export interface PublicBranding {
  name: string | null;
  brandColor: string | null;
  hasLogo: boolean;
}

/** Pre-login branding. Never throws — a branding failure must not block sign-in. */
export async function getPublicBranding(): Promise<PublicBranding> {
  try {
    return await api<PublicBranding>('/organization/public-branding', { method: 'GET' });
  } catch {
    return { name: null, brandColor: null, hasLogo: false };
  }
}

/** URL of the client logo (served publicly so the sign-in page can show it). */
export const LOGO_URL = '/api/organization/public-logo';
