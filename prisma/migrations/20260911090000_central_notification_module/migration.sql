ALTER TABLE "Notification"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "title" TEXT,
  ADD COLUMN "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgementRemarks" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "actorId" TEXT,
  ADD COLUMN "target" JSONB,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "eventKey" TEXT;

UPDATE "Notification" SET "readAt" = "createdAt" WHERE "isRead" = true AND "readAt" IS NULL;

DROP INDEX IF EXISTS "Notification_userId_idx";
DROP INDEX IF EXISTS "Notification_isRead_idx";
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE INDEX "Notification_userId_archivedAt_createdAt_idx" ON "Notification"("userId", "archivedAt", "createdAt");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_userId_acknowledgedAt_idx" ON "Notification"("userId", "acknowledgedAt");
CREATE INDEX "Notification_category_idx" ON "Notification"("category");
