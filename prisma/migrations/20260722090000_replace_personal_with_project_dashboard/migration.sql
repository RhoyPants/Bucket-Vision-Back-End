-- Preserve personal notes by assigning them directly to the user who owned their dashboard.
ALTER TABLE "DashboardNote" ADD COLUMN "userId" TEXT;

UPDATE "DashboardNote" AS note
SET "userId" = dashboard."userId"
FROM "PersonalDashboard" AS dashboard
WHERE note."dashboardId" = dashboard."id";

ALTER TABLE "DashboardNote" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "DashboardNote"
DROP CONSTRAINT "DashboardNote_dashboardId_fkey";

DROP INDEX "DashboardNote_dashboardId_idx";

ALTER TABLE "DashboardNote" DROP COLUMN "dashboardId";

CREATE INDEX "DashboardNote_userId_idx" ON "DashboardNote"("userId");

ALTER TABLE "DashboardNote"
ADD CONSTRAINT "DashboardNote_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- KPIs are now shared project resources instead of personal-dashboard resources.
ALTER TABLE "DashboardKpi"
DROP CONSTRAINT "DashboardKpi_dashboardId_fkey";

DROP INDEX "DashboardKpi_dashboardId_idx";

ALTER TABLE "DashboardKpi" DROP COLUMN "dashboardId";

ALTER TABLE "DashboardKpi"
ADD CONSTRAINT "DashboardKpi_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Chart data is computed from a project and no longer has persisted dashboard configuration.
DROP TABLE "DashboardChartConfig";
DROP TABLE "PersonalDashboard";
DROP TYPE "DashboardChartType";

-- Preserve existing role permissions while renaming the RBAC module.
UPDATE "Module"
SET "name" = 'project_dashboard', "path" = '/projects/:projectId/dashboard'
WHERE "name" = 'personal_dashboard';
