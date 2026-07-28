CREATE TYPE "IncidentStatus" AS ENUM ('PENDING', 'RESOLVED', 'CANCELLED');
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "IncidentReport" (
  "id" TEXT NOT NULL,
  "incidentNumber" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "reportedById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "IncidentStatus" NOT NULL DEFAULT 'PENDING',
  "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
  "dateRaised" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dateAddressed" TIMESTAMP(3),
  "remarks" TEXT,
  "scopeId" TEXT,
  "taskId" TEXT,
  "subtaskId" TEXT,
  "resolvedById" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" TEXT,
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncidentAttachment" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncidentAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncidentReport_incidentNumber_key" ON "IncidentReport"("incidentNumber");
CREATE INDEX "IncidentReport_projectId_idx" ON "IncidentReport"("projectId");
CREATE INDEX "IncidentReport_reportedById_idx" ON "IncidentReport"("reportedById");
CREATE INDEX "IncidentReport_status_idx" ON "IncidentReport"("status");
CREATE INDEX "IncidentReport_severity_idx" ON "IncidentReport"("severity");
CREATE INDEX "IncidentReport_dateRaised_idx" ON "IncidentReport"("dateRaised");
CREATE INDEX "IncidentReport_scopeId_idx" ON "IncidentReport"("scopeId");
CREATE INDEX "IncidentReport_taskId_idx" ON "IncidentReport"("taskId");
CREATE INDEX "IncidentReport_subtaskId_idx" ON "IncidentReport"("subtaskId");
CREATE INDEX "IncidentAttachment_incidentId_idx" ON "IncidentAttachment"("incidentId");
CREATE INDEX "IncidentAttachment_uploadedBy_idx" ON "IncidentAttachment"("uploadedBy");

ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_reportedById_fkey"
FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_resolvedById_fkey"
FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_scopeId_fkey"
FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_subtaskId_fkey"
FOREIGN KEY ("subtaskId") REFERENCES "Subtask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IncidentAttachment" ADD CONSTRAINT "IncidentAttachment_incidentId_fkey"
FOREIGN KEY ("incidentId") REFERENCES "IncidentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentAttachment" ADD CONSTRAINT "IncidentAttachment_uploadedBy_fkey"
FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Register the RBAC module and grant the same default full access used by the seed.
INSERT INTO "Module" ("id", "name", "path", "isActive")
VALUES ('9c570456-b219-4a37-ae8c-77ea4958cd67', 'incident_reports', '/incidentReports', true)
ON CONFLICT ("name") DO UPDATE SET "path" = EXCLUDED."path", "isActive" = true;

INSERT INTO "RolePermission" ("id", "roleId", "moduleId", "permissionId")
SELECT
  substr(md5(role."id" || permission."id" || 'incident_reports'), 1, 8) || '-' ||
  substr(md5(role."id" || permission."id" || 'incident_reports'), 9, 4) || '-' ||
  substr(md5(role."id" || permission."id" || 'incident_reports'), 13, 4) || '-' ||
  substr(md5(role."id" || permission."id" || 'incident_reports'), 17, 4) || '-' ||
  substr(md5(role."id" || permission."id" || 'incident_reports'), 21, 12),
  role."id",
  module."id",
  permission."id"
FROM "Role" AS role
CROSS JOIN "Permission" AS permission
JOIN "Module" AS module ON module."name" = 'incident_reports'
ON CONFLICT ("roleId", "moduleId", "permissionId") DO NOTHING;
