import "dotenv/config";
import assert from "node:assert/strict";
import JSZip from "jszip";
import prisma from "../../config/prisma";
import { reportDataService } from "../services/report-data.service";
import { reportExcelService } from "../services/report-excel.service";

const SAMPLE_PROJECT_ID = "8e4f4ad7-ea5d-4c8c-92cf-cdd1384cb501";

async function run() {
  const project = await prisma.project.findUnique({
    where: { id: SAMPLE_PROJECT_ID },
    select: { ownerId: true },
  });
  if (!project) throw new Error("Seeded local SUREVAX sample project was not found");

  const report = await reportDataService.buildPreview(
    SAMPLE_PROJECT_ID,
    project.ownerId,
    {
      type: "WEEKLY",
      dateFrom: "2026-07-20",
      dateTo: "2026-07-26",
      timezone: "Asia/Manila",
    }
  );
  const workbookBuffer = await reportExcelService.generate(SAMPLE_PROJECT_ID, report);
  assert.equal(workbookBuffer.subarray(0, 2).toString(), "PK");
  assert.ok(workbookBuffer.length > 50_000);

  const zip = await JSZip.loadAsync(workbookBuffer);
  const timelineXml = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  const reportXml = await zip.file("xl/worksheets/sheet3.xml")!.async("string");
  const dashboardXml = await zip.file("xl/worksheets/sheet4.xml")!.async("string");
  assert.ok(timelineXml.includes(report.project.name));
  assert.ok(reportXml.includes(report.project.name));
  assert.ok(dashboardXml.includes(report.project.name));
  const firstSubtask = report.detailedProgress?.[0]?.tasks?.[0]?.subtasks?.[0];
  assert.ok(firstSubtask?.title);
  assert.ok(timelineXml.includes(firstSubtask.title));
  assert.ok(timelineXml.includes("PROJECTED"));
  assert.ok(timelineXml.includes("ACTUAL"));
  assert.ok(!timelineXml.includes("{{"));
  assert.ok(!reportXml.includes("{{"));
  assert.ok(!dashboardXml.includes("{{"));

  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  const worksheetNames = Array.from(
    workbookXml.matchAll(/<(?:x:)?sheet\b[^>]*\bname="([^"]+)"/g),
    (match) => match[1]
  );
  assert.deepEqual(worksheetNames, [
    "README",
    "Timeline Template",
    "Report Template",
    "Dashboard Template",
    "Template Map",
  ]);
  assert.ok(workbookXml.includes('fullCalcOnLoad="1"'));

  console.log(
    JSON.stringify({
      success: true,
      projectId: SAMPLE_PROJECT_ID,
      bytes: workbookBuffer.length,
      signature: workbookBuffer.subarray(0, 2).toString(),
      worksheets: worksheetNames,
      embeddedDrawingsPreserved: Object.keys(zip.files).filter((name) =>
        /^xl\/drawings\/drawing\d+\.xml$/.test(name)
      ).length,
    })
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
