CREATE TABLE "PinMaster" (
    "id" TEXT NOT NULL,
    "sharePointItemId" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "projectName" TEXT,
    "description" TEXT,
    "businessUnit" TEXT,
    "entity" TEXT,
    "location" JSONB,
    "totalBudget" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "expectedEndDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sharePointModifiedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PinMaster_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PinMaster_sharePointItemId_key" ON "PinMaster"("sharePointItemId");
CREATE UNIQUE INDEX "PinMaster_pin_key" ON "PinMaster"("pin");
CREATE INDEX "PinMaster_isActive_idx" ON "PinMaster"("isActive");
CREATE INDEX "PinMaster_projectName_idx" ON "PinMaster"("projectName");

ALTER TABLE "Project" ADD COLUMN "pinMasterId" TEXT;
CREATE INDEX "Project_pinMasterId_idx" ON "Project"("pinMasterId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_pinMasterId_fkey" FOREIGN KEY ("pinMasterId") REFERENCES "PinMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
