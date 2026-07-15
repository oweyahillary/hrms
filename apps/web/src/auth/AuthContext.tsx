import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setOnAuthLost, setAccessToken, getRefreshToken, setRefreshToken } from '../api/client';
import { me, logout as apiLogout, type SessionUser, type Session } from '../api/auth';

interface AuthState {
  user: SessionUser | null;
  ready: boolean; // finished the initial hydrate attempt
  mustChangePassword: boolean;
  adoptSession: (s: Session) => void;
  setUser: (u: SessionUser | null) => void;
  setMustChangePassword: (v: boolean) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // On first load, if a refresh token is stored, try to re-establish the session.
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      if (!getRefreshToken()) { setReady(true); return; }
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: getRefreshToken() }),
      }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json()) as { accessToken: string; refreshToken?: string };
        setAccessToken(data.accessToken);
        if (data.refreshToken) setRefreshToken(data.refreshToken);
        const who = await me().catch(() => null);
        if (!cancelled && who) setUser(who);
      } else {
        setRefreshToken(null);
      }
      if (!cancelled) setReady(true);
    }
    void hydrate();
    return () => { cancelled = true; };
  }, []);

  // If the client gives up refreshing mid-session, drop the user.
  useEffect(() => {
    setOnAuthLost(() => setUser(null));
    return () => setOnAuthLost(null);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user, ready, mustChangePassword,
    adoptSession: (s) => { setUser(s.user); setMustChangePassword(s.mustChangePassword); },
    setUser,
    setMustChangePassword,
    signOut: async () => { await apiLogout(); setUser(null); setMustChangePassword(false); },
  }), [user, ready, mustChangePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
