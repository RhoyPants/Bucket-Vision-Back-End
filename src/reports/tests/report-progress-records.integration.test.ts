import "dotenv/config";
import assert from "node:assert/strict";
import prisma from "../../config/prisma";
import { reportDataService } from "../services/report-data.service";
import { reportPdfService } from "../services/report-pdf.service";
import { reportExcelService } from "../services/report-excel.service";
import JSZip from "jszip";

// Read-only verification of the reported project. Never repairs stored records.
async function run() {
  const projectId = "0e0676c0-75a1-4371-83bf-8a57dd5af0bc";
  const ids = ["ca2f7c23-4dce-4c69-b9cf-1a25c97a820b", "8b03adf9-fc53-47b2-8cf1-b7ca70707ce7"];
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ownerId: true } });
  const records = await prisma.progressLog.findMany({
    where: { subtaskId: { in: ids }, date: { lte: new Date("2026-10-23T15:59:59.999Z") } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, subtaskId: true, date: true, createdAt: true, updatedAt: true, dailyPercent: true, cumulativePercent: true },
  });
  for (const id of ids) {
    let units = 0;
    for (const record of records.filter((r) => r.subtaskId === id)) {
      units += Math.round(Number(record.dailyPercent) * 100);
      assert.equal(Math.round(Number(record.cumulativePercent) * 100), units, `Stored sequence for ${id}`);
    }
  }
  const report = await reportDataService.buildPreview(projectId, project.ownerId, {
    type: "DAILY", date: "2026-10-23", timezone: "Asia/Manila",
  });
  const subtasks = report.detailedProgress.flatMap((s: any) => s.tasks.flatMap((t: any) => t.subtasks))
    .filter((s: any) => ids.includes(s.id));
  console.log(JSON.stringify({ subtasks, summary: report.summary,
    audit: report.progressAudit.entries.filter((e: any) => ids.includes(e.subtask.id)).map((e: any) => ({
      id: e.subtask.id, previousProgress: e.previousProgress, dailyProgress: e.dailyProgress,
      progressAfter: e.progressAfter, varianceAfter: e.varianceAfter, healthAfter: e.healthAfter, assessment: e.assessment,
    })),
    schedule: await prisma.project.findUnique({ where: { id: projectId }, select: {
      monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true, includeHolidays: true,
    } }),
    holidays: await prisma.holiday.findMany({ where: { date: { gte: new Date("2026-10-01"), lt: new Date("2026-11-01") } }, select: { date: true } }),
    sCurve: report.sCurve.find((p) => p.date === "2026-10-23") }, null, 2));
  assert.equal(subtasks.length, 2);
  assert.equal(subtasks[0].metrics.actualProgress, 75.06);
  assert.equal(subtasks[1].metrics.actualProgress, 15);
  assert.equal(report.summary.actualProgress, 10.32);
  assert.equal(report.summary.periodProgress, 0.83);
  assert.equal(report.summary.health, "WARNING");
  assert.equal(report.summary.healthSummary.unclassified, 0);
  assert.equal(report.sCurve.find((p) => p.date === "2026-10-23")!.actual, report.summary.actualProgress);
  const weekly = await reportDataService.buildPreview(projectId, project.ownerId, {
    type: "WEEKLY", dateFrom: "2026-10-19", dateTo: "2026-10-25", timezone: "Asia/Manila",
  });
  for (const data of [report, weekly]) {
    const html = await (reportPdfService as any).render(data);
    assert.ok(html.includes("75.06%"));
    assert.ok(html.includes("15.00%"));
    const pdf = await reportPdfService.generate(data);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    const excel = await reportExcelService.generate(projectId, data);
    const zip = await JSZip.loadAsync(excel);
    const sheets = (await Promise.all(Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .map((name) => zip.file(name)!.async("string")))).join("");
    const values = Array.from(sheets.matchAll(/<(?:x:)?v>([^<]+)<\/(?:x:)?v>/g), (match) => Number(match[1]));
    for (const expected of [0.7506, 0.15, data.summary.actualProgress! / 100]) {
      assert.ok(values.some((value) => Math.abs(value - expected) < 1e-10), `Excel numeric value ${expected}`);
    }
    console.log(JSON.stringify({ type: data.report.type, summary: data.summary, pdfBytes: pdf.length, excelBytes: excel.length }));
  }
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { await reportPdfService.closeBrowser(); await prisma.$disconnect(); });
