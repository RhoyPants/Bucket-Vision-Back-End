import "dotenv/config";
import assert from "node:assert/strict";
import prisma from "../../config/prisma";
import { reportDataService } from "../services/report-data.service";
import { reportPdfService } from "../services/report-pdf.service";

const SAMPLE_PROJECT_ID = "8e4f4ad7-ea5d-4c8c-92cf-cdd1384cb501";

async function run() {
  const project = await prisma.project.findUnique({
    where: { id: SAMPLE_PROJECT_ID },
    select: { ownerId: true },
  });
  if (!project) throw new Error("Seeded local SUREVAX sample project was not found");

  const requests = [
    { type: "DAILY", date: "2026-07-15", timezone: "Asia/Manila" },
    {
      type: "WEEKLY",
      dateFrom: "2026-07-20",
      dateTo: "2026-07-26",
      timezone: "Asia/Manila",
    },
  ];
  const results = [];
  for (const query of requests) {
    const report = await reportDataService.buildPreview(
      SAMPLE_PROJECT_ID,
      project.ownerId,
      query
    );
    const pdf = await reportPdfService.generate(report);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 20_000, `Expected a non-trivial PDF, received ${pdf.length} bytes`);
    results.push({
      type: report.report.type,
      periodStart: report.report.periodStart,
      periodEnd: report.report.periodEnd,
      bytes: pdf.length,
      signature: pdf.subarray(0, 4).toString(),
    });
  }
  console.log(JSON.stringify({ success: true, projectId: SAMPLE_PROJECT_ID, results }));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await reportPdfService.closeBrowser();
    await prisma.$disconnect();
  });
