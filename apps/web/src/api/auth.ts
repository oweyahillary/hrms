import { api, setAccessToken, setRefreshToken, getRefreshToken } from './client';

export interface SessionUser {
  id: string; email: string; role: string; organizationId: string;
  organizationName?: string;
}
export interface Session {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  user: SessionUser;
}
export interface MfaChallenge { mfaRequired: true; mfaToken: string; }
export type LoginResult = Session | MfaChallenge;

export function isMfaChallenge(r: LoginResult): r is MfaChallenge {
  return (r as MfaChallenge).mfaRequired === true;
}

function adopt(session: Session): Session {
  setAccessToken(session.accessToken);
  setRefreshToken(session.refreshToken);
  return session;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const r = await api<LoginResult>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  if (isMfaChallenge(r)) return r;
  return adopt(r);
}

export async function verifyMfa(mfaToken: string, code: string): Promise<Session> {
  const s = await api<Session>('/auth/mfa/verify', {
    method: 'POST', body: JSON.stringify({ mfaToken, code }),
  });
  return adopt(s);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<Session> {
  const s = await api<Session>('/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
  });
  return adopt(s);
}

export async function me(): Promise<SessionUser> {
  return api<SessionUser>('/auth/me', { method: 'GET' });
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) });
    }
  } finally {
    setAccessToken(null);
    setRefreshToken(null);
  }
}
