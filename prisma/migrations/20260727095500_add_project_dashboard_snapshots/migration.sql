CREATE TABLE "ProjectDashboardSnapshot" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "critical" INTEGER NOT NULL DEFAULT 0,
  "onflow" INTEGER NOT NULL DEFAULT 0,
  "healthy" INTEGER NOT NULL DEFAULT 0,
  "unclassified" INTEGER NOT NULL DEFAULT 0,
  "totalKpis" INTEGER NOT NULL DEFAULT 0,
  "incidentReports" INTEGER NOT NULL DEFAULT 0,
  "projectProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "projectStatus" "ProjectStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectDashboardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectDashboardSnapshot_projectId_snapshotDate_key"
ON "ProjectDashboardSnapshot"("projectId", "snapshotDate");

CREATE INDEX "ProjectDashboardSnapshot_snapshotDate_idx"
ON "ProjectDashboardSnapshot"("snapshotDate");

CREATE INDEX "ProjectDashboardSnapshot_projectStatus_idx"
ON "ProjectDashboardSnapshot"("projectStatus");

ALTER TABLE "ProjectDashboardSnapshot"
ADD CONSTRAINT "ProjectDashboardSnapshot_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
