CREATE TYPE "ProgressUpdateRequestStatus" AS ENUM ('PENDING', 'APPLIED', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "ProgressUpdateRequest" (
    "id" TEXT NOT NULL,
    "progressLogId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "currentPercent" DECIMAL(5,2) NOT NULL,
    "requestedPercent" DECIMAL(5,2) NOT NULL,
    "difference" DECIMAL(5,2) NOT NULL,
    "remarks" TEXT NOT NULL,
    "reviewRemarks" TEXT,
    "status" "ProgressUpdateRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    CONSTRAINT "ProgressUpdateRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProgressUpdateRequest_progressLogId_status_idx" ON "ProgressUpdateRequest"("progressLogId", "status");
CREATE INDEX "ProgressUpdateRequest_requestedById_status_idx" ON "ProgressUpdateRequest"("requestedById", "status");
CREATE INDEX "ProgressUpdateRequest_status_createdAt_idx" ON "ProgressUpdateRequest"("status", "createdAt");

ALTER TABLE "ProgressUpdateRequest" ADD CONSTRAINT "ProgressUpdateRequest_progressLogId_fkey" FOREIGN KEY ("progressLogId") REFERENCES "ProgressLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgressUpdateRequest" ADD CONSTRAINT "ProgressUpdateRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgressUpdateRequest" ADD CONSTRAINT "ProgressUpdateRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
