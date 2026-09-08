ALTER TABLE "ProgressUpdateRequest"
ADD COLUMN "assignedApproverId" TEXT,
ADD COLUMN "businessUnitId" TEXT;

-- Backfill requests that can be matched to the project's configured Business Unit.
UPDATE "ProgressUpdateRequest" pur
SET "businessUnitId" = bu."id",
    "assignedApproverId" = bu."buHeadUserId"
FROM "ProgressLog" pl
JOIN "Subtask" st ON st."id" = pl."subtaskId"
JOIN "Task" t ON t."id" = st."taskId"
JOIN "Scope" s ON s."id" = t."scopeId"
JOIN "Project" p ON p."id" = s."projectId"
JOIN "User" owner ON owner."id" = p."ownerId"
JOIN "BusinessUnit" bu ON bu."isActive" = true AND (
  bu."id" = p."businessUnit"
  OR LOWER(bu."code") = LOWER(p."businessUnit")
  OR LOWER(bu."name") = LOWER(p."businessUnit")
  OR (p."businessUnit" IS NULL AND bu."id" = owner."businessUnitId")
)
WHERE pur."progressLogId" = pl."id";

CREATE INDEX "ProgressUpdateRequest_requestedById_status_createdAt_idx"
ON "ProgressUpdateRequest"("requestedById", "status", "createdAt");

CREATE INDEX "ProgressUpdateRequest_status_assignedApproverId_createdAt_idx"
ON "ProgressUpdateRequest"("status", "assignedApproverId", "createdAt");

CREATE UNIQUE INDEX "ProgressUpdateRequest_one_pending_per_log_idx"
ON "ProgressUpdateRequest"("progressLogId")
WHERE "status" = 'PENDING';

DROP INDEX IF EXISTS "ProgressUpdateRequest_requestedById_status_idx";
DROP INDEX IF EXISTS "ProgressUpdateRequest_status_createdAt_idx";

ALTER TABLE "ProgressUpdateRequest"
ADD CONSTRAINT "ProgressUpdateRequest_assignedApproverId_fkey"
FOREIGN KEY ("assignedApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProgressUpdateRequest"
ADD CONSTRAINT "ProgressUpdateRequest_businessUnitId_fkey"
FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
