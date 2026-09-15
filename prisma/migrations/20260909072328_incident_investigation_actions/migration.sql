-- CreateEnum
CREATE TYPE "IncidentEvidenceSection" AS ENUM ('INITIAL_REPORT', 'SITE_FINDINGS', 'IMMEDIATE_ACTION', 'ROOT_CAUSE', 'CONTRIBUTING_FACTORS', 'MITIGATION', 'RECOMMENDATIONS', 'ACTION', 'RESOLUTION');

-- CreateEnum
CREATE TYPE "IncidentActionType" AS ENUM ('CORRECTIVE', 'PREVENTIVE');

-- CreateEnum
CREATE TYPE "IncidentActionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "IncidentAttachment" ADD COLUMN     "actionId" TEXT,
ADD COLUMN     "caption" TEXT,
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "section" "IncidentEvidenceSection" NOT NULL DEFAULT 'INITIAL_REPORT';

-- AlterTable
ALTER TABLE "IncidentReport" ADD COLUMN     "immediateActionTaken" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "occurredAt" TIMESTAMP(3),
ADD COLUMN     "reportRecipient" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "IncidentInvestigation" (
    "incidentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "siteFindings" TEXT,
    "rootCause" TEXT,
    "contributingFactors" TEXT,
    "mitigation" TEXT,
    "recommendations" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentInvestigation_pkey" PRIMARY KEY ("incidentId")
);

-- CreateTable
CREATE TABLE "IncidentAction" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionType" "IncidentActionType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "IncidentActionStatus" NOT NULL DEFAULT 'PENDING',
    "requiredForResolution" BOOLEAN NOT NULL DEFAULT true,
    "requirementChangeReason" TEXT,
    "completionRemarks" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentResolutionConfirmation" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "resolverId" TEXT NOT NULL,
    "remarks" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "evidenceIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentResolutionConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentAction_incidentId_status_idx" ON "IncidentAction"("incidentId", "status");

-- CreateIndex
CREATE INDEX "IncidentAction_ownerId_status_idx" ON "IncidentAction"("ownerId", "status");

-- CreateIndex
CREATE INDEX "IncidentResolutionConfirmation_incidentId_createdAt_idx" ON "IncidentResolutionConfirmation"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentResolutionConfirmation_incidentId_levelId_resolverI_key" ON "IncidentResolutionConfirmation"("incidentId", "levelId", "resolverId");

-- CreateIndex
CREATE INDEX "IncidentAttachment_actionId_idx" ON "IncidentAttachment"("actionId");

-- AddForeignKey
ALTER TABLE "IncidentAttachment" ADD CONSTRAINT "IncidentAttachment_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "IncidentAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentInvestigation" ADD CONSTRAINT "IncidentInvestigation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "IncidentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentInvestigation" ADD CONSTRAINT "IncidentInvestigation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAction" ADD CONSTRAINT "IncidentAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "IncidentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAction" ADD CONSTRAINT "IncidentAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAction" ADD CONSTRAINT "IncidentAction_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAction" ADD CONSTRAINT "IncidentAction_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentResolutionConfirmation" ADD CONSTRAINT "IncidentResolutionConfirmation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "IncidentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentResolutionConfirmation" ADD CONSTRAINT "IncidentResolutionConfirmation_resolverId_fkey" FOREIGN KEY ("resolverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
