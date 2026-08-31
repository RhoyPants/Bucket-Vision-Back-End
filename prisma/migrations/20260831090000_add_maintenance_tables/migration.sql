CREATE TABLE "MaintenanceTable" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaintenanceTable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceTableBusinessUnit" (
    "maintenanceTableId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    CONSTRAINT "MaintenanceTableBusinessUnit_pkey" PRIMARY KEY ("maintenanceTableId", "businessUnitId")
);

ALTER TABLE "ScopeMaintenance" ADD COLUMN "maintenanceTableId" TEXT;
ALTER TABLE "TaskMaintenance" ADD COLUMN "maintenanceTableId" TEXT;
ALTER TABLE "SubtaskMaintenance" ADD COLUMN "maintenanceTableId" TEXT;

CREATE UNIQUE INDEX "MaintenanceTable_code_key" ON "MaintenanceTable"("code");
CREATE INDEX "MaintenanceTable_isActive_idx" ON "MaintenanceTable"("isActive");
CREATE INDEX "MaintenanceTableBusinessUnit_businessUnitId_idx" ON "MaintenanceTableBusinessUnit"("businessUnitId");
CREATE INDEX "ScopeMaintenance_maintenanceTableId_idx" ON "ScopeMaintenance"("maintenanceTableId");
CREATE INDEX "TaskMaintenance_maintenanceTableId_idx" ON "TaskMaintenance"("maintenanceTableId");
CREATE INDEX "SubtaskMaintenance_maintenanceTableId_idx" ON "SubtaskMaintenance"("maintenanceTableId");

ALTER TABLE "MaintenanceTableBusinessUnit" ADD CONSTRAINT "MaintenanceTableBusinessUnit_maintenanceTableId_fkey"
  FOREIGN KEY ("maintenanceTableId") REFERENCES "MaintenanceTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTableBusinessUnit" ADD CONSTRAINT "MaintenanceTableBusinessUnit_businessUnitId_fkey"
  FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScopeMaintenance" ADD CONSTRAINT "ScopeMaintenance_maintenanceTableId_fkey"
  FOREIGN KEY ("maintenanceTableId") REFERENCES "MaintenanceTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskMaintenance" ADD CONSTRAINT "TaskMaintenance_maintenanceTableId_fkey"
  FOREIGN KEY ("maintenanceTableId") REFERENCES "MaintenanceTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubtaskMaintenance" ADD CONSTRAINT "SubtaskMaintenance_maintenanceTableId_fkey"
  FOREIGN KEY ("maintenanceTableId") REFERENCES "MaintenanceTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
