-- Additive local-safe migration: it never reads or updates Project, Scope, Task,
-- or Subtask records. Only maintenance master records are grouped into one
-- globally available legacy template.
ALTER TABLE "MaintenanceTable"
  ADD COLUMN "isGlobal" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "MaintenanceTable" (
  "id", "code", "name", "description", "isActive", "isGlobal", "createdAt", "updatedAt"
)
VALUES (
  'legacy-default-maintenance-template',
  'LEGACY_DEFAULT',
  'Default Legacy WBS',
  'Existing maintenance records retained from before maintenance templates.',
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET "isGlobal" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "ScopeMaintenance"
SET "maintenanceTableId" = (SELECT "id" FROM "MaintenanceTable" WHERE "code" = 'LEGACY_DEFAULT')
WHERE "maintenanceTableId" IS NULL;

UPDATE "TaskMaintenance"
SET "maintenanceTableId" = (SELECT "id" FROM "MaintenanceTable" WHERE "code" = 'LEGACY_DEFAULT')
WHERE "maintenanceTableId" IS NULL;

UPDATE "SubtaskMaintenance"
SET "maintenanceTableId" = (SELECT "id" FROM "MaintenanceTable" WHERE "code" = 'LEGACY_DEFAULT')
WHERE "maintenanceTableId" IS NULL;
