/*
  Warnings:

  - You are about to drop the column `categoryId` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the `Category` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `scopeId` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'FOR_REVIEW', 'FOR_APPROVAL', 'ACTIVE', 'INACTIVE', 'REJECTED', 'NEEDS_REVISION');

-- CreateEnum
CREATE TYPE "ApprovalLevel" AS ENUM ('BU_HEAD', 'OP');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "Category" DROP CONSTRAINT "Category_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_categoryId_fkey";

-- DropIndex
DROP INDEX "Project_pin_key";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isLatestVersion" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentProjectId" TEXT,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rootProjectId" TEXT,
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "versionLabel" TEXT,
ADD COLUMN     "versionNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "categoryId",
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scopeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approverId" TEXT,
ADD COLUMN     "departmentId" TEXT;

-- AlterTable
ALTER TABLE "WeeklyReport" ADD COLUMN     "projectId" TEXT;

-- DropTable
DROP TABLE "Category";

-- CreateTable
CREATE TABLE "Scope" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "projectId" TEXT NOT NULL,
    "budgetAllocated" DOUBLE PRECISION,
    "budgetPercent" DOUBLE PRECISION,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectApproval" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "level" "ApprovalLevel" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT NOT NULL,
    "remarks" TEXT,
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scope_projectId_idx" ON "Scope"("projectId");

-- CreateIndex
CREATE INDEX "ProjectApproval_projectId_idx" ON "ProjectApproval"("projectId");

-- CreateIndex
CREATE INDEX "ProjectApproval_approverId_idx" ON "ProjectApproval"("approverId");

-- CreateIndex
CREATE INDEX "ProjectApproval_status_idx" ON "ProjectApproval"("status");

-- CreateIndex
CREATE INDEX "ProjectApproval_level_idx" ON "ProjectApproval"("level");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_isActive_idx" ON "Project"("isActive");

-- CreateIndex
CREATE INDEX "Project_pin_idx" ON "Project"("pin");

-- CreateIndex
CREATE INDEX "Project_rootProjectId_idx" ON "Project"("rootProjectId");

-- CreateIndex
CREATE INDEX "Project_parentProjectId_idx" ON "Project"("parentProjectId");

-- CreateIndex
CREATE INDEX "Task_scopeId_idx" ON "Task"("scopeId");

-- CreateIndex
CREATE INDEX "WeeklyReport_projectId_idx" ON "WeeklyReport"("projectId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_rootProjectId_fkey" FOREIGN KEY ("rootProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_parentProjectId_fkey" FOREIGN KEY ("parentProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scope" ADD CONSTRAINT "Scope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectApproval" ADD CONSTRAINT "ProjectApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectApproval" ADD CONSTRAINT "ProjectApproval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
