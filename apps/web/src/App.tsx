import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { RequirePermission } from './auth/RequirePermission';
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
import { SettingsDepartmentsPage } from './pages/SettingsDepartmentsPage';
import { SettingsRolesPage } from './pages/SettingsRolesPage';
import { UsersPage } from './pages/UsersPage';
import { InviteUserPage } from './pages/InviteUserPage';
import { MyPayslipsPage } from './pages/MyPayslipsPage';
import { MyLeavePage } from './pages/MyLeavePage';
import { MyProfilePage } from './pages/MyProfilePage';
import { ShiftsPage } from './pages/ShiftsPage';
import { SettingsShiftsPage } from './pages/SettingsShiftsPage';
import { SettingsDevicesPage } from './pages/SettingsDevicesPage';
import { AttendancePage } from './pages/AttendancePage';
import { MyAttendancePage } from './pages/MyAttendancePage';
import { OvertimePage } from './pages/OvertimePage';
import { SettingsOvertimePage } from './pages/SettingsOvertimePage';
import { MyOvertimePage } from './pages/MyOvertimePage';

const PAYROLL_PERMS = ['payroll.run', 'payroll.finalize', 'payroll.manage'];
const SETTINGS_PERMS = [
  'settings.manage', 'users.manage', 'org_structure.manage', 'shifts.manage',
  'attendance.manage', 'statutory_rates.manage', 'compliance.manage', 'payroll.manage',
];

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
                <Route path="/employees" element={<RequirePermission permission="employees.write"><EmployeesPage /></RequirePermission>} />
                <Route path="/employees/new" element={<RequirePermission permission="employees.write"><EmployeeCreatePage /></RequirePermission>} />
                <Route path="/employees/:id" element={<RequirePermission permission="employees.write"><EmployeeDetailPage /></RequirePermission>} />
                <Route path="/employees/:id/edit" element={<RequirePermission permission="employees.write"><EmployeeEditPage /></RequirePermission>} />
                <Route path="/leave" element={<RequirePermission permission="leave.manage"><LeavePage /></RequirePermission>} />
                {/* Shared: linked from both the HR "Leave" section and everyone's "My Leave" — not permission-gated. */}
                <Route path="/leave/apply" element={<LeaveApplyPage />} />
                <Route path="/leave/balances" element={<RequirePermission permission="leave.manage"><LeaveBalancesPage /></RequirePermission>} />
                <Route path="/leave/types" element={<RequirePermission permission="leave.manage"><LeaveTypesPage /></RequirePermission>} />
                <Route path="/shifts" element={<RequirePermission permission="shifts.manage"><ShiftsPage /></RequirePermission>} />
                <Route path="/attendance" element={<RequirePermission permission="attendance.manage"><AttendancePage /></RequirePermission>} />
                {/* payroll.manage is a temporary mapping — overtime predates the granular catalogue and never had its own key; see feat/granular-permissions. */}
                <Route path="/overtime" element={<RequirePermission permission="payroll.manage"><OvertimePage /></RequirePermission>} />
                <Route path="/payroll" element={<RequirePermission permission={PAYROLL_PERMS}><PayrollLayout /></RequirePermission>}>
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
                <Route path="/settings" element={<RequirePermission permission={SETTINGS_PERMS}><SettingsPage /></RequirePermission>} />
                <Route path="/settings/leave" element={<RequirePermission permission="settings.manage"><SettingsLeavePage /></RequirePermission>} />
                <Route path="/settings/numbering" element={<RequirePermission permission="settings.manage"><SettingsNumberingPage /></RequirePermission>} />
                <Route path="/settings/payroll" element={<RequirePermission permission="settings.manage"><SettingsPayrollPage /></RequirePermission>} />
                <Route path="/settings/departments" element={<RequirePermission permission="org_structure.manage"><SettingsDepartmentsPage /></RequirePermission>} />
                <Route path="/settings/shifts" element={<RequirePermission permission="shifts.manage"><SettingsShiftsPage /></RequirePermission>} />
                <Route path="/settings/devices" element={<RequirePermission permission="attendance.manage"><SettingsDevicesPage /></RequirePermission>} />
                <Route path="/settings/overtime" element={<RequirePermission permission="payroll.manage"><SettingsOvertimePage /></RequirePermission>} />
                <Route path="/settings/users" element={<RequirePermission permission="users.manage"><UsersPage /></RequirePermission>} />
                <Route path="/settings/users/new" element={<RequirePermission permission="users.manage"><InviteUserPage /></RequirePermission>} />
                <Route path="/settings/roles" element={<RequirePermission permission="users.manage"><SettingsRolesPage /></RequirePermission>} />
                <Route path="/me/payslips" element={<MyPayslipsPage />} />
                <Route path="/me/leave" element={<MyLeavePage />} />
                <Route path="/me/profile" element={<MyProfilePage />} />
                <Route path="/me/attendance" element={<MyAttendancePage />} />
                <Route path="/me/overtime" element={<MyOvertimePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShellLayout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
