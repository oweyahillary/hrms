import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { buildTheme } from './theme';
import { BrandingProvider, useBranding } from './branding/BrandingContext';
import { AuthProvider } from './auth/AuthContext';
import { App } from './App';

/** Applies the client's brand colour to the theme once branding has loaded. */
function ThemedRoot() {
  const { branding } = useBranding();
  const theme = useMemo(() => buildTheme(branding.brandColor), [branding.brandColor]);
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </MantineProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrandingProvider>
      <ThemedRoot />
    </BrandingProvider>
  </StrictMode>,
);
