-- This is intentionally destructive: configured KPI data is not production data.
DROP TABLE IF EXISTS "KpiThresholdRule";
DROP TABLE IF EXISTS "DashboardKpi";

CREATE TABLE "DashboardKpi" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "projectId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "chartTypes" JSONB NOT NULL DEFAULT '["DONUT"]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardKpi_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KpiTarget" (
  "id" TEXT NOT NULL,
  "kpiId" TEXT NOT NULL,
  "scopeId" TEXT,
  "taskId" TEXT,
  "subtaskId" TEXT,
  "field" "KpiField" NOT NULL DEFAULT 'PROGRESS',
  "unit" TEXT NOT NULL DEFAULT '%',
  "criticalBelow" DECIMAL(5,2) NOT NULL DEFAULT -15,
  "healthyAtOrAbove" DECIMAL(5,2) NOT NULL DEFAULT -5,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KpiTarget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DashboardKpi_projectId_idx" ON "DashboardKpi"("projectId");
CREATE INDEX "DashboardKpi_createdById_idx" ON "DashboardKpi"("createdById");
CREATE INDEX "DashboardKpi_updatedById_idx" ON "DashboardKpi"("updatedById");
CREATE INDEX "KpiTarget_kpiId_idx" ON "KpiTarget"("kpiId");
CREATE INDEX "KpiTarget_scopeId_idx" ON "KpiTarget"("scopeId");
CREATE INDEX "KpiTarget_taskId_idx" ON "KpiTarget"("taskId");
CREATE INDEX "KpiTarget_subtaskId_idx" ON "KpiTarget"("subtaskId");

ALTER TABLE "DashboardKpi" ADD CONSTRAINT "DashboardKpi_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardKpi" ADD CONSTRAINT "DashboardKpi_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DashboardKpi" ADD CONSTRAINT "DashboardKpi_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KpiTarget" ADD CONSTRAINT "KpiTarget_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "DashboardKpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiTarget" ADD CONSTRAINT "KpiTarget_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KpiTarget" ADD CONSTRAINT "KpiTarget_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KpiTarget" ADD CONSTRAINT "KpiTarget_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "Subtask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
