DROP INDEX IF EXISTS "ProgressLog_subtaskId_date_key";

CREATE UNIQUE INDEX "ProgressLog_subtaskId_date_userId_key"
ON "ProgressLog"("subtaskId", "date", "userId");
