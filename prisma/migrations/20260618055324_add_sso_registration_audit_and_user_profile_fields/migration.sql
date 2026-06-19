-- CreateEnum
CREATE TYPE "SsoRegistrationAction" AS ENUM ('CREATED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'UPDATED');

-- AlterTable
ALTER TABLE "SsoRegistration" ADD COLUMN     "company" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "businessUnitId" TEXT,
ADD COLUMN     "company" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "position" TEXT;

-- CreateTable
CREATE TABLE "SsoRegistrationAudit" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "action" "SsoRegistrationAction" NOT NULL,
    "fromStatus" "SsoRegistrationStatus",
    "toStatus" "SsoRegistrationStatus",
    "reason" TEXT,
    "snapshot" JSONB,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoRegistrationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsoRegistrationAudit_registrationId_idx" ON "SsoRegistrationAudit"("registrationId");

-- CreateIndex
CREATE INDEX "SsoRegistrationAudit_createdAt_idx" ON "SsoRegistrationAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoRegistrationAudit" ADD CONSTRAINT "SsoRegistrationAudit_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "SsoRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoRegistrationAudit" ADD CONSTRAINT "SsoRegistrationAudit_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
