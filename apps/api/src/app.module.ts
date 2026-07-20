import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';
import { DepartmentsModule } from './departments/departments.module';
import { JobTitlesModule } from './job-titles/job-titles.module';
import { LeaveModule } from './leave/leave.module';
import { PublicHolidaysModule } from './public-holidays/public-holidays.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PayrollModule } from './payroll/payroll.module';
import { SeveranceModule } from './severance/severance.module';
import { LoansModule } from './loans/loans.module';
import { SalaryModule } from './salary/salary.module';
import { ComplianceModule } from './compliance/compliance.module';
import { OrganizationModule } from './organization/organization.module';
import { ReportsModule } from './reports/reports.module';
import { HealthModule } from './health/health.module';

// The RequestContextMiddleware is bound globally in main.ts (app.use).
// AuthModule registers a GLOBAL JwtAuthGuard — every route requires a valid
// access token unless marked @Public (see health + auth controllers).
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    CryptoModule,
    StorageModule,
    AuthModule,
    EmployeesModule,
    DepartmentsModule,
    JobTitlesModule,
    LeaveModule,
    PublicHolidaysModule,
    AttendanceModule,
    PayrollModule,
    SeveranceModule,
    LoansModule,
    SalaryModule,
    ComplianceModule,
    OrganizationModule,
    ReportsModule,
    HealthModule,
    // Feature modules land here as they are built:
    // employees, attendance, leave, payroll, compliance
  ],
})
export class AppModule {}
