/*
  Warnings:

  - You are about to drop the column `statusId` on the `Subtask` table. All the data in the column will be lost.
  - You are about to drop the `Status` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Status" DROP CONSTRAINT "Status_taskId_fkey";

-- DropForeignKey
ALTER TABLE "Subtask" DROP CONSTRAINT "Subtask_statusId_fkey";

-- DropIndex
DROP INDEX "Subtask_statusId_idx";

-- AlterTable
ALTER TABLE "Subtask" DROP COLUMN "statusId",
ADD COLUMN     "status" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "Status";
