-- CreateTable
CREATE TABLE "attendance_devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_punches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "devicePin" TEXT NOT NULL,
    "employeeId" TEXT,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" VARCHAR(500),

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_devices_serialNumber_key" ON "attendance_devices"("serialNumber");

-- CreateIndex
CREATE INDEX "attendance_devices_organizationId_idx" ON "attendance_devices"("organizationId");

-- CreateIndex
CREATE INDEX "attendance_punches_organizationId_punchedAt_idx" ON "attendance_punches"("organizationId", "punchedAt");

-- CreateIndex
CREATE INDEX "attendance_punches_devicePin_idx" ON "attendance_punches"("devicePin");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_punches_deviceId_devicePin_punchedAt_key" ON "attendance_punches"("deviceId", "devicePin", "punchedAt");

-- AddForeignKey
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "attendance_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

