ALTER TABLE "ScopeMaintenanceTask"
ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TaskMaintenanceSubtask"
ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    link."scopeMaintenanceId",
    link."taskMaintenanceId",
    ROW_NUMBER() OVER (
      PARTITION BY link."scopeMaintenanceId"
      ORDER BY task."order", task."name", task."id"
    ) - 1 AS position
  FROM "ScopeMaintenanceTask" link
  JOIN "TaskMaintenance" task ON task."id" = link."taskMaintenanceId"
)
UPDATE "ScopeMaintenanceTask" link
SET "order" = ranked.position
FROM ranked
WHERE link."scopeMaintenanceId" = ranked."scopeMaintenanceId"
  AND link."taskMaintenanceId" = ranked."taskMaintenanceId";

WITH ranked AS (
  SELECT
    link."taskMaintenanceId",
    link."subtaskMaintenanceId",
    ROW_NUMBER() OVER (
      PARTITION BY link."taskMaintenanceId"
      ORDER BY subtask."order", subtask."name", subtask."id"
    ) - 1 AS position
  FROM "TaskMaintenanceSubtask" link
  JOIN "SubtaskMaintenance" subtask ON subtask."id" = link."subtaskMaintenanceId"
)
UPDATE "TaskMaintenanceSubtask" link
SET "order" = ranked.position
FROM ranked
WHERE link."taskMaintenanceId" = ranked."taskMaintenanceId"
  AND link."subtaskMaintenanceId" = ranked."subtaskMaintenanceId";
