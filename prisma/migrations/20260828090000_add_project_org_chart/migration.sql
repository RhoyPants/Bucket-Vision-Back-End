CREATE TABLE "ProjectOrgChart" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectOrgChart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectOrgChartNode" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT,
    "position" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "backgroundColor" TEXT,
    "textColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectOrgChartNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectOrgChart_projectId_key" ON "ProjectOrgChart"("projectId");
CREATE INDEX "ProjectOrgChart_projectId_idx" ON "ProjectOrgChart"("projectId");
CREATE INDEX "ProjectOrgChartNode_chartId_idx" ON "ProjectOrgChartNode"("chartId");
CREATE INDEX "ProjectOrgChartNode_parentId_idx" ON "ProjectOrgChartNode"("parentId");

ALTER TABLE "ProjectOrgChart" ADD CONSTRAINT "ProjectOrgChart_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectOrgChartNode" ADD CONSTRAINT "ProjectOrgChartNode_chartId_fkey"
FOREIGN KEY ("chartId") REFERENCES "ProjectOrgChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectOrgChartNode" ADD CONSTRAINT "ProjectOrgChartNode_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "ProjectOrgChartNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
