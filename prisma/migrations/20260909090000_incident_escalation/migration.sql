-- AlterTable
ALTER TABLE "IncidentReport" ADD COLUMN     "escalation" JSONB,
ADD COLUMN     "escalationMatrixId" TEXT,
ADD COLUMN     "escalationRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "escalationSnapshot" JSONB,
ADD COLUMN     "incidentTypeId" TEXT,
ADD COLUMN     "slaDeadline" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EscalationMatrix" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowPeerResolution" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "levels" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultCriticality" "IncidentSeverity" NOT NULL,
    "escalationMatrixId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEscalationEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "levelId" TEXT,
    "actorId" TEXT,
    "details" JSONB NOT NULL,

    CONSTRAINT "IncidentEscalationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentType_escalationMatrixId_idx" ON "IncidentType"("escalationMatrixId");

-- CreateIndex
CREATE INDEX "IncidentEscalationEvent_incidentId_timestamp_idx" ON "IncidentEscalationEvent"("incidentId", "timestamp");


-- CreateIndex
CREATE INDEX "IncidentReport_status_slaDeadline_idx" ON "IncidentReport"("status", "slaDeadline");

-- CreateIndex
CREATE INDEX "IncidentReport_incidentTypeId_idx" ON "IncidentReport"("incidentTypeId");

-- CreateIndex
CREATE INDEX "IncidentReport_escalationMatrixId_idx" ON "IncidentReport"("escalationMatrixId");

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_incidentTypeId_fkey" FOREIGN KEY ("incidentTypeId") REFERENCES "IncidentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_escalationMatrixId_fkey" FOREIGN KEY ("escalationMatrixId") REFERENCES "EscalationMatrix"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentType" ADD CONSTRAINT "IncidentType_escalationMatrixId_fkey" FOREIGN KEY ("escalationMatrixId") REFERENCES "EscalationMatrix"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEscalationEvent" ADD CONSTRAINT "IncidentEscalationEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "IncidentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dedicated Settings permissions, initially granted to existing approval-flow administrators.
INSERT INTO "Module" ("id", "name", "path", "isActive") VALUES
('incident-escalation-matrices-module', 'settings_escalation_matrices', '/settings/escalation-matrices', true),
('incident-types-module', 'settings_incident_types', '/settings/incident-types', true)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "moduleId", "permissionId")
SELECT md5(r."id" || m."id" || p."id"), r."id", m."id", p."id"
FROM "Role" r CROSS JOIN "Module" m CROSS JOIN "Permission" p
WHERE m."name" IN ('settings_escalation_matrices', 'settings_incident_types')
AND p."action" IN ('CREATE', 'READ', 'UPDATE', 'DELETE')
AND (r."name" = 'SUPERADMIN' OR EXISTS (
  SELECT 1 FROM "RolePermission" rp JOIN "Module" source ON source."id" = rp."moduleId"
  WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id" AND source."name" = 'settings_approval_flows'
)) ON CONFLICT ("roleId", "moduleId", "permissionId") DO NOTHING;
