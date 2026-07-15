import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPublicBranding, type PublicBranding } from '../api/branding';

const EMPTY: PublicBranding = { name: null, brandColor: null, hasLogo: false };

interface BrandingState {
  branding: PublicBranding;
  loaded: boolean;
  /** Bumped on every refresh — used to bust the cached logo image. */
  version: number;
  /** Re-read branding (after a settings save) so the theme/logo update live. */
  refresh: () => Promise<void>;
}

const BrandingContext = createContext<BrandingState>({
  branding: EMPTY, loaded: false, version: 0, refresh: async () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<PublicBranding>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const b = await getPublicBranding();
    setBranding(b);
    setVersion((v) => v + 1);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPublicBranding().then((b) => {
      if (cancelled) return;
      setBranding(b);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<BrandingState>(
    () => ({ branding, loaded, version, refresh }),
    [branding, loaded, version, refresh],
  );
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingState {
  return useContext(BrandingContext);
}
