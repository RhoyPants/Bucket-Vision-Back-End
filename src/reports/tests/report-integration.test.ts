import "dotenv/config";
import prisma from "../../config/prisma";
import { reportDataService } from "../services/report-data.service";
import { utcToManilaDateKey } from "../validators/report-request.validator";

async function run() {
  const targetProjectId = process.env.REPORT_TEST_PROJECT_ID?.trim();
  const progressLog = await prisma.progressLog.findFirst({
    where: {
      date: { lte: new Date() },
      subtask: {
        task: {
          scope: {
            ...(targetProjectId ? { projectId: targetProjectId } : {}),
            project: { startDate: { not: null } },
          },
        },
      },
    },
    orderBy: { date: "desc" },
    select: {
      date: true,
      subtask: {
        select: {
          task: {
            select: {
              scope: {
                select: {
                  project: {
                    select: { id: true, ownerId: true, startDate: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const project =
    progressLog?.subtask.task.scope.project ||
    (await prisma.project.findFirst({
      where: { startDate: { not: null } },
      orderBy: { startDate: "asc" },
      select: { id: true, ownerId: true, startDate: true },
    }));
  if (!project?.startDate) throw new Error("No project with a start date was found");

  const reportDate =
    progressLog?.date ||
    new Date(Math.min(Date.now(), project.startDate.getTime() + 24 * 60 * 60 * 1000));
  const result = await reportDataService.buildPreview(project.id, project.ownerId, {
    type: "DAILY",
    date: utcToManilaDateKey(reportDate),
    timezone: "Asia/Manila",
  });

  console.log(
    JSON.stringify({
      success: true,
      projectId: project.id,
      reportDate: result.report.periodEnd,
      summary: result.summary,
      progressAudit: result.progressAudit.summary,
      sCurve: {
        first: result.sCurve[0] || null,
        reportDate: result.sCurve.find(
          (point) => point.date === result.report.periodEnd
        ) || null,
        firstAfterReport:
          result.sCurve.find((point) => point.date > result.report.periodEnd) || null,
        last: result.sCurve[result.sCurve.length - 1] || null,
      },
    })
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
