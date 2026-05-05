-- CreateTable ApprovalFlow
CREATE TABLE "ApprovalFlow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable ApprovalStep
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "requiresAll" INTEGER NOT NULL DEFAULT 1,
    "canReject" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- Add columns to Project table
ALTER TABLE "Project" ADD COLUMN "approvalFlowId" TEXT;
ALTER TABLE "Project" ADD COLUMN "approvalEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex for ApprovalFlow
CREATE UNIQUE INDEX "ApprovalFlow_name_key" ON "ApprovalFlow"("name");
CREATE INDEX "ApprovalFlow_isDefault_idx" ON "ApprovalFlow"("isDefault");
CREATE INDEX "ApprovalFlow_isActive_idx" ON "ApprovalFlow"("isActive");

-- CreateIndex for ApprovalStep
CREATE UNIQUE INDEX "ApprovalStep_flowId_order_key" ON "ApprovalStep"("flowId", "order");
CREATE INDEX "ApprovalStep_flowId_idx" ON "ApprovalStep"("flowId");

-- CreateIndex for Project
CREATE INDEX "Project_approvalFlowId_idx" ON "Project"("approvalFlowId");

-- AddForeignKey for ApprovalStep
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ApprovalFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for Project
ALTER TABLE "Project" ADD CONSTRAINT "Project_approvalFlowId_fkey" FOREIGN KEY ("approvalFlowId") REFERENCES "ApprovalFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
