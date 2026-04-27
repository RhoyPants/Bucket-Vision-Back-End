-- DropForeignKey
ALTER TABLE "DailyReportReceiver" DROP CONSTRAINT "DailyReportReceiver_reportId_fkey";

-- DropForeignKey
ALTER TABLE "WeeklyReportReceiver" DROP CONSTRAINT "WeeklyReportReceiver_reportId_fkey";

-- AddForeignKey
ALTER TABLE "DailyReportReceiver" ADD CONSTRAINT "DailyReportReceiver_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReportReceiver" ADD CONSTRAINT "WeeklyReportReceiver_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "WeeklyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
