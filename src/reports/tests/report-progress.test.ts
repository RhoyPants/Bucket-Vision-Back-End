import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { reportCalculationService as calculator } from "../services/report-calculation.service";
import { reportDataService } from "../services/report-data.service";
import { reportExcelService } from "../services/report-excel.service";
import { reportPdfService } from "../services/report-pdf.service";
import { progressNumber } from "../services/report-progress";
import { parseReportPeriod } from "../validators/report-request.validator";

const schedule = { monday: false, tuesday: true, wednesday: true, thursday: true,
  friday: true, saturday: true, sunday: false, includeHolidays: true, holidayKeys: new Set<string>() };
const daily = parseReportPeriod({ type: "DAILY", date: "2026-10-23" }, new Date("2026-11-03"));
const weeklyQuery = { type: "WEEKLY", dateFrom: "2026-10-19", dateTo: "2026-10-25" };
const weekly = parseReportPeriod(weeklyQuery, new Date("2026-11-03"));
const decimal = (value: number) => new Prisma.Decimal(value);
function log(id: string, day: string, dailyPercent: unknown, cumulativePercent: unknown, createdAt = new Date("2026-10-23T01:00Z")) {
  return { id, date: new Date(`${day}T00:00:00+08:00`), dailyPercent, cumulativePercent,
    createdAt, updatedAt: new Date("2026-10-30T00:00Z"), attachments: [], latitude: null, longitude: null };
}
const task = { id: "task", title: "Task", budgetPercent: null, budgetAllocated: null,
  scope: { id: "scope", name: "Scope", budgetPercent: null, budgetAllocated: null } };
const management: any = {
  id: "ca2f7c23-4dce-4c69-b9cf-1a25c97a820b", title: "management", isBudgeted: false,
  budgetPercent: null, budgetAllocated: null, progress: decimal(100), task,
  projectedStartDate: new Date("2026-10-20"), projectedEndDate: new Date("2026-10-24"),
  progressLogs: Array.from({ length: 18 }, (_, index) => {
    const day = String(6 + index).padStart(2, "0");
    return log(`management-${day}`, `2026-10-${day}`, decimal(4.17), decimal((index + 1) * 417 / 100));
  }),
};
const dismantling: any = { ...management, id: "8b03adf9-fc53-47b2-8cf1-b7ca70707ce7", title: "Dismantling",
  projectedStartDate: new Date("2026-10-22"), projectedEndDate: new Date("2026-10-30"),
  progressLogs: [log("d1", "2026-10-22", decimal(10), decimal(10)), log("d2", "2026-10-23", decimal(5), decimal(15))] };
