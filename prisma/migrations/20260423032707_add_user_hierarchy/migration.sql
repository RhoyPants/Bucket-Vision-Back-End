/*
  Warnings:

  - You are about to drop the `UserRelation` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "UserRelation" DROP CONSTRAINT "UserRelation_fromUserId_fkey";

-- DropForeignKey
ALTER TABLE "UserRelation" DROP CONSTRAINT "UserRelation_toUserId_fkey";

-- DropTable
DROP TABLE "UserRelation";

-- CreateTable
CREATE TABLE "UserHierarchy" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserHierarchy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserHierarchy_managerId_idx" ON "UserHierarchy"("managerId");

-- CreateIndex
CREATE INDEX "UserHierarchy_memberId_idx" ON "UserHierarchy"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "UserHierarchy_managerId_memberId_key" ON "UserHierarchy"("managerId", "memberId");

-- AddForeignKey
ALTER TABLE "UserHierarchy" ADD CONSTRAINT "UserHierarchy_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHierarchy" ADD CONSTRAINT "UserHierarchy_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
