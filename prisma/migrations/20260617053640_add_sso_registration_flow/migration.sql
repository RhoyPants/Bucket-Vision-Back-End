-- CreateEnum
CREATE TYPE "SsoRegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SsoRegistration" (
    "id" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MICROSOFT',
    "providerOid" TEXT,
    "mobileNo" TEXT,
    "requestedRoleId" TEXT,
    "businessUnitId" TEXT,
    "departmentId" TEXT,
    "position" TEXT,
    "remarks" TEXT,
    "status" "SsoRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SsoRegistration_referenceNo_key" ON "SsoRegistration"("referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "SsoRegistration_email_key" ON "SsoRegistration"("email");

-- CreateIndex
CREATE INDEX "SsoRegistration_status_idx" ON "SsoRegistration"("status");

-- CreateIndex
CREATE INDEX "SsoRegistration_createdAt_idx" ON "SsoRegistration"("createdAt");

-- AddForeignKey
ALTER TABLE "SsoRegistration" ADD CONSTRAINT "SsoRegistration_requestedRoleId_fkey" FOREIGN KEY ("requestedRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoRegistration" ADD CONSTRAINT "SsoRegistration_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoRegistration" ADD CONSTRAINT "SsoRegistration_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
