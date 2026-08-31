ALTER TABLE "Project"
ADD COLUMN "versionForkedAt" TIMESTAMP(3),
ADD COLUMN "progressSyncedAt" TIMESTAMP(3);

ALTER TABLE "Subtask"
ADD COLUMN "sourceSubtaskId" TEXT;

CREATE INDEX "Subtask_sourceSubtaskId_idx" ON "Subtask"("sourceSubtaskId");

ALTER TABLE "ProgressLog"
ADD COLUMN "sourceLogId" TEXT;

CREATE UNIQUE INDEX "ProgressLog_sourceLogId_key" ON "ProgressLog"("sourceLogId");
