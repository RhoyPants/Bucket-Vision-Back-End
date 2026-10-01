ALTER TABLE "Project"
ADD COLUMN "isPhasing" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Phase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Phase_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Scope" ADD COLUMN "phaseId" TEXT;

CREATE INDEX "Phase_projectId_idx" ON "Phase"("projectId");
CREATE INDEX "Phase_projectId_order_idx" ON "Phase"("projectId", "order");
CREATE INDEX "Scope_phaseId_idx" ON "Scope"("phaseId");

ALTER TABLE "Phase"
ADD CONSTRAINT "Phase_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Scope"
ADD CONSTRAINT "Scope_phaseId_fkey"
FOREIGN KEY ("phaseId") REFERENCES "Phase"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
