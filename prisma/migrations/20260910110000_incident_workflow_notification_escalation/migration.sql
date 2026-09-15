-- Preserve the existing workflow library and all captured incident workflow data.
ALTER TABLE "EscalationMatrix" RENAME TO "IncidentWorkflow";
ALTER TABLE "IncidentType" RENAME COLUMN "escalationMatrixId" TO "incidentWorkflowId";
ALTER TABLE "IncidentReport" RENAME COLUMN "escalationMatrixId" TO "incidentWorkflowId";
ALTER TABLE "IncidentReport" RENAME COLUMN "escalationSnapshot" TO "workflowSnapshot";
ALTER TABLE "IncidentReport" RENAME COLUMN "escalation" TO "workflow";
ALTER TABLE "IncidentReport" RENAME COLUMN "slaDeadline" TO "levelSlaDeadline";
ALTER TABLE "IncidentReport" RENAME COLUMN "escalationRevision" TO "workflowRevision";

CREATE TABLE "EscalationNotificationMatrix" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "levels" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscalationNotificationMatrix_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "IncidentType"
  ADD COLUMN "resolutionSlaValue" DOUBLE PRECISION,
  ADD COLUMN "resolutionSlaUnit" TEXT,
  ADD COLUMN "notificationMatrixId" TEXT;

ALTER TABLE "IncidentReport"
  ADD COLUMN "overallSlaSnapshot" JSONB,
  ADD COLUMN "overallSlaDeadline" TIMESTAMP(3),
  ADD COLUMN "overallSlaBreachedAt" TIMESTAMP(3),
  ADD COLUMN "notificationMatrixId" TEXT,
  ADD COLUMN "notificationMatrixSnapshot" JSONB,
  ADD COLUMN "notificationEscalation" JSONB,
  ADD COLUMN "nextNotificationAt" TIMESTAMP(3);

CREATE INDEX "IncidentReport_status_overallSlaDeadline_idx" ON "IncidentReport"("status", "overallSlaDeadline");
CREATE INDEX "IncidentReport_status_nextNotificationAt_idx" ON "IncidentReport"("status", "nextNotificationAt");
CREATE INDEX "IncidentReport_notificationMatrixId_idx" ON "IncidentReport"("notificationMatrixId");
CREATE INDEX "IncidentType_notificationMatrixId_idx" ON "IncidentType"("notificationMatrixId");

ALTER TABLE "IncidentType" ADD CONSTRAINT "IncidentType_notificationMatrixId_fkey" FOREIGN KEY ("notificationMatrixId") REFERENCES "EscalationNotificationMatrix"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_notificationMatrixId_fkey" FOREIGN KEY ("notificationMatrixId") REFERENCES "EscalationNotificationMatrix"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
