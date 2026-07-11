-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'CONTRACT', 'CASUAL', 'INTERN');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ID_COPY', 'CONTRACT', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'BIOMETRIC', 'APP');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SalaryComponentType" AS ENUM ('ALLOWANCE', 'DEDUCTION_VOLUNTARY');

-- CreateEnum
CREATE TYPE "StatutoryRateType" AS ENUM ('PAYE_BAND', 'NSSF', 'SHIF', 'AHL');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PROCESSING', 'FINALIZED', 'PAID');

-- CreateEnum
CREATE TYPE "PayrollRunType" AS ENUM ('REGULAR', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LawfulBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST');

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'ERASURE');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BreachStatus" AS ENUM ('OPEN', 'CONTAINED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('RESIGNATION', 'TERMINATION', 'REDUNDANCY', 'RETIREMENT');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kraPin" TEXT,
    "physicalAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "employeeId" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentDepartmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "grade" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nationalId" TEXT NOT NULL,
    "nationalIdHmac" TEXT NOT NULL,
    "kraPin" TEXT,
    "kraPinHmac" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "departmentId" TEXT,
    "jobTitleId" TEXT,
    "employmentType" "EmploymentType" NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "hireDate" DATE NOT NULL,
    "exitDate" DATE,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "nextOfKin" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL,
    "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "maxDaysPerYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "accruedDays" DECIMAL(5,2) NOT NULL,
    "usedDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "carriedOverDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "daysRequested" DECIMAL(5,2) NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_approval_steps" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "actedAt" TIMESTAMP(3),

    CONSTRAINT "leave_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(12,2) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "endDate" DATE,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "componentType" "SalaryComponentType" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_rates" (
    "id" TEXT NOT NULL,
    "rateType" "StatutoryRateType" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "parameters" JSONB NOT NULL,

    CONSTRAINT "statutory_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "runType" "PayrollRunType" NOT NULL DEFAULT 'REGULAR',
    "correctsRunId" TEXT,
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "grossPay" DECIMAL(12,2) NOT NULL,
    "paye" DECIMAL(12,2) NOT NULL,
    "nssfEmployee" DECIMAL(12,2) NOT NULL,
    "nssfEmployer" DECIMAL(12,2) NOT NULL,
    "shif" DECIMAL(12,2) NOT NULL,
    "ahlEmployee" DECIMAL(12,2) NOT NULL,
    "ahlEmployer" DECIMAL(12,2) NOT NULL,
    "otherDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(12,2) NOT NULL,
    "oneThirdRulePass" BOOLEAN NOT NULL,
    "pdfPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_export_batches" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT NOT NULL,

    CONSTRAINT "bank_export_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "lawfulBasis" "LawfulBasis" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestType" "DataSubjectRequestType" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "retentionPeriodMonths" INTEGER NOT NULL,
    "legalBasisNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breach_incidents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "affectedEmployeeCount" INTEGER NOT NULL,
    "odpcNotifiedAt" TIMESTAMP(3),
    "employeesNotifiedAt" TIMESTAMP(3),
    "status" "BreachStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "breach_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "severance_calculations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "exitDate" DATE NOT NULL,
    "reason" "ExitReason" NOT NULL,
    "noticePeriodDays" INTEGER NOT NULL,
    "severanceAmount" DECIMAL(12,2) NOT NULL,
    "calculationBreakdown" JSONB NOT NULL,
    "calculatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "severance_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeId_key" ON "users"("employeeId");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_email_key" ON "users"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "roles_organizationId_idx" ON "roles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_name_key" ON "roles"("organizationId", "name");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "departments_organizationId_idx" ON "departments"("organizationId");

-- CreateIndex
CREATE INDEX "departments_parentDepartmentId_idx" ON "departments"("parentDepartmentId");

-- CreateIndex
CREATE INDEX "job_titles_organizationId_idx" ON "job_titles"("organizationId");

-- CreateIndex
CREATE INDEX "employees_nationalIdHmac_idx" ON "employees"("nationalIdHmac");

-- CreateIndex
CREATE INDEX "employees_kraPinHmac_idx" ON "employees"("kraPinHmac");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_jobTitleId_idx" ON "employees"("jobTitleId");

-- CreateIndex
CREATE INDEX "employees_employmentStatus_idx" ON "employees"("employmentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organizationId_employeeNumber_key" ON "employees"("organizationId", "employeeNumber");

-- CreateIndex
CREATE INDEX "employee_documents_organizationId_idx" ON "employee_documents"("organizationId");

-- CreateIndex
CREATE INDEX "employee_documents_employeeId_idx" ON "employee_documents"("employeeId");

-- CreateIndex
CREATE INDEX "public_holidays_date_idx" ON "public_holidays"("date");

-- CreateIndex
CREATE INDEX "attendance_records_organizationId_idx" ON "attendance_records"("organizationId");

-- CreateIndex
CREATE INDEX "attendance_records_employeeId_date_idx" ON "attendance_records"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_organizationId_name_key" ON "leave_types"("organizationId", "name");

-- CreateIndex
CREATE INDEX "leave_balances_organizationId_idx" ON "leave_balances"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeId_leaveTypeId_year_key" ON "leave_balances"("employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE INDEX "leave_requests_organizationId_idx" ON "leave_requests"("organizationId");

-- CreateIndex
CREATE INDEX "leave_requests_employeeId_idx" ON "leave_requests"("employeeId");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "leave_approval_steps_leaveRequestId_idx" ON "leave_approval_steps"("leaveRequestId");

-- CreateIndex
CREATE INDEX "leave_approval_steps_approverUserId_idx" ON "leave_approval_steps"("approverUserId");

-- CreateIndex
CREATE INDEX "salary_structures_organizationId_idx" ON "salary_structures"("organizationId");

-- CreateIndex
CREATE INDEX "salary_structures_employeeId_idx" ON "salary_structures"("employeeId");

-- CreateIndex
CREATE INDEX "salary_components_salaryStructureId_idx" ON "salary_components"("salaryStructureId");

-- CreateIndex
CREATE INDEX "statutory_rates_rateType_effectiveDate_idx" ON "statutory_rates"("rateType", "effectiveDate");

-- CreateIndex
CREATE INDEX "payroll_runs_organizationId_periodYear_periodMonth_idx" ON "payroll_runs"("organizationId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "payslips_payrollRunId_employeeId_idx" ON "payslips"("payrollRunId", "employeeId");

-- CreateIndex
CREATE INDEX "payslips_employeeId_idx" ON "payslips"("employeeId");

-- CreateIndex
CREATE INDEX "bank_export_batches_payrollRunId_idx" ON "bank_export_batches"("payrollRunId");

-- CreateIndex
CREATE INDEX "consent_records_organizationId_idx" ON "consent_records"("organizationId");

-- CreateIndex
CREATE INDEX "consent_records_employeeId_idx" ON "consent_records"("employeeId");

-- CreateIndex
CREATE INDEX "data_subject_requests_organizationId_idx" ON "data_subject_requests"("organizationId");

-- CreateIndex
CREATE INDEX "data_subject_requests_employeeId_idx" ON "data_subject_requests"("employeeId");

-- CreateIndex
CREATE INDEX "data_subject_requests_dueDate_idx" ON "data_subject_requests"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_organizationId_recordType_key" ON "retention_policies"("organizationId", "recordType");

-- CreateIndex
CREATE INDEX "breach_incidents_organizationId_idx" ON "breach_incidents"("organizationId");

-- CreateIndex
CREATE INDEX "severance_calculations_organizationId_idx" ON "severance_calculations"("organizationId");

-- CreateIndex
CREATE INDEX "severance_calculations_employeeId_idx" ON "severance_calculations"("employeeId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentDepartmentId_fkey" FOREIGN KEY ("parentDepartmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "job_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_approval_steps" ADD CONSTRAINT "leave_approval_steps_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_approval_steps" ADD CONSTRAINT "leave_approval_steps_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "salary_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_correctsRunId_fkey" FOREIGN KEY ("correctsRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_export_batches" ADD CONSTRAINT "bank_export_batches_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_export_batches" ADD CONSTRAINT "bank_export_batches_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breach_incidents" ADD CONSTRAINT "breach_incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "severance_calculations" ADD CONSTRAINT "severance_calculations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "severance_calculations" ADD CONSTRAINT "severance_calculations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "severance_calculations" ADD CONSTRAINT "severance_calculations_calculatedById_fkey" FOREIGN KEY ("calculatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
