
-- CreateEnum
CREATE TYPE "OvertimeHourlyRateBasis" AS ENUM ('MONTHLY_X12_DIV_52_WEEKLY_HOURS', 'MONTHLY_DIV_26_DIV_8');

-- CreateEnum
CREATE TYPE "OvertimeCategory" AS ENUM ('NORMAL_DAY', 'REST_DAY', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "OvertimeSource" AS ENUM ('DERIVED', 'MANUAL');

-- CreateEnum
CREATE TYPE "OvertimeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "overtime_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "normalDayMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.5,
    "restDayMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 2.0,
    "holidayMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 2.0,
    "hourlyRateBasis" "OvertimeHourlyRateBasis" NOT NULL DEFAULT 'MONTHLY_X12_DIV_52_WEEKLY_HOURS',
    "normalWeeklyHours" INTEGER NOT NULL DEFAULT 45,
    "minimumMinutesToCount" INTEGER NOT NULL DEFAULT 30,
    "maxHoursPerDay" DECIMAL(4,2),
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overtime_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "category" "OvertimeCategory" NOT NULL,
    "source" "OvertimeSource" NOT NULL DEFAULT 'DERIVED',
    "status" "OvertimeStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "payrollRunId" TEXT,
    "amount" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overtime_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "overtime_policies_organizationId_effectiveFrom_idx" ON "overtime_policies"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "overtime_entries_organizationId_idx" ON "overtime_entries"("organizationId");

-- CreateIndex
CREATE INDEX "overtime_entries_employeeId_status_idx" ON "overtime_entries"("employeeId", "status");

-- CreateIndex
CREATE INDEX "overtime_entries_organizationId_status_idx" ON "overtime_entries"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "overtime_entries_employeeId_date_source_key" ON "overtime_entries"("employeeId", "date", "source");

-- AddForeignKey
ALTER TABLE "overtime_policies" ADD CONSTRAINT "overtime_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_entries" ADD CONSTRAINT "overtime_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_entries" ADD CONSTRAINT "overtime_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_entries" ADD CONSTRAINT "overtime_entries_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_entries" ADD CONSTRAINT "overtime_entries_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

