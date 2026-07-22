import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { AppShellLayout } from './layout/AppShellLayout';
import { LoginPage } from './pages/LoginPage';
import { SsoCallbackPage } from './pages/SsoCallbackPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';
import { EmployeeCreatePage } from './pages/EmployeeCreatePage';
import { EmployeeEditPage } from './pages/EmployeeEditPage';
import { LeavePage } from './pages/LeavePage';
import { LeaveApplyPage } from './pages/LeaveApplyPage';
import { LeaveBalancesPage } from './pages/LeaveBalancesPage';
import { LeaveTypesPage } from './pages/LeaveTypesPage';
import { PayrollLayout } from './layout/PayrollLayout';
import { PayrollRunsPage } from './pages/PayrollRunsPage';
import { PayrollRunCreatePage } from './pages/PayrollRunCreatePage';
import { PayrollRunDetailPage } from './pages/PayrollRunDetailPage';
import { PayrollPreviewPage } from './pages/PayrollPreviewPage';
import { PayrollSetupPage } from './pages/PayrollSetupPage';
import { LoansPage } from './pages/LoansPage';
import { LoanCreatePage } from './pages/LoanCreatePage';
import { DeductionsPage } from './pages/DeductionsPage';
import { AdjustmentCreatePage } from './pages/AdjustmentCreatePage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SettingsLeavePage } from './pages/SettingsLeavePage';
import { SettingsNumberingPage } from './pages/SettingsNumberingPage';
import { SettingsPayrollPage } from './pages/SettingsPayrollPage';

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
                <Route path="/employees" element={<EmployeesPage />} />
                <Route path="/employees/new" element={<EmployeeCreatePage />} />
                <Route path="/employees/:id" element={<EmployeeDetailPage />} />
                <Route path="/employees/:id/edit" element={<EmployeeEditPage />} />
                <Route path="/leave" element={<LeavePage />} />
                <Route path="/leave/apply" element={<LeaveApplyPage />} />
                <Route path="/leave/balances" element={<LeaveBalancesPage />} />
                <Route path="/leave/types" element={<LeaveTypesPage />} />
                <Route path="/payroll" element={<PayrollLayout />}>
                  <Route index element={<PayrollRunsPage />} />
                  <Route path="new" element={<PayrollRunCreatePage />} />
                  <Route path="preview" element={<PayrollPreviewPage />} />
                  <Route path="setup" element={<PayrollSetupPage />} />
                  <Route path="setup/loans" element={<LoansPage />} />
                  <Route path="setup/loans/new" element={<LoanCreatePage />} />
                  <Route path="setup/deductions" element={<DeductionsPage />} />
                  <Route path="setup/deductions/new" element={<AdjustmentCreatePage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path=":id" element={<PayrollRunDetailPage />} />
                </Route>
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/leave" element={<SettingsLeavePage />} />
                <Route path="/settings/numbering" element={<SettingsNumberingPage />} />
                <Route path="/settings/payroll" element={<SettingsPayrollPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShellLayout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
