import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getPublicBranding, type PublicBranding } from '../api/branding';

const EMPTY: PublicBranding = { name: null, brandColor: null, hasLogo: false };

const BrandingContext = createContext<{ branding: PublicBranding; loaded: boolean }>({
  branding: EMPTY, loaded: false,
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<PublicBranding>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPublicBranding().then((b) => {
      if (cancelled) return;
      setBranding(b);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, loaded }}>{children}</BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
