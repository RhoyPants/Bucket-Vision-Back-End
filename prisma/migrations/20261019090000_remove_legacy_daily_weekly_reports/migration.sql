-- Daily and weekly report records belong to the retired legacy reports module.
DROP TABLE "DailyReportReceiver";
DROP TABLE "WeeklyReportReceiver";

ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_dailyReportId_fkey";
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_weeklyReportId_fkey";
ALTER TABLE "Attachment" DROP COLUMN "dailyReportId";
ALTER TABLE "Attachment" DROP COLUMN "weeklyReportId";

DROP TABLE "DailyReport";
DROP TABLE "WeeklyReport";
