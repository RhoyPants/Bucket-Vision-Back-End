-- AlterTable
ALTER TABLE "DailyReportReceiver" ADD COLUMN     "read" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WeeklyReportReceiver" ADD COLUMN     "read" BOOLEAN NOT NULL DEFAULT false;
