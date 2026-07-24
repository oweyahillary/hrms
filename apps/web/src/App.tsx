import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { canManageEmployees, canManageOrg } from './auth/roles';
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
import { UsersPage } from './pages/UsersPage';
import { InviteUserPage } from './pages/InviteUserPage';
import { MyPayslipsPage } from './pages/MyPayslipsPage';
import { MyLeavePage } from './pages/MyLeavePage';
import { MyProfilePage } from './pages/MyProfilePage';
import { ShiftsPage } from './pages/ShiftsPage';
import { SettingsShiftsPage } from './pages/SettingsShiftsPage';
import { AttendancePage } from './pages/AttendancePage';
import { MyAttendancePage } from './pages/MyAttendancePage';

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
                <Route path="/employees" element={<RequireRole check={canManageEmployees}><EmployeesPage /></RequireRole>} />
                <Route path="/employees/new" element={<RequireRole check={canManageEmployees}><EmployeeCreatePage /></RequireRole>} />
                <Route path="/employees/:id" element={<RequireRole check={canManageEmployees}><EmployeeDetailPage /></RequireRole>} />
                <Route path="/employees/:id/edit" element={<RequireRole check={canManageEmployees}><EmployeeEditPage /></RequireRole>} />
                <Route path="/leave" element={<RequireRole check={canManageEmployees}><LeavePage /></RequireRole>} />
                {/* Shared: linked from both the HR "Leave" section and everyone's "My Leave" — not role-gated. */}
                <Route path="/leave/apply" element={<LeaveApplyPage />} />
                <Route path="/leave/balances" element={<RequireRole check={canManageEmployees}><LeaveBalancesPage /></RequireRole>} />
                <Route path="/leave/types" element={<RequireRole check={canManageEmployees}><LeaveTypesPage /></RequireRole>} />
                <Route path="/shifts" element={<RequireRole check={canManageEmployees}><ShiftsPage /></RequireRole>} />
                <Route path="/attendance" element={<RequireRole check={canManageEmployees}><AttendancePage /></RequireRole>} />
                <Route path="/payroll" element={<RequireRole check={canManageEmployees}><PayrollLayout /></RequireRole>}>
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
                <Route path="/settings" element={<RequireRole check={canManageOrg}><SettingsPage /></RequireRole>} />
                <Route path="/settings/leave" element={<RequireRole check={canManageOrg}><SettingsLeavePage /></RequireRole>} />
                <Route path="/settings/numbering" element={<RequireRole check={canManageOrg}><SettingsNumberingPage /></RequireRole>} />
                <Route path="/settings/payroll" element={<RequireRole check={canManageOrg}><SettingsPayrollPage /></RequireRole>} />
                <Route path="/settings/shifts" element={<RequireRole check={canManageOrg}><SettingsShiftsPage /></RequireRole>} />
                <Route path="/settings/users" element={<RequireRole check={canManageOrg}><UsersPage /></RequireRole>} />
                <Route path="/settings/users/new" element={<RequireRole check={canManageOrg}><InviteUserPage /></RequireRole>} />
                <Route path="/me/payslips" element={<MyPayslipsPage />} />
                <Route path="/me/leave" element={<MyLeavePage />} />
                <Route path="/me/profile" element={<MyProfilePage />} />
                <Route path="/me/attendance" element={<MyAttendancePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShellLayout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
