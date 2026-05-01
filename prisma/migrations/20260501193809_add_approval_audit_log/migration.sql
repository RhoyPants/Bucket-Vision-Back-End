-- CreateTable
CREATE TABLE "ApprovalAuditLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "level" "ApprovalLevel" NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" "ProjectStatus",
    "newStatus" "ProjectStatus",
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalAuditLog_projectId_idx" ON "ApprovalAuditLog"("projectId");

-- CreateIndex
CREATE INDEX "ApprovalAuditLog_approverId_idx" ON "ApprovalAuditLog"("approverId");

-- CreateIndex
CREATE INDEX "ApprovalAuditLog_createdAt_idx" ON "ApprovalAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ApprovalAuditLog" ADD CONSTRAINT "ApprovalAuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAuditLog" ADD CONSTRAINT "ApprovalAuditLog_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
