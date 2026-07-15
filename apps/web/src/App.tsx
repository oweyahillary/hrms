import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { AppShellLayout } from './layout/AppShellLayout';
import { LoginPage } from './pages/LoginPage';
import { SsoCallbackPage } from './pages/SsoCallbackPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { SettingsPage } from './pages/SettingsPage';

function Placeholder({ name }: { name: string }) {
  return <div style={{ color: 'var(--mantine-color-sand-6)' }}>{name} — coming soon</div>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/sso/callback" element={<SsoCallbackPage />} />
      <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShellLayout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/employees" element={<Placeholder name="Employees" />} />
                <Route path="/leave" element={<Placeholder name="Leave" />} />
                <Route path="/payroll" element={<Placeholder name="Payroll" />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShellLayout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