const service = reportDataService as any;
for (const [subtask, actual, opening, expected, variance, delivered] of [
  [management, 75.06, 70.89, 80, -4.94, 4.17], [dismantling, 15, 10, 28.57, -13.57, 5],
] as const) {
  const metrics = service.metrics([subtask], daily, schedule);
  assert.equal(calculator.actualAt(subtask, daily.cutoffUtc), actual);
  assert.equal(calculator.actualAt(subtask, daily.openingCutoffUtc), opening);
  assert.equal(metrics.actualProgress, actual);
  assert.equal(metrics.expectedProgress, expected);
  assert.equal(metrics.variance, variance);
  assert.equal(metrics.periodProgress, delivered);
  assert.equal(metrics.health, "WARNING");
  assert.equal(metrics.statusReason, "Actual progress is behind expected progress.");
  const entry = service.buildProgressAudit([subtask], daily, schedule).entries[0];
  assert.equal(entry.progressAfter, actual);
  assert.equal(entry.previousProgress, opening);
  assert.equal(entry.healthAfter, metrics.health);
  assert.equal(entry.assessment, "CONSISTENT");
  assert.deepEqual(entry.checks, []);
}
assert.equal(calculator.actualAt(management, weekly.openingCutoffUtc), 54.21);
assert.equal(service.metrics([management], weekly, schedule).periodProgress, 20.85);
for (const value of [null, undefined, "", " ", false, true, {}, "garbage", NaN, Infinity, -1, 101, new Prisma.Decimal("NaN")]) {
  assert.equal(progressNumber(value), null);
  const invalid = { ...management, progressLogs: [log("bad", "2026-10-23", value, value)] };
  const metrics = service.metrics([invalid], daily, schedule);
  assert.equal(metrics.actualProgress, null);
  assert.equal(metrics.periodProgress, null);
  assert.equal(metrics.health, "UNCLASSIFIED");
  const audit = service.buildProgressAudit([invalid], daily, schedule);
  assert.equal(audit.entries[0].assessment, "REVIEW_REQUIRED");
  assert.equal(audit.entries[0].checks[0].code, "INCOMPLETE_PROGRESS_DATA");
  assert.equal(audit.summary.reviewRequiredEntries, 1);
}
for (const value of [0, "0", decimal(0)]) assert.equal(progressNumber(value), 0);
assert.equal(calculator.actualAt({ ...management, progressLogs: [] }, daily.cutoffUtc), 0);
const zero = { ...management, progressLogs: [log("zero", "2026-10-23", decimal(0), decimal(0))] };
assert.equal(service.metrics([zero], daily, schedule).actualProgress, 0);
assert.equal(service.buildProgressAudit([zero], daily, schedule).entries[0].assessment, "CONSISTENT");
const missingPrevious = { ...management, progressLogs: [log("bad", "2026-10-22", 2, null), log("next", "2026-10-23", 5, 7)] };
assert.equal(service.buildProgressAudit([missingPrevious], daily, schedule).entries[0].assessment, "REVIEW_REQUIRED");
const mismatch = { ...management, progressLogs: [log("bad", "2026-10-23", 4.17, 4.18)] };
assert.equal(service.buildProgressAudit([mismatch], daily, schedule).entries[0].checks[0].code, "CUMULATIVE_MISMATCH");

// Same-day contributors: writer order survives edits and reversed query results.
const a = { ...log("a", "2026-10-23", decimal(7), decimal(7)), updatedAt: new Date("2026-11-02") };
const b = { ...log("b", "2026-10-23", decimal(5), decimal(12)), updatedAt: new Date("2026-10-24") };
const edited = { ...management, progressLogs: [b, a] };
assert.equal(calculator.actualAt(edited, daily.cutoffUtc), 12, "Use latest cumulative snapshot, never sum snapshots");
const editedAudit = service.buildProgressAudit([edited], daily, schedule);
assert.deepEqual(editedAudit.entries.map((e: any) => e.progressLogId), ["a", "b"]);
assert.equal(editedAudit.entries.find((e: any) => e.progressLogId === "b").previousProgress, 7);
assert.ok(editedAudit.entries.every((e: any) => e.assessment === "CONSISTENT"));
const byCreation = { ...edited, progressLogs: [{ ...a, id: "z" }, { ...b, id: "a", createdAt: new Date("2026-10-23T02:00Z") }] };
assert.equal(calculator.actualAt(byCreation, daily.cutoffUtc), 12);
const boundary = { ...management, progressLogs: [
  { ...log("before", "2026-10-22", 2, 2), date: daily.openingCutoffUtc },
  { ...log("first", "2026-10-23", 3, 5), date: daily.startUtc },
  { ...log("last", "2026-10-23", 4, 9), date: daily.cutoffUtc },
  { ...log("future", "2026-10-24", 91, 100), date: daily.endExclusiveUtc },
] };
assert.equal(calculator.actualAt(boundary, daily.openingCutoffUtc), 2);
assert.equal(calculator.actualAt(boundary, daily.cutoffUtc), 9);
assert.equal(service.metrics([boundary], daily, schedule).periodProgress, 7);
assert.equal(service.buildProgressAudit([boundary], daily, schedule).entries.length, 2);

