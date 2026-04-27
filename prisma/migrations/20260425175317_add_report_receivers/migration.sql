-- CreateTable
CREATE TABLE "DailyReportReceiver" (
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DailyReportReceiver_pkey" PRIMARY KEY ("reportId","userId")
);

-- CreateTable
CREATE TABLE "WeeklyReportReceiver" (
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "WeeklyReportReceiver_pkey" PRIMARY KEY ("reportId","userId")
);

-- AddForeignKey
ALTER TABLE "DailyReportReceiver" ADD CONSTRAINT "DailyReportReceiver_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportReceiver" ADD CONSTRAINT "DailyReportReceiver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReportReceiver" ADD CONSTRAINT "WeeklyReportReceiver_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "WeeklyReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReportReceiver" ADD CONSTRAINT "WeeklyReportReceiver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
