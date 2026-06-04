-- CreateEnum
CREATE TYPE "KpiSourceType" AS ENUM ('PROJECT', 'SCOPE', 'TASK', 'SUBTASK');

-- CreateEnum
CREATE TYPE "KpiField" AS ENUM ('PROGRESS');

-- CreateEnum
CREATE TYPE "KpiStatus" AS ENUM ('CRITICAL', 'ONFLOW', 'HEALTHY', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "KpiValueOperator" AS ENUM ('LT', 'LTE', 'EQ', 'GTE', 'GT', 'BETWEEN');

-- CreateEnum
CREATE TYPE "DashboardChartType" AS ENUM ('KPI_SUMMARY', 'SCURVE', 'PROGRESS_TREND', 'KPI_STATUS_DISTRIBUTION', 'TASK_COMPLETION');

-- CreateTable
CREATE TABLE "PersonalDashboard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardKpi" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT '%',
    "field" "KpiField" NOT NULL DEFAULT 'PROGRESS',
    "sourceType" "KpiSourceType" NOT NULL,
    "projectId" TEXT NOT NULL,
    "scopeId" TEXT,
    "taskId" TEXT,
    "subtaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardKpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiThresholdRule" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "status" "KpiStatus" NOT NULL,
    "operator" "KpiValueOperator" NOT NULL,
    "value1" DOUBLE PRECISION NOT NULL,
    "value2" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiThresholdRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardChartConfig" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "chartType" "DashboardChartType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardChartConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalDashboard_userId_idx" ON "PersonalDashboard"("userId");

-- CreateIndex
CREATE INDEX "PersonalDashboard_projectId_idx" ON "PersonalDashboard"("projectId");

-- CreateIndex
CREATE INDEX "DashboardKpi_dashboardId_idx" ON "DashboardKpi"("dashboardId");

-- CreateIndex
CREATE INDEX "DashboardKpi_projectId_idx" ON "DashboardKpi"("projectId");

-- CreateIndex
CREATE INDEX "DashboardKpi_scopeId_idx" ON "DashboardKpi"("scopeId");

-- CreateIndex
CREATE INDEX "DashboardKpi_taskId_idx" ON "DashboardKpi"("taskId");

-- CreateIndex
CREATE INDEX "DashboardKpi_subtaskId_idx" ON "DashboardKpi"("subtaskId");

-- CreateIndex
CREATE UNIQUE INDEX "KpiThresholdRule_kpiId_status_key" ON "KpiThresholdRule"("kpiId", "status");

-- CreateIndex
CREATE INDEX "KpiThresholdRule_kpiId_idx" ON "KpiThresholdRule"("kpiId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardChartConfig_dashboardId_chartType_key" ON "DashboardChartConfig"("dashboardId", "chartType");

-- CreateIndex
CREATE INDEX "DashboardChartConfig_dashboardId_idx" ON "DashboardChartConfig"("dashboardId");

-- AddForeignKey
ALTER TABLE "PersonalDashboard" ADD CONSTRAINT "PersonalDashboard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalDashboard" ADD CONSTRAINT "PersonalDashboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardKpi" ADD CONSTRAINT "DashboardKpi_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "PersonalDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiThresholdRule" ADD CONSTRAINT "KpiThresholdRule_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "DashboardKpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardChartConfig" ADD CONSTRAINT "DashboardChartConfig_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "PersonalDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