// A complete mocked query -> Decimal mapping -> preview -> exports path.
async function run() {
  const subtasks = [management, dismantling];
  const project: any = { id: "project", name: "Progress regression", ownerId: "owner", isBudgeted: false,
    startDate: new Date("2026-10-06"), expectedEndDate: new Date("2026-10-30"), ...schedule,
    scopes: [{ ...task.scope, tasks: [{ ...task, subtasks }] }], projectMembers: [] };
  const patches: Array<[any, string, any]> = [];
  const patch = (object: any, key: string, value: any) => { patches.push([object, key, object[key]]); object[key] = value; };
  patch(prisma.project, "findUnique", async () => project);
  patch(prisma.project, "findUniqueOrThrow", async () => project);
  patch(prisma.user, "findUnique", async () => ({ id: "owner", role: { name: "SUPERADMIN" } }));
  patch(prisma.holiday, "findMany", async () => []);
  patch(prisma.incidentReport, "findMany", async () => []);
  patch(prisma.progressLog, "findMany", async () => []);
  patch(prisma.subtask, "findMany", async () => subtasks);
  try {
    for (const query of [{ type: "DAILY", date: "2026-10-23" }, weeklyQuery]) {
      const report = await reportDataService.buildPreview(project.id, "owner", query);
      const p = parseReportPeriod(query, new Date("2026-11-03"));
      assert.equal(report.summary.actualProgress, calculator.aggregate(subtasks, (s) => calculator.actualAt(s, p.cutoffUtc), { strict: true }));
      assert.equal(report.summary.actualProgress, report.detailedProgress[0].metrics.actualProgress);
      assert.equal(report.summary.actualProgress, report.detailedProgress[0].tasks[0].metrics.actualProgress);
      assert.equal(report.summary.actualProgress, report.sCurve.find((s) => s.date === report.report.periodEnd)!.actual);
      assert.ok(report.sCurve.filter((s) => s.date > report.report.periodEnd).every((s) => s.actual === null));
      const html = await (reportPdfService as any).render(report);
      assert.ok(html.includes("75.06%"));
      assert.ok(html.includes("15.00%"));
      const excel = await reportExcelService.generate(project.id, report);
      assert.equal(excel.subarray(0, 2).toString(), "PK");
    }
    const excelService = reportExcelService as any;
    const xml = '<worksheet><c r="B16"/><c r="B18"/><c r="B19"/><c r="D16"/><c r="D18"/></worksheet>';
    const missing = excelService.populateLegacyReport(xml, { report: { periodEnd: "2026-10-23" }, summary: {},
      sCurve: [{ date: "2026-10-22", planned: 10, actual: null }, { date: "2026-10-23", planned: 20, actual: 15 }] });
    assert.match(missing, /<c r="B18"\/>/);
    assert.match(missing, /<c r="B16"\/>/);
    assert.match(missing, /<c r="D16"\/>/, "Period delivery is unknown if the prior actual is unavailable");
    assert.match(missing, /<c r="D18" t="n"><v>0.15<\/v>/);
    const clipped = excelService.populateLegacyReport(xml, { report: { periodEnd: "2026-10-23" }, summary: {},
      sCurve: Array.from({ length: 21 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, planned: i + 1, actual: i + 1 })) });
    assert.match(clipped, /<c r="B16" t="n"><v>0.01<\/v>/, "A clipped chart uses the preceding cumulative baseline");
    const futureXml = excelService.populateLegacyTimeline('<worksheet><c r="G7"/></worksheet>',
      { report: { periodEnd: "2026-10-23" }, sCurve: [{ date: "2026-10-24" }] }, { subtasks: [management], schedule });
    assert.match(futureXml, /<c r="G7"\/>/);
    console.log("Report progress regression tests passed");
  } finally {
    for (const [object, key, value] of patches.reverse()) object[key] = value;
    await prisma.$disconnect();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
