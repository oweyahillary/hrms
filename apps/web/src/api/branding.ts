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

/**
 * URL of the client logo (public so the sign-in page can show it). `version`
 * busts the browser/CDN cache after an upload or removal — the endpoint sets a
 * 5-minute cache, so a fresh logo would otherwise not appear straight away.
 */
export const logoUrl = (version = 0): string =>
  version > 0 ? `/api/organization/public-logo?v=${version}` : '/api/organization/public-logo';
