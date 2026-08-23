CREATE TABLE "CpmDependency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "predecessorSubtaskId" TEXT NOT NULL,
    "successorSubtaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CpmDependency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CpmDependency_no_self_dependency" CHECK ("predecessorSubtaskId" <> "successorSubtaskId")
);

CREATE INDEX "CpmDependency_projectId_idx" ON "CpmDependency"("projectId");
CREATE INDEX "CpmDependency_predecessorSubtaskId_idx" ON "CpmDependency"("predecessorSubtaskId");
CREATE INDEX "CpmDependency_successorSubtaskId_idx" ON "CpmDependency"("successorSubtaskId");
CREATE UNIQUE INDEX "CpmDependency_predecessorSubtaskId_successorSubtaskId_key" ON "CpmDependency"("predecessorSubtaskId", "successorSubtaskId");

ALTER TABLE "CpmDependency" ADD CONSTRAINT "CpmDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CpmDependency" ADD CONSTRAINT "CpmDependency_predecessorSubtaskId_fkey" FOREIGN KEY ("predecessorSubtaskId") REFERENCES "Subtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CpmDependency" ADD CONSTRAINT "CpmDependency_successorSubtaskId_fkey" FOREIGN KEY ("successorSubtaskId") REFERENCES "Subtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
