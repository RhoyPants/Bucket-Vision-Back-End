CREATE TABLE "ProjectSubtaskKpiConfig" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "criticalBelow" DOUBLE PRECISION NOT NULL DEFAULT -15,
  "healthyAtOrAbove" DOUBLE PRECISION NOT NULL DEFAULT -5,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectSubtaskKpiConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectSubtaskKpiConfig_projectId_key"
ON "ProjectSubtaskKpiConfig"("projectId");

CREATE INDEX "ProjectSubtaskKpiConfig_updatedById_idx"
ON "ProjectSubtaskKpiConfig"("updatedById");

ALTER TABLE "ProjectSubtaskKpiConfig"
ADD CONSTRAINT "ProjectSubtaskKpiConfig_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectSubtaskKpiConfig"
ADD CONSTRAINT "ProjectSubtaskKpiConfig_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
