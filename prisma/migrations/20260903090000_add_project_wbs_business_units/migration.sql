CREATE TABLE "ProjectWbsBusinessUnit" (
    "projectId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectWbsBusinessUnit_pkey" PRIMARY KEY ("projectId", "businessUnitId")
);

CREATE INDEX "ProjectWbsBusinessUnit_businessUnitId_idx"
ON "ProjectWbsBusinessUnit"("businessUnitId");

ALTER TABLE "ProjectWbsBusinessUnit"
ADD CONSTRAINT "ProjectWbsBusinessUnit_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectWbsBusinessUnit"
ADD CONSTRAINT "ProjectWbsBusinessUnit_businessUnitId_fkey"
FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
